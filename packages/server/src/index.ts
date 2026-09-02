import { existsSync } from 'node:fs';
import Fastify from 'fastify';
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
import { defaultGateway } from './probes/ping.ts';
import { discover } from './ont/discover.ts';

const log = logger('main');

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
      await checkUsageCap(ctx);
    },
    false,
  );

  // -- http ----------------------------------------------------------------

  const app = Fastify({ logger: false, bodyLimit: 256 * 1024 });
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
  log.info(`waifai listening on http://${config.server.host}:${config.server.port}`);

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
