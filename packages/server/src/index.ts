import { existsSync, readFileSync } from 'node:fs';
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import { assertUsableConfig, config } from './config.ts';
import { createContext } from './context.ts';
import { logger } from './log.ts';
import { Scheduler } from './scheduler.ts';
import { registerRoutes } from './api/routes.ts';
import { registerWebSocket } from './api/ws.ts';
import { collectOnt } from './collect/ont.ts';
import { collectPresence } from './collect/presence.ts';
import { collectProbes } from './collect/probes.ts';
import { checkUsageCap, collectSpeedtest } from './collect/speedtest.ts';
import { maybeVacuum, prune, rollup } from './analyze/rollup.ts';
import { rollRenewals } from './analyze/subscription.ts';
import { defaultGateway } from './probes/ping.ts';
import { discover } from './ont/discover.ts';

const log = logger('main');

/**
 * Every address this is actually reachable at, and whether a phone can install
 * it from there.
 *
 * This used to print the bind address, which on the default `0.0.0.0` is not a
 * URL anyone can open - so the one thing the boot log had to say, the address
 * to type into a phone, was the one thing it did not.
 */
function announce(secure: boolean): void {
  const scheme = secure ? 'https' : 'http';
  const { host, port } = config.server;
  const lan =
    host === '0.0.0.0' || host === '::'
      ? Object.values(networkInterfaces())
          .flat()
          .filter(
            (n): n is NetworkInterfaceInfo =>
              n !== undefined &&
              n.family === 'IPv4' &&
              !n.internal &&
              // A 169.254 address means that adapter never got a lease. It is
              // in the list, it is not somewhere anything can reach us.
              !n.address.startsWith('169.254.'),
          )
          .map((n) => n.address)
      : [host];

  log.info(`waifai listening on ${scheme}://127.0.0.1:${port}`);
  for (const addr of lan) log.info(`                    ${scheme}://${addr}:${port}`);

  /*
   * The one thing worth a warning at boot.
   *
   * A service worker only registers on a secure origin, and loopback is the
   * single exception browsers make. Over plain http that splits the audience
   * in two without saying so: the desktop at 127.0.0.1 gets the whole PWA,
   * and every phone on the LAN gets a web page that cannot be installed and
   * caches nothing - which is the exact state it needs to be in during the
   * outage it exists to be read during.
   */
  if (!secure && lan.length > 0) {
    log.warn(
      'serving over http. Unless something in front of this terminates TLS - "tailscale serve" ' +
        'does, and is what the README recommends - phones on the LAN cannot install it as an ' +
        'app: "Add to home screen" gives a browser shortcut and offline mode never works.',
    );
  }
}

async function main(): Promise<void> {
  assertUsableConfig();

  const ctx = createContext();
  /*
   * Store-backed so a deferred job's interval survives a restart. Without it
   * the speed test's three-hour countdown started again on every boot, and a
   * machine restarted more often than that never ran one at all.
   */
  const scheduler = new Scheduler({
    load: (job) => ctx.db.jobLastRun(job),
    save: (job, ts) => ctx.db.setJobLastRun(job, ts),
  });

  /*
   * Before anything else, work out whether we were away. A gap in the
   * heartbeat means the monitor was off - nearly always a mains cut - and that
   * window has to be recorded as unobserved rather than silently vanishing, or
   * every uptime figure afterwards is a lie by omission.
   *
   * Order matters here: both of these read the same heartbeat and the incident
   * tracker overwrites it, so the power reconstruction, which needs the old
   * value to know how long we were gone, has to go first.
   */
  ctx.power.beginGapReconstruction();
  ctx.tracker.recordDowntimeGap();

  ctx.gateway = config.probes.gateway || (await defaultGateway());
  log.info(`gateway for probing: ${ctx.gateway ?? 'none found'}`);

  /*
   * Firmware builds move data between .asp files, so rather than pinning paths
   * we probe once, record which ones answered, and poll only those afterwards.
   * A fresh database triggers this automatically.
   */
  if (ctx.db.knownGoodPages().length === 0) {
    log.info('no known ONT pages yet; running discovery (this takes a few seconds)');
    await discover(ctx.db, ctx.ont, { dump: false }).catch((err) => log.error('discovery failed', err));
  }

  // -- collectors ----------------------------------------------------------

  scheduler.add('probe', config.intervals.probeSec * 1000, () => collectProbes(ctx));
  scheduler.add('ont', config.intervals.ontPollSec * 1000, () => collectOnt(ctx));
  scheduler.add('presence', config.intervals.presenceSec * 1000, () => collectPresence(ctx));
  scheduler.add(
    'speedtest',
    config.intervals.speedtestMin * 60_000,
    () => collectSpeedtest(ctx),
    // Deliberately not immediate: a speed test during startup competes with
    // every other collector's first run and returns a pessimistic number that
    // then sits at the head of the chart forever. One that is already overdue
    // still runs shortly after boot rather than waiting out another full
    // interval - see `Scheduler.dueIn`.
    false,
  );
  scheduler.add(
    'maintenance',
    config.intervals.maintenanceMin * 60_000,
    async () => {
      rollup(ctx.db);
      prune(ctx.db);
      maybeVacuum(ctx.db);
      // A subscription set to renew is carried forward here as well as on the
      // read, so a line whose dashboard nobody opens for a month still has a
      // ledger with a month in it rather than one long silence.
      for (const s of rollRenewals(ctx.db)) {
        log.info(`subscription carried forward to ${new Date(s.endTs).toDateString()}`);
      }
      await checkUsageCap(ctx);
    },
    false,
  );

  // -- http ----------------------------------------------------------------

  const tls =
    config.server.tlsCert && config.server.tlsKey
      ? {
          cert: readFileSync(config.server.tlsCert),
          key: readFileSync(config.server.tlsKey),
        }
      : null;

  /*
   * Two calls rather than one with a conditional option: the overload that
   * types the instance is picked from the shape of the object literal, and a
   * ternary inside the call hands it a union it resolves to the http2 server.
   */
  const app: FastifyInstance = tls
    ? Fastify({ logger: false, bodyLimit: 256 * 1024, https: tls })
    : Fastify({ logger: false, bodyLimit: 256 * 1024 });
  await app.register(fastifyWebsocket);

  registerRoutes(app, ctx, scheduler);
  registerWebSocket(app, ctx);

  if (existsSync(config.server.webRoot)) {
    await app.register(fastifyStatic, { root: config.server.webRoot, index: ['index.html'] });
    // Client-side routing: anything that is not an API call or a real file is
    // the PWA shell.
    app.setNotFoundHandler(async (req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
      return reply.sendFile('index.html');
    });
  } else {
    log.warn(`no built PWA at ${config.server.webRoot}; serving the API only (run "npm run build")`);
  }

  await app.listen({ host: config.server.host, port: config.server.port });
  announce(tls !== null);

  // -- shutdown ------------------------------------------------------------

  let closing = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;
    log.info(`${signal} received, shutting down`);
    scheduler.stop();
    // Stamp the heartbeat on the way out so a clean restart is not mistaken
    // for a power cut on the next boot. The flag beside it is what separates
    // "someone restarted the monitor" from "the monitor died with the light",
    // which is the difference between a hole in the timeline and a blackout.
    ctx.power.markCleanShutdown();
    ctx.db.setMeta('heartbeat', String(Date.now()));
    await app.close().catch(() => {});
    ctx.db.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  // A collector bug should show up in the log, not silently kill the monitor
  // at 3am and leave a fortnight-long hole in the history.
  process.on('unhandledRejection', (reason) => log.error('unhandled rejection', reason));
  process.on('uncaughtException', (err) => log.error('uncaught exception', err));
}

main().catch((err) => {
  log.error('failed to start', err);
  process.exit(1);
});
