import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SubscriptionInput } from '@waifai/shared';
import { Db } from '../db/index.ts';
import { rollRenewals, subscriptionSummary } from './subscription.ts';

/**
 * Tests for the one thing here that is not obvious: which of several recorded
 * windows is the current one.
 *
 * The arithmetic is trivial and the wrong answer is not: a renewal bought a
 * week early overlaps the window it replaces, and a lapsed line still has a
 * most recent subscription that is emphatically not the current one. Both
 * mistakes draw a perfectly convincing countdown, which is what makes them
 * worth pinning down.
 */

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 3, 12, 0, 0); // 3 Sep 2026, midday

function memoryDb(): Db {
  return new Db(':memory:');
}

function paid(startDaysAgo: number, lengthDays: number, plan = ''): SubscriptionInput {
  const startTs = NOW - startDaysAgo * DAY;
  return {
    paidTs: startTs,
    startTs,
    endTs: startTs + lengthDays * DAY,
    plan,
    amount: null,
    reference: null,
    note: null,
    autoRenew: false,
    assumed: false,
  };
}

/**
 * A local calendar instant.
 *
 * Local rather than UTC because every date in this feature was typed into a
 * date field on somebody's phone, and a renewal that lands on the 3rd has to
 * land on the 3rd in the timezone the household lives in, whatever the box
 * running the tests is set to.
 */
function at(year: number, month: number, day: number, hour = 0): number {
  return new Date(year, month - 1, day, hour).getTime();
}

/** A month bought on a day, renewing on the day it runs out. */
function monthly(
  from: [number, number, number],
  to: [number, number, number],
  extra: Partial<SubscriptionInput> = {},
): SubscriptionInput {
  const startTs = at(...from);
  return {
    paidTs: startTs,
    startTs,
    endTs: at(...to),
    plan: '50 Mbps',
    amount: 30_000,
    reference: 'MTN-0001',
    note: null,
    autoRenew: true,
    assumed: false,
    ...extra,
  };
}

test('nothing recorded says so rather than inventing a window', () => {
  const db = memoryDb();
  const s = subscriptionSummary(db, NOW);
  assert.equal(s.current, null);
  assert.equal(s.previous, null);
  assert.equal(s.remainingSec, null);
  assert.equal(s.elapsedFraction, null);
  assert.equal(s.typicalDays, null);
  db.close();
});

test('the window covering today is the current one, and it counts down', () => {
  const db = memoryDb();
  db.addSubscription(paid(10, 30));
  const s = subscriptionSummary(db, NOW);
  assert.equal(s.current?.plan, '');
  assert.equal(s.remainingSec, 20 * 86_400);
  assert.equal(Math.round((s.elapsedFraction ?? 0) * 100), 33);
  db.close();
});

test('an early renewal is the upcoming one, not a subscription that failed to start', () => {
  const db = memoryDb();
  const running = db.addSubscription(paid(25, 30, 'running'));
  db.addSubscription(paid(-5, 30, 'renewal')); // starts in five days
  const s = subscriptionSummary(db, NOW);
  assert.equal(s.current?.id, running.id);
  assert.equal(s.upcoming?.plan, 'renewal');
  // The countdown stays on the window actually carrying the line today.
  assert.equal(s.remainingSec, 5 * 86_400);
  db.close();
});

test('the soonest of two future windows is the one being waited for', () => {
  const db = memoryDb();
  db.addSubscription(paid(-40, 30, 'later'));
  db.addSubscription(paid(-6, 30, 'next'));
  assert.equal(subscriptionSummary(db, NOW).upcoming?.plan, 'next');
  db.close();
});

test('a lapsed line has no current window, and the countdown goes negative', () => {
  const db = memoryDb();
  db.addSubscription(paid(33, 30, 'lapsed'));
  const s = subscriptionSummary(db, NOW);
  assert.equal(s.current, null);
  assert.equal(s.previous?.plan, 'lapsed');
  // Three days unpaid, which is the same subtraction as the countdown.
  assert.equal(s.remainingSec, -3 * 86_400);
  db.close();
});

test('overlapping windows resolve to the one that started most recently', () => {
  const db = memoryDb();
  db.addSubscription(paid(20, 40, 'old'));
  const newer = db.addSubscription(paid(2, 30, 'new'));
  assert.equal(subscriptionSummary(db, NOW).current?.id, newer.id);
  db.close();
});

test('the typical length is the median, so one mistyped year cannot move it', () => {
  const db = memoryDb();
  db.addSubscription(paid(120, 30));
  db.addSubscription(paid(90, 30));
  db.addSubscription(paid(60, 365)); // a year typed where a month was meant
  db.addSubscription(paid(30, 30));
  assert.equal(subscriptionSummary(db, NOW).typicalDays, 30);
  db.close();
});

test('an edit rewrites the record rather than adding a second one', () => {
  const db = memoryDb();
  const first = db.addSubscription(paid(10, 30, 'guessed'));
  db.updateSubscription(first.id, { plan: 'FibreX 25 Mbps', amount: 25_000 });
  const s = subscriptionSummary(db, NOW);
  assert.equal(s.history.length, 1);
  assert.equal(s.current?.plan, 'FibreX 25 Mbps');
  assert.equal(s.current?.amount, 25_000);
  // Untouched fields survive the merge.
  assert.equal(s.current?.startTs, first.startTs);
  db.close();
});

/* -- carrying a window forward --------------------------------------------- */

/**
 * The half of this that writes.
 *
 * These tests are the only place the renewal's two decisions are pinned down -
 * where the next window starts and how long it runs - and both have a wrong
 * answer that draws a perfectly convincing countdown: a chain built on 30 days
 * walks backwards through the calendar, and one built on the expiry instant
 * rather than the boundary drifts a day every time a date is corrected.
 */

test('a window set to renew carries itself forward on the day it runs out', () => {
  const db = memoryDb();
  db.addSubscription(monthly([2026, 9, 3], [2026, 10, 3]));

  const rolled = rollRenewals(db, at(2026, 10, 3, 7));
  assert.equal(rolled.length, 1);

  const next = rolled[0]!;
  assert.equal(next.startTs, at(2026, 10, 3));
  assert.equal(next.endTs, at(2026, 11, 3));
  assert.equal(next.plan, '50 Mbps');
  assert.equal(next.amount, 30_000);
  // Written down as what it is, and without the last month's receipt number.
  assert.equal(next.assumed, true);
  assert.equal(next.reference, null);

  // And it is the window the line is running on, not merely a row in a table.
  assert.equal(subscriptionSummary(db, at(2026, 10, 3, 7)).current?.id, next.id);
  db.close();
});

test('a window nobody set to renew stays expired', () => {
  const db = memoryDb();
  db.addSubscription(monthly([2026, 9, 3], [2026, 10, 3], { autoRenew: false }));
  assert.equal(rollRenewals(db, at(2026, 10, 8)).length, 0);
  assert.equal(subscriptionSummary(db, at(2026, 10, 8)).current, null);
  db.close();
});

test('rolling again while the window still runs writes nothing', () => {
  const db = memoryDb();
  db.addSubscription(monthly([2026, 9, 3], [2026, 10, 3]));
  rollRenewals(db, at(2026, 10, 3, 7));
  assert.equal(rollRenewals(db, at(2026, 10, 3, 9)).length, 0);
  assert.equal(subscriptionSummary(db, at(2026, 10, 3, 9)).history.length, 2);
  db.close();
});

test('months are calendar months, so the renewal day never slides', () => {
  const db = memoryDb();
  db.addSubscription(monthly([2026, 9, 3], [2026, 10, 3]));

  // Away from the dashboard until February: five months arrive at once, each
  // starting where the last one ended, and the third of the month stays the
  // third of the month across a 31-day October and a 28-day February.
  const rolled = rollRenewals(db, at(2027, 2, 10));
  assert.deepEqual(
    rolled.map((r) => r.startTs),
    [at(2026, 10, 3), at(2026, 11, 3), at(2026, 12, 3), at(2027, 1, 3), at(2027, 2, 3)],
  );
  assert.equal(subscriptionSummary(db, at(2027, 2, 10)).current?.startTs, at(2027, 2, 3));
  db.close();
});

test('an anniversary the calendar has clamped stays clamped', () => {
  const db = memoryDb();
  db.addSubscription(monthly([2027, 1, 31], [2027, 2, 28]));
  // A month after the 28th of February is the 28th of March, not the 31st.
  // Once February has shortened an anniversary there is nothing in the record
  // that remembers it was ever the 31st, and putting the three days back would
  // be this file guessing at MTN's billing rather than at its own arithmetic.
  assert.equal(rollRenewals(db, at(2027, 3, 1))[0]?.endTs, at(2027, 3, 28));
  db.close();
});

test('an expiry written as the last instant of a day keeps that shape', () => {
  const db = memoryDb();
  db.addSubscription(
    monthly([2026, 9, 3], [2026, 10, 3], { endTs: at(2026, 10, 3) - 1 }), // 2 Oct, 23:59:59.999
  );

  const next = rollRenewals(db, at(2026, 10, 3, 7))[0]!;
  // Both ways of writing an expiry hand over the same midnight...
  assert.equal(next.startTs, at(2026, 10, 3));
  // ...and the ledger does not start alternating between the 2nd and the 3rd.
  assert.equal(next.endTs, at(2026, 11, 3) - 1);
  db.close();
});

test('a window that is not a whole month renews for the same span', () => {
  const db = memoryDb();
  db.addSubscription(monthly([2026, 9, 3], [2026, 9, 13], { plan: '10-day top-up' }));
  const next = rollRenewals(db, at(2026, 9, 14))[0]!;
  assert.equal(next.startTs, at(2026, 9, 13));
  assert.equal(next.endTs, at(2026, 9, 23));
  db.close();
});

test('a renewal rolls from the window ending last, not the one starting last', () => {
  const db = memoryDb();
  db.addSubscription(monthly([2026, 9, 3], [2026, 10, 3]));
  // A week bought mid-month on top of the running month: it starts later and
  // ends first, and rolling from it would begin a renewal inside a month that
  // is already paid for.
  db.addSubscription(monthly([2026, 9, 20], [2026, 9, 27], { autoRenew: false }));

  assert.equal(rollRenewals(db, at(2026, 10, 4))[0]?.startTs, at(2026, 10, 3));
  db.close();
});

test('a line left for years stops rolling rather than inventing a decade', () => {
  const db = memoryDb();
  db.addSubscription(monthly([2026, 9, 3], [2026, 10, 3]));
  const rolled = rollRenewals(db, at(2031, 1, 1));
  assert.equal(rolled.length, 24);
  // Nothing covers today, so the countdown reads as expired - which is the
  // honest answer about a line nobody has looked at in four years.
  assert.equal(subscriptionSummary(db, at(2031, 1, 1)).current, null);
  db.close();
});
