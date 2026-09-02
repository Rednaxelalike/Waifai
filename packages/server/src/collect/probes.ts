import { formatDuration, type ProbeSample, type ProbeTier } from '@waifai/shared';
import { config } from '../config.ts';
import type { AppContext } from '../context.ts';
import { logger } from '../log.ts';
import { pingAll } from '../probes/ping.ts';
import { resolveTimed } from '../probes/net.ts';
import type { HealthInput } from '../analyze/incidents.ts';
import { batteryHoldWarning, type PowerChange } from '../analyze/power.ts';
import { buildStatus } from '../analyze/status.ts';

const log = logger('collect:probe');

/**
 * The heartbeat of the whole system.
 *
 * This runs every 20 seconds or so and is what gives outage detection its
 * resolution. The ONT poll is far richer but far slower - a minute's gap means
 * a 90-second outage could go unnoticed entirely - so up/down is decided here
 * and the ONT poll only supplies the *why*.
 */
export async function collectProbes(ctx: AppContext): Promise<void> {
  const ts = Date.now();

  // Build the target list, tagged by tier. The tiers are what let the incident
  // classifier say "the fibre dropped" instead of "the internet broke".
  const targets: { host: string; tier: ProbeTier }[] = [{ host: config.probes.ont, tier: 'ont' }];

  const gateway = config.probes.gateway || ctx.gateway;
  // On MTN FibreX the ONT usually is the gateway. Probing it twice would just
  // double the traffic and tell us nothing new.
  if (gateway && gateway !== config.probes.ont) targets.push({ host: gateway, tier: 'gateway' });
  for (const host of config.probes.internet) targets.push({ host, tier: 'internet' });
  for (const host of config.probes.localNg) targets.push({ host, tier: 'local_ng' });

  const results = await pingAll(
    targets.map((t) => t.host),
    config.probes.count,
    config.probes.timeoutMs,
  );
  const byHost = new Map(results.map((r) => [r.target, r]));

  const samples: ProbeSample[] = [];
  for (const { host, tier } of targets) {
    const r = byHost.get(host);
    if (!r) continue;
    const sample: ProbeSample = {
      ts,
      target: host,
      tier,
      rttMs: r.rttMs,
      jitterMs: r.jitterMs,
      loss: r.loss,
      ok: r.ok,
    };
    samples.push(sample);
    ctx.db.insertProbe(sample);
  }

  // DNS is only worth testing when there is a route out; otherwise it fails
  // for the obvious reason and would mask the real fault.
  const internetSamples = samples.filter((s) => s.tier === 'internet');
  const internetOk = internetSamples.some((s) => s.ok);
  let dnsOk = true;
  if (internetOk && config.probes.dnsNames.length > 0) {
    const name = config.probes.dnsNames[ts % config.probes.dnsNames.length]!;
    const dns = await resolveTimed(name);
    dnsOk = dns.ok;
    const dnsSample: ProbeSample = {
      ts,
      target: `dns:${name}`,
      tier: 'dns',
      rttMs: dns.ms,
      jitterMs: null,
      loss: dns.ok ? 0 : 1,
      ok: dns.ok,
    };
    samples.push(dnsSample);
    ctx.db.insertProbe(dnsSample);
  }

  const okInternet = internetSamples.filter((s) => s.ok);
  const health: HealthInput = {
    ts,
    ontReachable: samples.find((s) => s.tier === 'ont')?.ok ?? false,
    ponUp: ctx.lastPonUp,
    gatewayOk: samples.find((s) => s.tier === 'gateway')?.ok ?? true,
    internetOk,
    dnsOk,
    // Best-case loss across targets: if Cloudflare is unreachable but Google
    // is perfect, that is Cloudflare's problem, not the household's.
    internetLoss: internetSamples.length
      ? Math.min(...internetSamples.map((s) => s.loss))
      : 1,
    internetRttMs: okInternet.length
      ? Math.min(...okInternet.map((s) => s.rttMs ?? Number.POSITIVE_INFINITY))
      : null,
  };

  const change = ctx.tracker.update(health);

  /*
   * Power is tracked off the same sweep, and answers a different question from
   * the incident log: not "whose fault is the outage" but "is there Wi-Fi at
   * all, and what is paying for it". The two disagree in exactly the cases
   * that matter - a fibre fault leaves the router happily on mains, and a
   * power cut leaves a fibre that is perfectly fine.
   */
  const power = ctx.power.update(ts, health.ontReachable);

  ctx.db.setMeta('heartbeat', String(ts));

  if (change.opened) {
    ctx.bus.emit({ type: 'incident_opened', payload: change.opened });
    await ctx.alerter.send({
      key: `incident:${change.opened.kind}`,
      title:
        change.opened.severity === 'critical'
          ? 'Internet is down'
          : 'Internet is having problems',
      body: change.opened.detail,
      priority: change.opened.severity === 'critical' ? 'urgent' : 'high',
      tags: change.opened.severity === 'critical' ? ['rotating_light'] : ['warning'],
    });
  }

  if (change.closed) {
    ctx.bus.emit({ type: 'incident_closed', payload: change.closed });
    // Recoveries bypass the cooldown: being told it is fixed is worth as much
    // as being told it broke, and by definition it happens only once.
    ctx.alerter.resolve(`incident:${change.closed.kind}`);
    await ctx.alerter.send({
      key: `recovered:${change.closed.id}`,
      title: 'Internet is back',
      body: `Back up after ${formatDuration(change.closed.durationSec ?? 0)} (${change.closed.kind.replace(/_/g, ' ')}).`,
      priority: 'normal',
      force: true,
      tags: ['white_check_mark'],
    });
  }

  if (power.opened) {
    ctx.bus.emit({ type: 'power', payload: ctx.power.now() });
    await announcePower(ctx, power);
  }

  // Checked every sweep rather than only on a transition: the message people
  // need is "it has been on the pack for 40 minutes", which is not a
  // transition at all.
  const holding = batteryHoldWarning(ctx.db, ts);
  if (holding) {
    await ctx.alerter.send({
      key: 'power:battery:holding',
      title: holding.title,
      body: holding.body,
      priority: 'high',
      tags: ['battery'],
    });
  }

  ctx.bus.emit({ type: 'status', payload: buildStatus(ctx) });

  log.debug(
    `sweep: ont=${health.ontReachable} pon=${health.ponUp} net=${health.internetOk} ` +
      `dns=${health.dnsOk} loss=${(health.internetLoss * 100).toFixed(0)}% rtt=${health.internetRttMs ?? '-'}`,
  );
}

/**
 * What is worth a phone notification about power, and what is not.
 *
 * Deliberately quiet about the router simply going dark: that already fires as
 * an `ont_unreachable` incident, and two buzzes for one event is how people
 * learn to swipe both away. The one case worth its own message is the pack
 * running flat, because that is the moment the Wi-Fi actually stops and it is
 * information the outage alert does not carry.
 */
async function announcePower(ctx: AppContext, change: PowerChange): Promise<void> {
  const opened = change.opened;
  if (!opened) return;
  const previous = change.closed?.state ?? null;

  if (opened.state === 'battery') {
    ctx.alerter.resolve('power:mains');
    await ctx.alerter.send({
      key: 'power:battery',
      title: 'The light has gone off',
      body: `${opened.detail} The Wi-Fi is still up, but the clock is now running on the pack.`,
      priority: 'high',
      tags: ['electric_plug'],
    });
    return;
  }

  if (opened.state === 'off' && previous === 'battery') {
    await ctx.alerter.send({
      key: 'power:off',
      title: 'The Wi-Fi has gone off',
      body:
        `The battery pack carried the router for ${formatDuration(change.closed?.durationSec ?? 0)} ` +
        'and has now run flat. There will be no Wi-Fi until the light comes back.',
      priority: 'urgent',
      force: true,
      tags: ['rotating_light'],
    });
    return;
  }

  // Nothing to celebrate on the very first sweep after a restart, when there
  // is no previous state and "the light is back" would be news to nobody.
  if (opened.state === 'mains' && previous !== null && previous !== 'mains') {
    for (const key of ['power:battery', 'power:battery:holding', 'power:off']) ctx.alerter.resolve(key);
    await ctx.alerter.send({
      key: 'power:mains',
      title: 'The light is back',
      body:
        previous === 'off'
          ? `Power is back and the router has restarted. The Wi-Fi was off for ${formatDuration(change.closed?.durationSec ?? 0)}.`
          : `Power is back after ${formatDuration(change.closed?.durationSec ?? 0)} on the battery pack. The Wi-Fi never dropped.`,
      priority: 'normal',
      force: true,
      tags: ['bulb'],
    });
  }
}
