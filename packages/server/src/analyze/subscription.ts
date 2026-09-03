import type { Subscription, SubscriptionInput, SubscriptionSummary } from '@waifai/shared';
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

/* -- carrying a window forward --------------------------------------------- */

/**
 * How many windows one call will roll forward.
 *
 * A guard rather than a policy. The loop stops when the newest window covers
 * today, so the only way to reach this number is a database that was left
 * behind for two years, and rolling two years of assumed months in one go
 * would fill the ledger with rows nobody will ever confirm. It stops, and the
 * countdown reads as expired, which is the honest answer for a line nobody has
 * looked at since.
 */
const MAX_ROLLS = 24;

/** The most months a window is allowed to run before it is treated as a span. */
const MAX_TERM_MONTHS = 24;

/**
 * Roll every expired auto-renewing window on to the next one.
 *
 * The one thing in this file that writes. It exists because the household
 * renews on the day the line runs out, at the same price, every month: the
 * dates that follow from that are arithmetic, and the only thing asking for
 * them again each month would add is a morning when nobody remembered.
 *
 * What it writes is explicitly an assumption - see `assumed` on the record.
 * The server has no way to know MTN was paid; it knows what this line has
 * always done. The two are different claims and the flag is what keeps them
 * apart, so the phone can draw a countdown and still say where it came from.
 *
 * Idempotent, and safe to call from anywhere: with nothing expired it is one
 * query and no writes.
 */
export function rollRenewals(db: Db, now = Date.now()): Subscription[] {
  const created: Subscription[] = [];

  /*
   * The window ending last, not the one starting last. They are usually the
   * same row and the difference is the case that matters: a short window
   * bought inside a longer one starts later and ends first, and rolling from
   * it would write a renewal that begins in the middle of a month already
   * paid for.
   */
  let head = lastEnding(db.listSubscriptions());

  while (head !== null && head.autoRenew && head.endTs <= now && created.length < MAX_ROLLS) {
    head = db.addSubscription(nextWindow(head));
    created.push(head);
  }

  return created;
}

/**
 * The window that follows this one.
 *
 * Exported for the tests, which is the only way to pin down the two decisions
 * in it: where the next window starts, and how long it runs.
 */
export function nextWindow(prev: Subscription): SubscriptionInput {
  /*
   * The boundary, not the expiry instant. An expiry is entered as a day and
   * stored as the last millisecond of it, so a window running to the end of
   * the 2nd and one running to the start of the 3rd are the same fact written
   * two ways, and both have to hand the next window the same midnight.
   */
  const startTs = nearestMidnight(prev.endTs);

  const months = wholeMonths(prev.startTs, startTs);
  const boundary =
    months === null ? startTs + (startTs - prev.startTs) : addMonths(startTs, months);

  return {
    // The habit, written down: the payment is made on the day the last one
    // ran out, which is the day this one starts.
    paidTs: startTs,
    startTs,
    // Whichever way the expiry was written the first time, written the same
    // way again, so a ledger of rolled months does not alternate between the
    // 2nd and the 3rd.
    endTs: prev.endTs < startTs ? boundary - 1 : boundary,
    plan: prev.plan,
    amount: prev.amount,
    // Deliberately not carried. A reference identifies one payment at the
    // bank; copying it onto a month that has no receipt would forge exactly
    // the thing a support desk asks for.
    reference: null,
    note: null,
    autoRenew: true,
    assumed: true,
  };
}

/** The window ending last, or null when there are none. */
function lastEnding(history: Subscription[]): Subscription | null {
  return history.reduce<Subscription | null>(
    (best, s) => (best === null || s.endTs > best.endTs ? s : best),
    null,
  );
}

/**
 * A month later, on the same day of the month.
 *
 * Days would be wrong here. A subscription bought on the 3rd of one month runs
 * to the 3rd of the next whether that is 28 days away or 31, and a renewal
 * chain built on a fixed 30 would walk backwards through the calendar until
 * the day it renews on has nothing to do with the day it was bought on.
 *
 * The clamp is for the end of the month: the 31st of January plus a month is
 * the 28th of February, not the 3rd of March, which is where the Date
 * constructor puts it. A clamped anniversary then stays where it landed - the
 * 28th, not back to the 31st in March - because by that point nothing in the
 * record remembers a 31st. It costs three days once, to a line bought after
 * the 28th of a month, and it is the only alternative to this file inventing a
 * date MTN never agreed to.
 */
function addMonths(ts: number, months: number): number {
  const d = new Date(ts);
  const target = new Date(
    d.getFullYear(),
    d.getMonth() + months,
    1,
    d.getHours(),
    d.getMinutes(),
    d.getSeconds(),
    d.getMilliseconds(),
  );
  const lastDayOfMonth = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d.getDate(), lastDayOfMonth));
  return target.getTime();
}

/**
 * How many whole months a window ran, or null when it was not a month at all.
 *
 * Asked by trying rather than by arithmetic on month numbers, because the
 * question is exactly "would adding months have produced this date" - and a
 * window that started on the 31st has an answer that only `addMonths` and its
 * clamp know.
 */
function wholeMonths(startTs: number, boundaryTs: number): number | null {
  for (let m = 1; m <= MAX_TERM_MONTHS; m++) {
    const end = addMonths(startTs, m);
    if (end === boundaryTs) return m;
    if (end > boundaryTs) return null;
  }
  return null;
}

/**
 * The midnight this instant is closest to, in the machine's own timezone.
 *
 * Both ways of writing an expiry - the last millisecond of the 2nd, the first
 * of the 3rd - land on the same midnight, so the renewal chain does not drift
 * by a day when somebody corrects a date through the form.
 */
function nearestMidnight(ts: number): number {
  const d = new Date(ts);
  const floor = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const ceil = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  return ts - floor <= ceil - ts ? floor : ceil;
}
