import { formatBps, formatBytes, rxPowerBand } from '@waifai/shared';
import { config } from '../config.ts';
import { createContext } from '../context.ts';
import { collectOnt } from '../collect/ont.ts';
import { collectProbes } from '../collect/probes.ts';
import { collectPresence } from '../collect/presence.ts';
import { buildStatus } from '../analyze/status.ts';
import { defaultGateway } from '../probes/ping.ts';

/**
 * `npm run probe` - a single pass of every collector, printed to the terminal.
 *
 * This is the smoke test. It answers "is any of this actually working?"
 * without waiting for a dashboard to build up data, and it is the fastest way
 * to see which specific part is broken when something is.
 */
async function main(): Promise<void> {
  const ctx = createContext();
  ctx.gateway = config.probes.gateway || (await defaultGateway());

  console.log('Running one pass of every collector...\n');

  console.log('ONT poll');
  const t0 = performance.now();
  await collectOnt(ctx);
  const optical = ctx.db.latestOptical();
  const wan = ctx.db.latestWan();
  if (optical) {
    console.log(`  rx power     ${fmt(optical.rxPower)} dBm  (${rxPowerBand(optical.rxPower)})`);
    console.log(`  tx power     ${fmt(optical.txPower)} dBm`);
    console.log(`  temperature  ${fmt(optical.temperature)} C`);
    console.log(`  pon status   ${optical.ponStatus ?? '-'}`);
  } else {
    console.log('  no optical data read - run "npm run discover" to see why');
  }
  if (wan) {
    console.log(`  wan          ${wan.up ? 'up' : 'down'}  ip=${wan.ipv4 ?? '-'}`);
    console.log(`  counters     rx=${wan.rxBytes === null ? '-' : formatBytes(wan.rxBytes)} tx=${wan.txBytes === null ? '-' : formatBytes(wan.txBytes)}`);
  }
  console.log(`  took ${Math.round(performance.now() - t0)}ms\n`);

  console.log('Reachability');
  await collectProbes(ctx);
  for (const p of ctx.db.latestProbes()) {
    console.log(
      `  ${p.tier.padEnd(9)} ${p.target.padEnd(18)} ${p.ok ? 'ok  ' : 'FAIL'}  ` +
        `${p.rttMs === null ? '   -' : `${p.rttMs.toFixed(1)}ms`.padStart(8)}  loss ${Math.round(p.loss * 100)}%`,
    );
  }
  console.log();

  console.log('Presence');
  await collectPresence(ctx);
  const devices = ctx.db.listDevices().filter((d) => d.online);
  if (devices.length === 0) {
    console.log('  nothing found. If the sweep is disabled, set PRESENCE_SWEEP=1.');
  }
  for (const d of devices.slice(0, 25)) {
    console.log(
      `  ${d.mac}  ${(d.ip ?? '-').padEnd(15)}  ${(d.label ?? d.hostname ?? d.vendor ?? '?').slice(0, 32)}`,
    );
  }
  console.log();

  const status = buildStatus(ctx);
  console.log('Verdict');
  console.log(`  ${status.status.toUpperCase()}: ${status.headline}`);
  if (status.throughput) {
    console.log(`  current traffic: ${formatBps(status.throughput.downBps)} down, ${formatBps(status.throughput.upBps)} up`);
  }

  ctx.db.close();
}

function fmt(v: number | null): string {
  return v === null ? '   -' : v.toFixed(2).padStart(7);
}

main().catch((err) => {
  console.error('\nProbe failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
