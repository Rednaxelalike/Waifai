import type { UsageSummary } from '@waifai/shared';
import { config } from '../config.ts';
import type { Db } from '../db/index.ts';

/**
 * Data volume accounting, derived from the ONT's cumulative WAN byte counters.
 *
 * Days are bucketed in the household's local timezone rather than UTC. In
 * Lagos that is a one-hour shift, which is enough to move an evening of
 * streaming into "yesterday" and make the daily chart quietly wrong.
 */

const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: config.usage.timezone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Local calendar day as YYYY-MM-DD. */
export function localDay(ts: number): string {
  return dayFormatter.format(new Date(ts));
}

/** Local day-of-month, needed to find the billing cycle boundary. */
function localDayOfMonth(ts: number): number {
  return Number(localDay(ts).slice(8, 10));
}

/**
 * The first day of the current billing cycle. Counting usage from the cycle
 * boundary rather than the calendar month is the difference between a
 * projection that predicts your bill and one that does not.
 */
export function cycleStart(now = Date.now()): string {
  const today = localDay(now);
  const dom = localDayOfMonth(now);
  const startDay = Math.min(28, Math.max(1, config.usage.cycleStartDay));
  const [y, m] = today.split('-').map(Number);
  if (dom >= startDay) {
    return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(startDay).padStart(2, '0')}`;
  }
  // Still before this month's boundary, so the cycle began last month.
  const prev = new Date(Date.UTC(y!, m! - 2, startDay));
  return prev.toISOString().slice(0, 10);
}

/**
 * The last day of the current cycle, inclusive.
 *
 * The next boundary is the same day-of-month one month on, so the day before
 * it closes this one. That makes a cycle 28 to 31 days long depending on which
 * month it crosses, which is why the projection below counts them rather than
 * assuming. `cycleStart` clamps the boundary to the 28th, so stepping a month
 * forward from it can never land on a date the month does not have.
 */
export function cycleEnd(now = Date.now()): string {
  const [y, m, d] = cycleStart(now).split('-').map(Number);
  const next = new Date(Date.UTC(y!, m!, d!));
  next.setUTCDate(next.getUTCDate() - 1);
  return next.toISOString().slice(0, 10);
}

/**
 * Convert a pair of consecutive WAN counter readings into a byte delta.
 *
 * The ONT's counters reset to zero on reboot, and a naive subtraction then
 * produces a huge negative number, or - worse - if you clamp at zero you lose
 * the traffic. Treating a decrease as "counter reset, current value is the
 * delta" is the standard and correct handling.
 */
export function counterDelta(previous: number | null, current: number | null): number {
  if (current === null || !Number.isFinite(current) || current < 0) return 0;
  if (previous === null || !Number.isFinite(previous)) return 0;
  if (current >= previous) return current - previous;
  // Reset: everything since the reboot is new traffic.
  return current;
}

export function recordUsage(db: Db, downDelta: number, upDelta: number, ts = Date.now()): void {
  if (downDelta <= 0 && upDelta <= 0) return;
  db.addUsage(localDay(ts), Math.max(0, downDelta), Math.max(0, upDelta));
}

export function usageSummary(db: Db, now = Date.now()): UsageSummary {
  const from = cycleStart(now);
  const to = cycleEnd(now);
  const today = localDay(now);
  const days = db.usageBetween(from, today);

  const monthToDateBytes = days.reduce((a, d) => a + d.downBytes + d.upBytes, 0);

  // Straight-line projection across the cycle. Deliberately simple: a fancier
  // model would imply a confidence this data does not support. The length is
  // the cycle's own - a February cycle is three days shorter than a January
  // one, and a projection that always assumed 31 would overstate it by a tenth.
  const elapsedDays = Math.max(1, daysBetween(from, today) + 1);
  const cycleLengthDays = Math.max(elapsedDays, daysBetween(from, to) + 1);
  const projectedMonthBytes = Math.round((monthToDateBytes / elapsedDays) * cycleLengthDays);

  return {
    monthToDateBytes,
    projectedMonthBytes,
    capBytes: config.usage.capGb > 0 ? config.usage.capGb * 1024 ** 3 : null,
    days,
    cycleStart: from,
    cycleEnd: to,
    today,
  };
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const t1 = Date.UTC(ay!, am! - 1, ad!);
  const t2 = Date.UTC(by!, bm! - 1, bd!);
  return Math.round((t2 - t1) / 86400_000);
}

/** Fraction of the cap already used, or null when the plan is uncapped. */
export function capFraction(summary: UsageSummary): number | null {
  if (!summary.capBytes) return null;
  return summary.monthToDateBytes / summary.capBytes;
}
