import { config } from '../config.ts';
import type { Db } from '../db/index.ts';
import { logger } from '../log.ts';

const log = logger('rollup');

const HOUR_MS = 3_600_000;

/**
 * Compaction. Raw samples arrive every 20-60 seconds, which is roughly 1.5
 * million rows a year - fine for a laptop, not fine for an SD card in a Pi
 * that also has to answer dashboard queries.
 *
 * So raw data lives for a couple of weeks at full resolution, and hourly
 * summaries live for years. The summaries are what the long-range charts and
 * the optical drift regression read from, and they are about 8,700 rows a
 * year, which is nothing.
 *
 * Rollups are idempotent: re-running over the same hour replaces it rather
 * than double-counting, so a crash mid-sweep is harmless.
 */
export function rollup(db: Db, now = Date.now()): void {
  // Never roll up the hour still in progress; it would be replaced anyway and
  // would briefly show a misleadingly low average.
  const cutoff = Math.floor(now / HOUR_MS) * HOUR_MS;
  const lastDone = Number(db.getMeta('rollup_through') ?? '0');
  const from = lastDone || cutoff - 48 * HOUR_MS;
  if (from >= cutoff) return;

  const t0 = performance.now();
  db.raw.exec('BEGIN');
  try {
    db.raw
      .prepare(
        `INSERT INTO optical_hourly (hour, rx_avg, rx_min, rx_max, tx_avg, temp_avg, n)
         SELECT (ts / ${HOUR_MS}) * ${HOUR_MS} AS hour,
                AVG(rx), MIN(rx), MAX(rx), AVG(tx), AVG(temp), COUNT(*)
         FROM optical_samples
         WHERE ts >= ? AND ts < ?
         GROUP BY hour
         ON CONFLICT(hour) DO UPDATE SET
           rx_avg = excluded.rx_avg, rx_min = excluded.rx_min, rx_max = excluded.rx_max,
           tx_avg = excluded.tx_avg, temp_avg = excluded.temp_avg, n = excluded.n`,
      )
      .run(from, cutoff);

    // SQLite has no percentile function, so p95 is approximated with the mean
    // plus two standard deviations. For latency distributions that runs a
    // little high, which is the safe direction for a "worst case" figure.
    db.raw
      .prepare(
        `INSERT INTO probe_hourly (hour, tier, rtt_avg, rtt_p95, loss_avg, n)
         SELECT (ts / ${HOUR_MS}) * ${HOUR_MS} AS hour, tier,
                AVG(rtt),
                AVG(rtt) + 2 * COALESCE(
                  (AVG(rtt * rtt) - AVG(rtt) * AVG(rtt)), 0) / NULLIF(ABS(AVG(rtt)), 0),
                AVG(loss), COUNT(*)
         FROM probe_samples
         WHERE ts >= ? AND ts < ?
         GROUP BY hour, tier
         ON CONFLICT(hour, tier) DO UPDATE SET
           rtt_avg = excluded.rtt_avg, rtt_p95 = excluded.rtt_p95,
           loss_avg = excluded.loss_avg, n = excluded.n`,
      )
      .run(from, cutoff);

    db.raw
      .prepare(
        `INSERT INTO throughput_hourly (hour, down_avg, up_avg, down_max, up_max, n)
         SELECT (ts / ${HOUR_MS}) * ${HOUR_MS} AS hour,
                AVG(down_bps), AVG(up_bps), MAX(down_bps), MAX(up_bps), COUNT(*)
         FROM throughput
         WHERE ts >= ? AND ts < ?
         GROUP BY hour
         ON CONFLICT(hour) DO UPDATE SET
           down_avg = excluded.down_avg, up_avg = excluded.up_avg,
           down_max = excluded.down_max, up_max = excluded.up_max, n = excluded.n`,
      )
      .run(from, cutoff);

    db.setMeta('rollup_through', String(cutoff));
    db.raw.exec('COMMIT');
  } catch (err) {
    db.raw.exec('ROLLBACK');
    log.error('rollup failed', err);
    return;
  }
  log.debug(`rollup complete in ${Math.round(performance.now() - t0)}ms`);
}

/**
 * Delete raw samples that have been rolled up and are past the retention
 * window. Incidents, speedtests, usage and devices are never pruned here -
 * they are small and they are the historical record.
 */
export function prune(db: Db, now = Date.now()): void {
  const rawCutoff = now - config.db.rawRetentionDays * 86400_000;
  const rollupCutoff = now - config.db.rollupRetentionDays * 86400_000;
  const rolledThrough = Number(db.getMeta('rollup_through') ?? '0');
  // Refuse to delete anything that has not been summarised yet.
  const safeCutoff = Math.min(rawCutoff, rolledThrough);
  if (safeCutoff <= 0) return;

  const deleted =
    del(db, 'DELETE FROM optical_samples WHERE ts < ?', safeCutoff) +
    del(db, 'DELETE FROM probe_samples WHERE ts < ?', safeCutoff) +
    del(db, 'DELETE FROM throughput WHERE ts < ?', safeCutoff) +
    del(db, 'DELETE FROM wan_samples WHERE ts < ?', safeCutoff) +
    del(db, 'DELETE FROM optical_hourly WHERE hour < ?', rollupCutoff) +
    del(db, 'DELETE FROM probe_hourly WHERE hour < ?', rollupCutoff) +
    del(db, 'DELETE FROM throughput_hourly WHERE hour < ?', rollupCutoff) +
    // Closed presence sessions older than the raw window; open ones are kept.
    del(db, 'DELETE FROM presence WHERE end IS NOT NULL AND end < ?', safeCutoff);

  if (deleted > 0) log.info(`pruned ${deleted} rows`);
}

function del(db: Db, sql: string, arg: number): number {
  return Number(db.raw.prepare(sql).run(arg).changes ?? 0);
}

/**
 * Reclaim the freed pages. Only worth doing occasionally - it rewrites the
 * whole file, which is slow on an SD card and pointless to do hourly.
 */
export function maybeVacuum(db: Db, now = Date.now()): void {
  const last = Number(db.getMeta('last_vacuum') ?? '0');
  if (now - last < 7 * 86400_000) return;
  const t0 = performance.now();
  db.raw.exec('VACUUM');
  db.setMeta('last_vacuum', String(now));
  log.info(`vacuum complete in ${Math.round(performance.now() - t0)}ms`);
}
