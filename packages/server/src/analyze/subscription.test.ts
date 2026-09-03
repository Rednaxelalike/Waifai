import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SubscriptionInput } from '@waifai/shared';
import { Db } from '../db/index.ts';
import { subscriptionSummary } from './subscription.ts';

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
