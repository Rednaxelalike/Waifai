import type { UsageSummary } from '@waifai/shared';

/**
 * Saying which month "this month" is.
 *
 * The usage cards lead with a total and call it "this month", and until the
 * server started sending the window with the numbers that was the one thing on
 * them nobody could check. Two readers get it wrong in opposite directions: on
 * a plan that bills from the 5th the window is not the calendar month at all,
 * and on a plan that bills from the 1st it is - but the card never says so, so
 * the figure is read as "since some point" and trusted about that much.
 *
 * These take the dates as the server cut them, in the household's timezone,
 * and never re-derive a day from the phone's clock.
 */

/**
 * An ISO day as a Date at local noon.
 *
 * `new Date('2026-09-01')` is midnight UTC, which west of Greenwich is the
 * evening before - the date would print a day early for half the world. Noon
 * is far enough from both edges that no offset can move the date.
 */
function at(iso: string): Date {
  return new Date(`${iso}T12:00:00`);
}

/** "3 Sep", carrying the year only when it is not the current one. */
export function formatDay(iso: string): string {
  const d = at(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(
    undefined,
    sameYear
      ? { day: 'numeric', month: 'short' }
      : { day: 'numeric', month: 'short', year: 'numeric' },
  );
}

/**
 * The window, named as shortly as it can be named honestly.
 *
 * A cycle that runs the length of one calendar month is that month, and
 * "September" is what a person would call it. One that straddles two has no
 * name, so it gets its endpoints: "5 Aug – 4 Sep". The en dash is deliberate;
 * it is a range, not a subtraction.
 */
export function cycleLabel(usage: Pick<UsageSummary, 'cycleStart' | 'cycleEnd'>): string {
  const start = at(usage.cycleStart);
  const end = at(usage.cycleEnd);
  const sameYear = start.getFullYear() === new Date().getFullYear();

  if (start.getDate() === 1 && start.getMonth() === end.getMonth()) {
    return start.toLocaleDateString(
      undefined,
      sameYear ? { month: 'long' } : { month: 'long', year: 'numeric' },
    );
  }

  return `${formatDay(usage.cycleStart)} – ${formatDay(usage.cycleEnd)}`;
}

/**
 * How far into the cycle today is, in days.
 *
 * This is what makes the projection legible: "550 GB by month end" means one
 * thing on day 3 of 30 and quite another on day 27, and the card had no way of
 * saying which it was standing on.
 */
export function cycleProgress(
  usage: Pick<UsageSummary, 'cycleStart' | 'cycleEnd' | 'today'>,
): { day: number; of: number } {
  const day = daysBetween(usage.cycleStart, usage.today) + 1;
  const of = daysBetween(usage.cycleStart, usage.cycleEnd) + 1;
  // A clock that has drifted past the boundary should not read "day 32 of 31".
  return { day: Math.min(Math.max(1, day), of), of };
}

function daysBetween(a: string, b: string): number {
  return Math.round((at(b).getTime() - at(a).getTime()) / 86_400_000);
}
