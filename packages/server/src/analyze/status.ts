import {
  formatDuration,
  rxPowerBand,
  type OverallStatus,
  type PowerNow,
  type StatusSnapshot,
} from '@waifai/shared';
import type { AppContext } from '../context.ts';

/**
 * Builds the single payload behind the "is the internet working?" card.
 *
 * The headline is written for the housemate who does not care about dBm. It
 * has to answer three things in one sentence: is it broken, is it my fault or
 * theirs, and is anyone already dealing with it. Everything else on the
 * dashboard is for whoever is doing the dealing.
 */
export function buildStatus(ctx: AppContext): StatusSnapshot {
  const now = Date.now();
  const optical = ctx.db.latestOptical();
  const wan = ctx.db.latestWan();
  const throughput = ctx.db.latestThroughput();
  const probes = ctx.db.latestProbes();
  const active = ctx.db.activeIncident();
  const lastSpeedtest = ctx.db.latestSpeedtest();
  const devicesOnline = ctx.db.countOnlineDevices();
  const power = ctx.power.now();

  let status: OverallStatus = 'unknown';
  if (active) status = active.severity === 'critical' ? 'down' : 'degraded';
  else if (probes.length > 0) status = 'up';

  // Time since the last thing went wrong, which is what people mean by
  // "how long has it been stable".
  const lastClosed = ctx.db.lastClosedIncident();
  const uptimeSec =
    active !== null
      ? null
      : lastClosed?.end
        ? Math.round((now - lastClosed.end) / 1000)
        : Math.round((now - ctx.startedAt) / 1000);

  return {
    ts: now,
    status,
    headline: headlineFor(status, active, uptimeSec, optical?.rxPower ?? null, power),
    optical,
    wan,
    throughput,
    probes,
    devicesOnline,
    power,
    activeIncident: active,
    uptimeSec,
    lastSpeedtest,
  };
}

function headlineFor(
  status: OverallStatus,
  active: { kind: string; start: number } | null,
  uptimeSec: number | null,
  rxPower: number | null,
  power: PowerNow,
): string {
  if (status === 'unknown') return 'Still starting up - no readings yet.';

  /*
   * Being on the battery outranks everything else on this line. A working
   * connection, and a working connection with a clock running on it, call for
   * completely different behaviour from the house - and only one of them is
   * worth interrupting someone's evening over.
   */
  if (power.state === 'battery') {
    const since = formatDuration(Math.round((Date.now() - (power.since ?? Date.now())) / 1000));
    const outlook =
      power.batteryRuntimeSec !== null
        ? ' The pack usually lasts about ' + formatDuration(power.batteryRuntimeSec) + '.'
        : '';
    return 'The light is off - the router has been on the battery pack for ' + since + '.' + outlook;
  }

  if (active) {
    const since = formatDuration(Math.round((Date.now() - active.start) / 1000));
    switch (active.kind) {
      case 'pon_down':
        return `Internet is down (${since}). The fibre line itself has dropped - this is an MTN fault, not something in the house.`;
      case 'ont_unreachable':
        return `Internet is down (${since}). The router is not responding at all - check it has power and its lights are on.`;
      case 'wan_down':
        return `Internet is down (${since}). The router is fine but has no connection out. Often clears on its own; a reboot usually fixes it.`;
      case 'dns_failure':
        return `Pages are failing to load (${since}), though the line is up. MTN's name servers are struggling.`;
      case 'degraded':
        return `Internet is up but slow and unstable (${since}). Calls and video will stutter.`;
      default:
        return `Something is wrong (${since}).`;
    }
  }

  const band = rxPowerBand(rxPower);
  const stable = uptimeSec !== null ? `Stable for ${formatDuration(uptimeSec)}.` : '';
  if (band === 'poor') return `Internet is working, but the fibre signal is weak. ${stable}`.trim();
  if (band === 'fair') return `Internet is working. Fibre signal has little margin left. ${stable}`.trim();
  return `Internet is working normally. ${stable}`.trim();
}
