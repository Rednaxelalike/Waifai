import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Db } from '../db/index.ts';
import { IncidentTracker, buildUptimeReport, classify, type HealthInput } from './incidents.ts';
import { counterDelta } from './usage.ts';
import { config } from '../config.ts';

/**
 * Tests for the logic that turns raw samples into claims about the line.
 *
 * These are the parts where a bug is invisible: a misclassified outage still
 * renders a plausible-looking chart, and a wrong uptime percentage is only
 * discovered when someone quotes it at MTN and gets contradicted.
 */

const healthy: HealthInput = {
  ts: 0,
  ontReachable: true,
  ponUp: true,
  gatewayOk: true,
  internetOk: true,
  dnsOk: true,
  internetLoss: 0,
  internetRttMs: 20,
};

test('a healthy sweep is not an incident', () => {
  assert.equal(classify(healthy).healthy, true);
});

test('an unreachable ONT outranks every other signal', () => {
  // With the ONT dark, downstream signals are meaningless, so the diagnosis
  // must be the ONT rather than a fibre fault we cannot actually observe.
  const v = classify({ ...healthy, ontReachable: false, ponUp: false, internetOk: false });
  assert.equal(v.kind, 'ont_unreachable');
  assert.equal(v.severity, 'critical');
});

test('a reachable ONT with a dead PON is blamed on the fibre', () => {
  const v = classify({ ...healthy, ponUp: false, internetOk: false });
  assert.equal(v.kind, 'pon_down');
  assert.match(v.detail, /fibre|OLT/i);
});

test('no route out with a live PON is a WAN fault', () => {
  assert.equal(classify({ ...healthy, internetOk: false }).kind, 'wan_down');
});

test('working traffic with broken name resolution is a DNS fault', () => {
  const v = classify({ ...healthy, dnsOk: false });
  assert.equal(v.kind, 'dns_failure');
  assert.equal(v.severity, 'warn');
});

test('heavy loss on a working line is degradation, not an outage', () => {
  const v = classify({ ...healthy, internetLoss: 0.5 });
  assert.equal(v.kind, 'degraded');
  assert.equal(v.severity, 'warn');
});

// ---------------------------------------------------------------------------

function memoryDb(): Db {
  return new Db(':memory:');
}

test('a single failed sweep does not open an incident', () => {
  const db = memoryDb();
  const tracker = new IncidentTracker(db);
  const change = tracker.update({ ...healthy, ts: Date.now(), internetOk: false });
  // Debouncing is the whole point: one dropped packet on a home line is
  // normal, and an "outage" every few minutes would make the log useless.
  assert.equal(change.opened, undefined);
  assert.equal(db.activeIncident(), null);
  db.close();
});

test('sustained failure opens an incident and recovery closes it', () => {
  const db = memoryDb();
  const tracker = new IncidentTracker(db);
  const t = Date.now();
  const step = config.intervals.probeSec * 1000;

  let opened;
  for (let i = 0; i < config.probes.failuresToOpen; i++) {
    opened = tracker.update({ ...healthy, ts: t + i * step, internetOk: false }).opened ?? opened;
  }
  assert.ok(opened, 'an incident should be open after the failure threshold');
  assert.equal(opened.kind, 'wan_down');
  // Backdated to the first bad sweep, so reported downtime matches experience
  // rather than starting when the threshold happened to trip.
  assert.ok(opened.start <= t, 'incident start should be backdated');

  let closed;
  for (let i = 0; i < config.probes.successesToClose; i++) {
    closed = tracker.update({ ...healthy, ts: t + (10 + i) * step }).closed ?? closed;
  }
  assert.ok(closed, 'the incident should close once the line recovers');
  assert.ok((closed.durationSec ?? 0) > 0);
  assert.equal(db.activeIncident(), null);
  db.close();
});

test('a degraded line that fails outright is escalated, not merged', () => {
  const db = memoryDb();
  const tracker = new IncidentTracker(db);
  const t = Date.now();
  const step = config.intervals.probeSec * 1000;

  for (let i = 0; i < config.probes.failuresToOpen; i++) {
    tracker.update({ ...healthy, ts: t + i * step, internetLoss: 0.9 });
  }
  assert.equal(db.activeIncident()?.kind, 'degraded');

  const change = tracker.update({ ...healthy, ts: t + 9 * step, ponUp: false, internetOk: false });
  assert.equal(change.closed?.kind, 'degraded');
  assert.equal(change.opened?.kind, 'pon_down');
  db.close();
});

test('time when the monitor was off is excluded from uptime, not blamed on MTN', () => {
  const db = memoryDb();
  const now = Date.now();
  const hour = 3_600_000;

  // A one-hour real outage and a one-hour window where we were not watching.
  const outage = db.openIncident('pon_down', 'critical', now - 4 * hour, 'fibre');
  db.closeIncident(outage.id, now - 3 * hour);
  const blind = db.openIncident('collector_down', 'info', now - 2 * hour, 'power cut');
  db.closeIncident(blind.id, now - 1 * hour);

  const report = buildUptimeReport(db, now - 10 * hour, now);
  // 9 observed hours, 1 down: 88.89%, not 90%. Counting the blind hour as
  // uptime would overstate the line; counting it as downtime would overstate
  // the fault. Excluding it is the only defensible option.
  assert.ok(Math.abs(report.uptimePct - 88.888) < 0.01, `got ${report.uptimePct}`);
  assert.equal(report.incidentCount, 1);
  assert.equal(report.totalDowntimeSec, 3600);
  db.close();
});

// ---------------------------------------------------------------------------

test('WAN counter deltas survive an ONT reboot', () => {
  assert.equal(counterDelta(1000, 1500), 500);
  // After a reboot the counter restarts from zero. Subtracting would give a
  // large negative; clamping to zero would silently lose the traffic.
  assert.equal(counterDelta(900_000, 4_200), 4_200);
  assert.equal(counterDelta(null, 5_000), 0);
  assert.equal(counterDelta(1000, null), 0);
});

test('device metadata entered by a human survives ONT rediscovery', () => {
  const db = memoryDb();
  const ts = Date.now();
  db.seeDevice({ mac: 'aa:bb:cc:dd:ee:ff', hostname: 'android-9f2c', ts });
  db.updateDeviceMeta('AA:BB:CC:DD:EE:FF', { label: "Ada's phone", owner: 'Ada', trusted: true });

  // The ONT re-reports the device with its useless generated hostname; the
  // human-assigned name must not be overwritten by it.
  db.recordDeviceMetadata({ mac: 'AA:BB:CC:DD:EE:FF', hostname: 'android-9f2c', ip: '192.168.100.5', ts: ts + 1 });

  const d = db.getDevice('AA:BB:CC:DD:EE:FF');
  assert.equal(d?.label, "Ada's phone");
  assert.equal(d?.owner, 'Ada');
  assert.equal(d?.trusted, true);
  assert.equal(d?.ip, '192.168.100.5');
  db.close();
});
