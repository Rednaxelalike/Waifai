import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Db } from '../db/index.ts';
import { config } from '../config.ts';
import {
  PowerTracker,
  analyzePowerPatterns,
  batteryStats,
  decidePower,
  detectRotationalCycle,
  extractOutageIntervals,
  powerSummary,
  predictPowerRestoration,
} from './power.ts';

/**
 * Tests for the mains-versus-battery verdicts.
 *
 * Every claim this module makes is an inference from indirect evidence, which
 * is exactly the kind of code that fails silently: a wrong verdict still
 * renders a perfectly convincing timeline, and nobody finds out until they
 * plan an evening around a battery figure that was never measured. So the
 * cases pinned down below are the ones where being wrong would be invisible.
 */

const HOUR = 3_600_000;

function memoryDb(): Db {
  return new Db(':memory:');
}

// ---------------------------------------------------------------------------
// The verdict itself
// ---------------------------------------------------------------------------

test('a monitor on the wall socket is its own proof that the light is on', () => {
  const db = memoryDb();
  assert.equal(decidePower(db, true, false).state, 'mains');
  db.close();
});

test('a router that does not answer means no Wi-Fi, whatever the cause', () => {
  const db = memoryDb();
  assert.equal(decidePower(db, false, false).state, 'off');
  assert.equal(decidePower(db, false, true).state, 'off');
  db.close();
});

test('with no witnesses and a monitor on the pack, the answer is honestly unknown', () => {
  const db = memoryDb();
  // Nothing here can see a socket, and saying "mains" anyway would be a guess
  // dressed up as a reading.
  const verdict = decidePower(db, true, true);
  assert.equal(verdict.state, 'unknown');
  assert.match(verdict.because, /power witness/i);
  db.close();
});

test('every mains-only device going quiet at once is what battery looks like', () => {
  const db = memoryDb();
  const ts = Date.now();
  db.seeDevice({ mac: 'aa:bb:cc:00:00:01', ts });
  db.seeDevice({ mac: 'aa:bb:cc:00:00:02', ts });
  db.updateDeviceMeta('AA:BB:CC:00:00:01', { mainsWitness: true });
  db.updateDeviceMeta('AA:BB:CC:00:00:02', { mainsWitness: true });

  // One still answering is enough to say the light is on.
  assert.equal(decidePower(db, true, true).state, 'mains');

  db.markOffline(ts + 1);
  assert.equal(decidePower(db, true, true).state, 'battery');
  db.close();
});

// ---------------------------------------------------------------------------
// Live tracking
// ---------------------------------------------------------------------------

test('one dropped ping to the router is not a blackout', () => {
  const db = memoryDb();
  const tracker = new PowerTracker(db);
  const t = Date.now();
  const step = config.intervals.probeSec * 1000;

  tracker.update(t, true);
  const change = tracker.update(t + step, false);
  assert.equal(change.opened, undefined);
  assert.equal(db.currentPowerSpan()?.state, 'mains');
  db.close();
});

test('a sustained dark router opens a span backdated to when it went dark', () => {
  const db = memoryDb();
  const tracker = new PowerTracker(db);
  const t = Date.now();
  const step = config.intervals.probeSec * 1000;

  tracker.update(t, true);
  let opened;
  for (let i = 1; i <= config.power.confirmSamples; i++) {
    opened = tracker.update(t + i * step, false).opened ?? opened;
  }
  assert.equal(opened?.state, 'off');
  // Backdated to the first sweep that saw it, not the one that confirmed it.
  assert.ok(opened!.start <= t + step, 'the span should start at the first dark sweep');
  db.close();
});

// ---------------------------------------------------------------------------
// Reconstruction, which is where the router's uptime counter earns its keep
// ---------------------------------------------------------------------------

test('a monitor that died while the router stayed up is a battery hold', () => {
  const db = memoryDb();
  const tracker = new PowerTracker(db);
  const now = Date.now();

  db.setMeta('heartbeat', String(now - 3 * HOUR));
  tracker.beginGapReconstruction(now);
  // The router has been up since long before we died, so it never lost power:
  // the pack carried the Wi-Fi through the whole cut.
  tracker.noteOntBoot(now - 10 * HOUR);

  const spans = db.powerSpansBetween(0, now + 1);
  assert.equal(spans.length, 1);
  assert.equal(spans[0]!.state, 'battery');
  assert.equal(spans[0]!.source, 'reconstructed');
  assert.match(spans[0]!.detail, /never restarted/i);
  db.close();
});

test('a router that restarted mid-gap splits into an unclear stretch and mains', () => {
  const db = memoryDb();
  const tracker = new PowerTracker(db);
  const now = Date.now();

  db.setMeta('heartbeat', String(now - 3 * HOUR));
  tracker.beginGapReconstruction(now);
  tracker.noteOntBoot(now - 30 * 60_000);

  const spans = db.powerSpansBetween(0, now + 1);
  assert.equal(spans.length, 2);
  // The pack held for part of it and then gave out. Which minute that happened
  // is genuinely not knowable from here, and the span says so rather than
  // inventing a boundary.
  assert.equal(spans[0]!.state, 'unknown');
  assert.match(spans[0]!.detail, /gave out/i);
  // The router powering itself back on is proof the light had returned.
  assert.equal(spans[1]!.state, 'mains');
  db.close();
});

test('stopping the monitor on purpose is not recorded as a power cut', () => {
  const db = memoryDb();
  const tracker = new PowerTracker(db);
  const now = Date.now();

  db.setMeta('heartbeat', String(now - 3 * HOUR));
  tracker.markCleanShutdown();
  tracker.beginGapReconstruction(now);
  tracker.noteOntBoot(now - 10 * HOUR);

  // An honest hole in the timeline beats a blackout that never happened.
  assert.equal(db.powerSpansBetween(0, now + 1).length, 0);
  db.close();
});

test('an outage the router never restarted through is taken back', () => {
  const db = memoryDb();
  const tracker = new PowerTracker(db);
  const now = Date.now();

  const span = db.openPowerSpan('off', now - 2 * HOUR, 'live', 'The router is not answering.');
  db.closePowerSpan(span.id, now - HOUR);

  // Uptime says it has been running since well before the outage started, so
  // it did not lose power - it was the network in between. Leaving this as a
  // blackout would quietly inflate every figure on the page.
  tracker.noteOntBoot(now - 20 * HOUR);

  const revised = db.getPowerSpan(span.id);
  assert.equal(revised?.state, 'unknown');
  assert.match(revised!.detail, /did not lose power/i);
  db.close();
});

// ---------------------------------------------------------------------------
// Derived figures
// ---------------------------------------------------------------------------

test('battery runtime counts only holds that actually ended in a flat pack', () => {
  const db = memoryDb();
  const now = Date.now();

  // Held for two hours and then the router went dark: a real measurement.
  db.insertPowerSpan('battery', now - 6 * HOUR, now - 4 * HOUR, 'live', '');
  db.insertPowerSpan('off', now - 4 * HOUR, now - 3.5 * HOUR, 'live', '');
  // Held for three hours and then the light came back: this measured the
  // length of the power cut, not the pack, so it must not lower the estimate.
  db.insertPowerSpan('battery', now - 3 * HOUR, now, 'live', '');

  const stats = batteryStats(db);
  assert.equal(stats.runtimeSec, 2 * 3600);
  assert.equal(stats.longestHoldSec, 3 * 3600);
  db.close();
});

test('the four totals always add up to the window, gaps included', () => {
  const db = memoryDb();
  const now = Date.now();
  db.insertPowerSpan('mains', now - 4 * HOUR, now - 3 * HOUR, 'live', '');
  db.insertPowerSpan('off', now - 3 * HOUR, now - 2 * HOUR, 'live', '');
  // The hour from -2h to now is covered by nothing at all.

  const summary = powerSummary(db, now - 4 * HOUR, now, {
    state: 'unknown',
    since: null,
    because: '',
    wifiOn: false,
    ontUptimeSec: null,
    batteryRuntimeSec: null,
  });

  const total = Object.values(summary.totals).reduce((a, v) => a + v, 0);
  // Unwatched time is folded into `unknown` rather than dropped, so the page
  // can never imply more certainty than was actually observed.
  assert.equal(total, 4 * 3600);
  assert.equal(summary.totals.unknown, 2 * 3600);
  assert.equal(summary.mainsCuts, 1);
  db.close();
});

// ---------------------------------------------------------------------------
// Pattern recognition & restoration predictions
// ---------------------------------------------------------------------------

test('extractOutageIntervals merges consecutive battery and off spans into one outage', () => {
  const now = 1700000000000;
  const spans = [
    { id: 1, state: 'mains' as const, start: now - 10 * HOUR, end: now - 6 * HOUR, durationSec: 4 * 3600, source: 'live' as const, detail: '' },
    { id: 2, state: 'battery' as const, start: now - 6 * HOUR, end: now - 4 * HOUR, durationSec: 2 * 3600, source: 'live' as const, detail: '' },
    { id: 3, state: 'off' as const, start: now - 4 * HOUR, end: now - 2 * HOUR, durationSec: 2 * 3600, source: 'live' as const, detail: '' },
    { id: 4, state: 'mains' as const, start: now - 2 * HOUR, end: now, durationSec: 2 * 3600, source: 'live' as const, detail: '' },
  ];

  const outages = extractOutageIntervals(spans);
  assert.equal(outages.length, 1);
  assert.equal(outages[0]?.start, now - 6 * HOUR);
  assert.equal(outages[0]?.end, now - 2 * HOUR);
  assert.equal(outages[0]?.durationSec, 4 * 3600);
});

test('detectRotationalCycle identifies a periodic 4h on / 4h off duty cycle', () => {
  const now = 1700000000000;
  const spans = [];
  let t = now - 32 * HOUR;

  for (let i = 0; i < 4; i++) {
    spans.push({ id: i * 2 + 1, state: 'mains' as const, start: t, end: t + 4 * HOUR, durationSec: 4 * 3600, source: 'live' as const, detail: '' });
    t += 4 * HOUR;
    spans.push({ id: i * 2 + 2, state: 'battery' as const, start: t, end: t + 4 * HOUR, durationSec: 4 * 3600, source: 'live' as const, detail: '' });
    t += 4 * HOUR;
  }

  const cycle = detectRotationalCycle(spans);
  assert.ok(cycle !== null);
  assert.equal(Math.round(cycle!.offSec / 3600), 4);
  assert.equal(Math.round(cycle!.onSec / 3600), 4);
  assert.ok(cycle!.reliability > 0.7);
});

test('analyzePowerPatterns builds 7x24 heatmap and calculates grid metrics', () => {
  const db = memoryDb();
  const now = 1700000000000;

  // Insert 3 past outages: 2h, 4h, 3h
  db.insertPowerSpan('mains', now - 48 * HOUR, now - 40 * HOUR, 'live', '');
  db.insertPowerSpan('battery', now - 40 * HOUR, now - 38 * HOUR, 'live', ''); // 2h
  db.insertPowerSpan('mains', now - 38 * HOUR, now - 30 * HOUR, 'live', '');
  db.insertPowerSpan('off', now - 30 * HOUR, now - 26 * HOUR, 'live', ''); // 4h
  db.insertPowerSpan('mains', now - 26 * HOUR, now - 15 * HOUR, 'live', '');
  db.insertPowerSpan('battery', now - 15 * HOUR, now - 12 * HOUR, 'live', ''); // 3h
  db.insertPowerSpan('mains', now - 12 * HOUR, now, 'live', '');

  const patterns = analyzePowerPatterns(db, 'UTC', 7, now);
  assert.equal(patterns.totalOutagesAnalyzed, 3);
  assert.equal(patterns.medianOutageSec, 3 * 3600);
  assert.ok(patterns.averageMainsHoursPerDay! > 0);
  assert.equal(patterns.weeklyHeatmap.length, 7);
  assert.equal(patterns.weeklyHeatmap[0]?.length, 24);
  db.close();
});

test('predictPowerRestoration returns expected restore time during an active cut', () => {
  const db = memoryDb();
  const now = 1700000000000;

  // Past history of 3.5h cuts
  db.insertPowerSpan('mains', now - 72 * HOUR, now - 50 * HOUR, 'live', '');
  db.insertPowerSpan('battery', now - 50 * HOUR, now - 46.5 * HOUR, 'live', ''); // 3.5h
  db.insertPowerSpan('mains', now - 46.5 * HOUR, now - 26 * HOUR, 'live', '');
  db.insertPowerSpan('off', now - 26 * HOUR, now - 22.5 * HOUR, 'live', ''); // 3.5h
  db.insertPowerSpan('mains', now - 22.5 * HOUR, now - 1 * HOUR, 'live', '');

  // Currently 1 hour into an active cut
  db.openPowerSpan('battery', now - 1 * HOUR, 'live', 'Light is off');

  const prediction = predictPowerRestoration(db, now, 'UTC');
  assert.ok(prediction.expectedRestoreTs !== null);
  assert.equal(prediction.expectedDurationSec, 3.5 * 3600);
  // Expected restore timestamp should be start (now - 1h) + 3.5h = now + 2.5h
  assert.equal(prediction.expectedRestoreTs, now - 1 * HOUR + 3.5 * 3600 * 1000);
  assert.ok(prediction.confidence === 'medium' || prediction.confidence === 'high');
  assert.match(prediction.basis ?? '', /historical outages/i);

  db.close();
});
