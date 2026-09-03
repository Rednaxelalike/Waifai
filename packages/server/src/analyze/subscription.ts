import type { Subscription, SubscriptionSummary } from '@waifai/shared';
import type { Db } from '../db/index.ts';

/**
 * Where the line stands on being paid for.
 *
 * The only analysis in this project with no measurement behind it: every
 * number here comes from dates somebody typed after paying MTN. It still
 * belongs on the server rather than in the phone, because "which of these
 * windows is the current one" has more than one wrong answer - a renewal
 * bought a week early overlaps the one it replaces, and a lapsed line has a
 * most recent subscription that is emphatically not the current one.
 */

const DAY = 86_400_000;

/** How many past windows the typical length is taken from. */
const TYPICAL_SAMPLE = 6;

export function subscriptionSummary(db: Db, now = Date.now()): SubscriptionSummary {
  const history = db.listSubscriptions(); // newest start first

  /*
   * Overlaps are legitimate - buy the next month before this one runs out and
   * two windows cover the same evening - so the newest start wins, which is
   * what `history` is already ordered by.
   */
  const current = history.find((s) => s.startTs <= now && s.endTs > now) ?? null;

  // The soonest one still to begin, so an early renewal shows up as itself
  // rather than as a subscription that has somehow not started.
  const upcoming = history.filter((s) => s.startTs > now).at(-1) ?? null;

  const previous = history.find((s) => s.endTs <= now) ?? null;

  /*
   * One number for two questions. While a subscription is running it is the
   * countdown; once it has lapsed the same subtraction goes negative and says
   * how long the line has been running unpaid, which is worth exactly as much.
   */
  const reference = current ?? previous;
  const remainingSec = reference === null ? null : Math.round((reference.endTs - now) / 1000);

  const elapsedFraction =
    current === null
      ? null
      : clamp01((now - current.startTs) / Math.max(1, current.endTs - current.startTs));

  return {
    now,
    current,
    upcoming,
    previous,
    remainingSec,
    elapsedFraction,
    typicalDays: typicalDays(history),
    history,
  };
}

/**
 * What a subscription on this line usually runs for, in whole days.
 *
 * The median rather than the mean, and taken from the recent few, because one
 * mistyped year would drag an average into nonsense and this number's whole
 * job is to be the pre-filled expiry date on the next payment.
 */
function typicalDays(history: Subscription[]): number | null {
  const lengths = history
    .slice(0, TYPICAL_SAMPLE)
    .map((s) => Math.round((s.endTs - s.startTs) / DAY))
    .filter((d) => d > 0)
    .sort((a, b) => a - b);
  if (lengths.length === 0) return null;
  return lengths[Math.floor(lengths.length / 2)] ?? null;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}
