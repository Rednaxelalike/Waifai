import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  Device,
  Incident,
  IncidentKind,
  IncidentSeverity,
  Millis,
  Notice,
  OpticalSample,
  PowerSpan,
  PowerState,
  PresenceSession,
  ProbeSample,
  ProbeTier,
  SpeedtestSample,
  Subscription,
  SubscriptionInput,
  ThroughputPoint,
  UsageBucket,
  WanSample,
} from '@waifai/shared';
import { config } from '../config.ts';
import { logger } from '../log.ts';
import { MIGRATIONS } from './schema.ts';

const log = logger('db');

/** node:sqlite rejects booleans and undefined, so normalise at the boundary. */
type Bindable = string | number | null | Uint8Array;
const b = (v: boolean): number => (v ? 1 : 0);
const n = <T extends Bindable>(v: T | undefined | null): T | null => (v === undefined ? null : v);

/** SQLite has no boolean type; everything comes back as 0/1. */
const truthy = (v: unknown): boolean => v === 1 || v === true;
const numOrNull = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

/**
 * Every device read carries the start of its open presence span.
 *
 * That column is the difference between the UI being able to say "since
 * 12:24" and only being able to say "online": `devices.last_seen` moves with
 * each sweep, so the join is the only place the join-time survives.
 */
const DEVICE_SELECT = `
  SELECT d.*,
         (SELECT p.start FROM presence p
           WHERE p.mac = d.mac AND p.end IS NULL
           ORDER BY p.start DESC LIMIT 1) AS online_since
    FROM devices d`;

const strOrNull = (v: unknown): string | null =>
  v === null || v === undefined ? null : String(v);

export class Db {
  readonly raw: DatabaseSync;

  constructor(file: string = config.db.file) {
    mkdirSync(dirname(file), { recursive: true });
    this.raw = new DatabaseSync(file);
    // WAL keeps the API readable while the collector writes, which matters
    // because polls and dashboard requests overlap constantly.
    this.raw.exec('PRAGMA journal_mode = WAL');
    this.raw.exec('PRAGMA synchronous = NORMAL');
    this.raw.exec('PRAGMA foreign_keys = ON');
    this.raw.exec('PRAGMA busy_timeout = 5000');
    this.migrate();
  }

  private migrate(): void {
    this.raw.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
    const current = Number(this.getMeta('schema_version') ?? '0');
    for (let i = current; i < MIGRATIONS.length; i++) {
      log.info(`applying migration ${i + 1}`);
      this.raw.exec(MIGRATIONS[i]!);
      this.setMeta('schema_version', String(i + 1));
    }
  }

  close(): void {
    this.raw.close();
  }

  // -- meta ----------------------------------------------------------------

  getMeta(k: string): string | null {
    const row = this.raw.prepare('SELECT v FROM meta WHERE k = ?').get(k) as
      | { v: string }
      | undefined;
    return row ? row.v : null;
  }

  setMeta(k: string, v: string): void {
    this.raw
      .prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v')
      .run(k, v);
  }

  // -- collector schedule --------------------------------------------------

  /*
   * When a collector last ran, so its interval survives a restart. See the
   * note on `Scheduler.dueIn`, which is the only thing that reads it back.
   *
   * In `meta` rather than a table of its own: it is one integer per job and
   * there are five jobs, so a table would be a migration and an index to hold
   * five rows. A job that is renamed or dropped leaves a stale key behind,
   * which costs nothing and is never read again.
   */
  jobLastRun(name: string): number | null {
    const raw = this.getMeta(`job:last_run:${name}`);
    if (raw === null) return null;
    const ts = Number(raw);
    return Number.isFinite(ts) ? ts : null;
  }

  setJobLastRun(name: string, ts: number): void {
    this.setMeta(`job:last_run:${name}`, String(ts));
  }

  // -- optical -------------------------------------------------------------

  insertOptical(s: OpticalSample): void {
    this.raw
      .prepare(
        `INSERT INTO optical_samples (ts, rx, tx, bias, volt, temp, pon)
         VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(ts) DO NOTHING`,
      )
      .run(s.ts, n(s.rxPower), n(s.txPower), n(s.biasCurrent), n(s.voltage), n(s.temperature), n(s.ponStatus));
  }

  latestOptical(): OpticalSample | null {
    const r = this.raw
      .prepare('SELECT * FROM optical_samples ORDER BY ts DESC LIMIT 1')
      .get() as Record<string, unknown> | undefined;
    return r ? rowToOptical(r) : null;
  }

  opticalSince(since: Millis, limit = 5000): OpticalSample[] {
    return (
      this.raw
        .prepare('SELECT * FROM optical_samples WHERE ts >= ? ORDER BY ts ASC LIMIT ?')
        .all(since, limit) as Record<string, unknown>[]
    ).map(rowToOptical);
  }

  /** Hourly rollup, used for anything older than the raw retention window. */
  opticalHourlySince(since: Millis): { hour: number; rx: number | null; rxMin: number | null; rxMax: number | null; temp: number | null }[] {
    return (
      this.raw
        .prepare('SELECT hour, rx_avg, rx_min, rx_max, temp_avg FROM optical_hourly WHERE hour >= ? ORDER BY hour ASC')
        .all(since) as Record<string, unknown>[]
    ).map((r) => ({
      hour: Number(r['hour']),
      rx: numOrNull(r['rx_avg']),
      rxMin: numOrNull(r['rx_min']),
      rxMax: numOrNull(r['rx_max']),
      temp: numOrNull(r['temp_avg']),
    }));
  }

  // -- wan -----------------------------------------------------------------

  insertWan(s: WanSample): void {
    this.raw
      .prepare(
        `INSERT INTO wan_samples (ts, up, ipv4, ipv6, uptime_sec, rx_bytes, tx_bytes)
         VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(ts) DO NOTHING`,
      )
      .run(s.ts, b(s.up), n(s.ipv4), n(s.ipv6), n(s.connectionUptimeSec), n(s.rxBytes), n(s.txBytes));
  }

  latestWan(): WanSample | null {
    const r = this.raw.prepare('SELECT * FROM wan_samples ORDER BY ts DESC LIMIT 1').get() as
      | Record<string, unknown>
      | undefined;
    return r ? rowToWan(r) : null;
  }

  /** The previous sample, needed to difference the byte counters. */
  previousWan(beforeTs: Millis): WanSample | null {
    const r = this.raw
      .prepare('SELECT * FROM wan_samples WHERE ts < ? ORDER BY ts DESC LIMIT 1')
      .get(beforeTs) as Record<string, unknown> | undefined;
    return r ? rowToWan(r) : null;
  }

  // -- throughput ----------------------------------------------------------

  insertThroughput(p: ThroughputPoint): void {
    this.raw
      .prepare('INSERT INTO throughput (ts, down_bps, up_bps) VALUES (?, ?, ?) ON CONFLICT(ts) DO NOTHING')
      .run(p.ts, p.downBps, p.upBps);
  }

  latestThroughput(): ThroughputPoint | null {
    const r = this.raw.prepare('SELECT * FROM throughput ORDER BY ts DESC LIMIT 1').get() as
      | Record<string, unknown>
      | undefined;
    return r
      ? { ts: Number(r['ts']), downBps: Number(r['down_bps']), upBps: Number(r['up_bps']) }
      : null;
  }

  throughputSince(since: Millis, limit = 5000): ThroughputPoint[] {
    return (
      this.raw
        .prepare('SELECT * FROM throughput WHERE ts >= ? ORDER BY ts ASC LIMIT ?')
        .all(since, limit) as Record<string, unknown>[]
    ).map((r) => ({ ts: Number(r['ts']), downBps: Number(r['down_bps']), upBps: Number(r['up_bps']) }));
  }

  // -- probes --------------------------------------------------------------

  insertProbe(s: ProbeSample): void {
    this.raw
      .prepare(
        `INSERT INTO probe_samples (ts, target, tier, rtt, jitter, loss, ok)
         VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(ts, target) DO NOTHING`,
      )
      .run(s.ts, s.target, s.tier, n(s.rttMs), n(s.jitterMs), s.loss, b(s.ok));
  }

  /** Most recent sample for every distinct target. */
  latestProbes(): ProbeSample[] {
    return (
      this.raw
        .prepare(
          `SELECT p.* FROM probe_samples p
           JOIN (SELECT target, MAX(ts) AS ts FROM probe_samples GROUP BY target) m
             ON p.target = m.target AND p.ts = m.ts`,
        )
        .all() as Record<string, unknown>[]
    ).map(rowToProbe);
  }

  probesSince(since: Millis, tier?: ProbeTier, limit = 20000): ProbeSample[] {
    const sql = tier
      ? 'SELECT * FROM probe_samples WHERE ts >= ? AND tier = ? ORDER BY ts ASC LIMIT ?'
      : 'SELECT * FROM probe_samples WHERE ts >= ? ORDER BY ts ASC LIMIT ?';
    const args: Bindable[] = tier ? [since, tier, limit] : [since, limit];
    return (this.raw.prepare(sql).all(...args) as Record<string, unknown>[]).map(rowToProbe);
  }

  // -- speedtests ----------------------------------------------------------

  insertSpeedtest(s: SpeedtestSample): void {
    this.raw
      .prepare(
        `INSERT INTO speedtests (ts, down, up, ping, jitter, server, source)
         VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(ts) DO NOTHING`,
      )
      .run(s.ts, s.downMbps, s.upMbps, n(s.pingMs), n(s.jitterMs), n(s.serverName), s.source);
  }

  latestSpeedtest(): SpeedtestSample | null {
    const r = this.raw.prepare('SELECT * FROM speedtests ORDER BY ts DESC LIMIT 1').get() as
      | Record<string, unknown>
      | undefined;
    return r ? rowToSpeedtest(r) : null;
  }

  speedtestsSince(since: Millis): SpeedtestSample[] {
    return (
      this.raw
        .prepare('SELECT * FROM speedtests WHERE ts >= ? ORDER BY ts ASC')
        .all(since) as Record<string, unknown>[]
    ).map(rowToSpeedtest);
  }

  // -- devices -------------------------------------------------------------

  /**
   * Upsert from a sighting. Deliberately does not touch `label`, `owner` or
   * `trusted`: those are human-entered and must survive the ONT reporting a
   * fresh useless hostname.
   */
  seeDevice(d: {
    mac: string;
    hostname?: string | null;
    ip?: string | null;
    vendor?: string | null;
    connection?: string;
    rssi?: number | null;
    ts: Millis;
  }): { isNew: boolean } {
    const mac = d.mac.toUpperCase();
    const existing = this.raw.prepare('SELECT mac FROM devices WHERE mac = ?').get(mac);
    if (existing) {
      this.raw
        .prepare(
          `UPDATE devices SET
             hostname   = COALESCE(?, hostname),
             ip         = COALESCE(?, ip),
             vendor     = COALESCE(vendor, ?),
             connection = CASE WHEN ? = 'unknown' THEN connection ELSE ? END,
             rssi       = COALESCE(?, rssi),
             last_seen  = ?,
             online     = 1
           WHERE mac = ?`,
        )
        .run(
          n(d.hostname),
          n(d.ip),
          n(d.vendor),
          d.connection ?? 'unknown',
          d.connection ?? 'unknown',
          n(d.rssi),
          d.ts,
          mac,
        );
      return { isNew: false };
    }
    this.raw
      .prepare(
        `INSERT INTO devices (mac, hostname, ip, vendor, connection, first_seen, last_seen, online, trusted, rssi)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?)`,
      )
      .run(mac, n(d.hostname), n(d.ip), n(d.vendor), d.connection ?? 'unknown', d.ts, d.ts, n(d.rssi));
    return { isNew: true };
  }

  /**
   * Update device metadata (e.g. from ONT DHCP lease page) without
   * declaring it online or updating its live presence last_seen timestamp.
   */
  recordDeviceMetadata(d: {
    mac: string;
    hostname?: string | null;
    ip?: string | null;
    vendor?: string | null;
    connection?: string;
    rssi?: number | null;
    ts: Millis;
  }): void {
    const mac = d.mac.toUpperCase();
    const existing = this.raw.prepare('SELECT mac FROM devices WHERE mac = ?').get(mac);
    if (existing) {
      this.raw
        .prepare(
          `UPDATE devices SET
             hostname   = COALESCE(?, hostname),
             ip         = COALESCE(?, ip),
             vendor     = COALESCE(vendor, ?),
             connection = CASE WHEN ? = 'unknown' THEN connection ELSE ? END,
             rssi       = COALESCE(?, rssi)
           WHERE mac = ?`,
        )
        .run(
          n(d.hostname),
          n(d.ip),
          n(d.vendor),
          d.connection ?? 'unknown',
          d.connection ?? 'unknown',
          n(d.rssi),
          mac,
        );
    } else {
      this.raw
        .prepare(
          `INSERT INTO devices (mac, hostname, ip, vendor, connection, first_seen, last_seen, online, trusted, rssi)
           VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, ?)`,
        )
        .run(mac, n(d.hostname), n(d.ip), n(d.vendor), d.connection ?? 'unknown', d.ts, n(d.rssi));
    }
  }

  /** Mark everything not seen in this sweep as offline. Returns the MACs. */
  markOffline(notSeenSince: Millis): string[] {
    const gone = (
      this.raw
        .prepare('SELECT mac FROM devices WHERE online = 1 AND last_seen < ?')
        .all(notSeenSince) as { mac: string }[]
    ).map((r) => r.mac);
    if (gone.length) {
      this.raw.prepare('UPDATE devices SET online = 0 WHERE online = 1 AND last_seen < ?').run(notSeenSince);
    }
    return gone;
  }

  listDevices(): Device[] {
    return (
      this.raw.prepare(`${DEVICE_SELECT} ORDER BY d.online DESC, d.last_seen DESC`).all() as Record<
        string,
        unknown
      >[]
    ).map(rowToDevice);
  }

  getDevice(mac: string): Device | null {
    const r = this.raw.prepare(`${DEVICE_SELECT} WHERE d.mac = ?`).get(mac.toUpperCase()) as
      | Record<string, unknown>
      | undefined;
    return r ? rowToDevice(r) : null;
  }

  updateDeviceMeta(
    mac: string,
    patch: { label?: string | null; owner?: string | null; trusted?: boolean; mainsWitness?: boolean },
  ): void {
    const cur = this.getDevice(mac);
    if (!cur) return;
    this.raw
      .prepare('UPDATE devices SET label = ?, owner = ?, trusted = ?, mains_witness = ? WHERE mac = ?')
      .run(
        patch.label === undefined ? n(cur.label) : n(patch.label),
        patch.owner === undefined ? n(cur.owner) : n(patch.owner),
        b(patch.trusted === undefined ? cur.trusted : patch.trusted),
        b(patch.mainsWitness === undefined ? cur.mainsWitness : patch.mainsWitness),
        mac.toUpperCase(),
      );
  }

  /**
   * How many mains-only witnesses exist and how many are answering.
   *
   * Read as a pair on purpose: "none online" only means the light is off if
   * there was at least one to go offline in the first place.
   */
  mainsWitnessCounts(): { total: number; online: number } {
    const r = this.raw
      .prepare(
        'SELECT COUNT(*) AS total, SUM(CASE WHEN online = 1 THEN 1 ELSE 0 END) AS online FROM devices WHERE mains_witness = 1',
      )
      .get() as { total: number; online: number | null };
    return { total: Number(r.total), online: Number(r.online ?? 0) };
  }

  countOnlineDevices(): number {
    const r = this.raw.prepare('SELECT COUNT(*) AS c FROM devices WHERE online = 1').get() as { c: number };
    return Number(r.c);
  }

  // -- presence ------------------------------------------------------------

  openPresence(mac: string, start: Millis): void {
    const open = this.raw
      .prepare('SELECT id FROM presence WHERE mac = ? AND end IS NULL LIMIT 1')
      .get(mac.toUpperCase());
    if (open) return;
    this.raw.prepare('INSERT INTO presence (mac, start, end) VALUES (?, ?, NULL)').run(mac.toUpperCase(), start);
  }

  closePresence(mac: string, end: Millis): void {
    this.raw
      .prepare('UPDATE presence SET end = ? WHERE mac = ? AND end IS NULL')
      .run(end, mac.toUpperCase());
  }

  presenceSince(since: Millis, mac?: string): PresenceSession[] {
    const sql = mac
      ? 'SELECT mac, start, end FROM presence WHERE mac = ? AND (end IS NULL OR end >= ?) ORDER BY start ASC'
      : 'SELECT mac, start, end FROM presence WHERE end IS NULL OR end >= ? ORDER BY start ASC';
    const args: Bindable[] = mac ? [mac.toUpperCase(), since] : [since];
    return (this.raw.prepare(sql).all(...args) as Record<string, unknown>[]).map((r) => ({
      mac: String(r['mac']),
      start: Number(r['start']),
      end: numOrNull(r['end']),
    }));
  }

  // -- incidents -----------------------------------------------------------

  openIncident(kind: IncidentKind, severity: IncidentSeverity, start: Millis, detail: string): Incident {
    const info = this.raw
      .prepare('INSERT INTO incidents (kind, severity, start, end, detail) VALUES (?, ?, ?, NULL, ?)')
      .run(kind, severity, start, detail);
    return this.getIncident(Number(info.lastInsertRowid))!;
  }

  closeIncident(id: number, end: Millis): Incident | null {
    this.raw.prepare('UPDATE incidents SET end = ? WHERE id = ? AND end IS NULL').run(end, id);
    return this.getIncident(id);
  }

  getIncident(id: number): Incident | null {
    const r = this.raw.prepare('SELECT * FROM incidents WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return r ? rowToIncident(r) : null;
  }

  activeIncident(): Incident | null {
    const r = this.raw
      .prepare('SELECT * FROM incidents WHERE end IS NULL ORDER BY start DESC LIMIT 1')
      .get() as Record<string, unknown> | undefined;
    return r ? rowToIncident(r) : null;
  }

  lastClosedIncident(): Incident | null {
    const r = this.raw
      .prepare('SELECT * FROM incidents WHERE end IS NOT NULL ORDER BY end DESC LIMIT 1')
      .get() as Record<string, unknown> | undefined;
    return r ? rowToIncident(r) : null;
  }

  incidentsBetween(from: Millis, to: Millis): Incident[] {
    return (
      this.raw
        .prepare(
          `SELECT * FROM incidents
           WHERE start < ? AND (end IS NULL OR end > ?)
           ORDER BY start DESC`,
        )
        .all(to, from) as Record<string, unknown>[]
    ).map(rowToIncident);
  }

  annotateIncident(id: number, note: string): void {
    this.raw.prepare('UPDATE incidents SET note = ? WHERE id = ?').run(note, id);
  }

  // -- power spans ---------------------------------------------------------

  openPowerSpan(state: PowerState, start: Millis, source: 'live' | 'reconstructed', detail: string): PowerSpan {
    const info = this.raw
      .prepare('INSERT INTO power_spans (state, start, end, source, detail) VALUES (?, ?, NULL, ?, ?)')
      .run(state, start, source, detail);
    return this.getPowerSpan(Number(info.lastInsertRowid))!;
  }

  /** Write a span that is already over. Used by gap reconstruction. */
  insertPowerSpan(
    state: PowerState,
    start: Millis,
    end: Millis,
    source: 'live' | 'reconstructed',
    detail: string,
  ): PowerSpan {
    const info = this.raw
      .prepare('INSERT INTO power_spans (state, start, end, source, detail) VALUES (?, ?, ?, ?, ?)')
      .run(state, start, end, source, detail);
    return this.getPowerSpan(Number(info.lastInsertRowid))!;
  }

  closePowerSpan(id: number, end: Millis): PowerSpan | null {
    this.raw.prepare('UPDATE power_spans SET end = ? WHERE id = ? AND end IS NULL').run(end, id);
    return this.getPowerSpan(id);
  }

  /**
   * Rewrite a span after later evidence contradicted it. The one case that
   * matters: a router that stopped answering but never actually restarted was
   * not a power cut at all, and only its uptime counter can say so.
   */
  revisePowerSpan(id: number, state: PowerState, detail: string): void {
    this.raw.prepare('UPDATE power_spans SET state = ?, detail = ? WHERE id = ?').run(state, detail, id);
  }

  getPowerSpan(id: number): PowerSpan | null {
    const r = this.raw.prepare('SELECT * FROM power_spans WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return r ? rowToPowerSpan(r) : null;
  }

  currentPowerSpan(): PowerSpan | null {
    const r = this.raw
      .prepare('SELECT * FROM power_spans WHERE end IS NULL ORDER BY start DESC LIMIT 1')
      .get() as Record<string, unknown> | undefined;
    return r ? rowToPowerSpan(r) : null;
  }

  /**
   * The span that ended most recently. Read after an ONT poll, because the
   * router's uptime often arrives a minute after the outage it explains.
   */
  lastClosedPowerSpan(): PowerSpan | null {
    const r = this.raw
      .prepare('SELECT * FROM power_spans WHERE end IS NOT NULL ORDER BY end DESC LIMIT 1')
      .get() as Record<string, unknown> | undefined;
    return r ? rowToPowerSpan(r) : null;
  }

  /** Oldest first, which is the order both the timeline and the CSV want. */
  powerSpansBetween(from: Millis, to: Millis): PowerSpan[] {
    return (
      this.raw
        .prepare(
          `SELECT * FROM power_spans
           WHERE start < ? AND (end IS NULL OR end > ?)
           ORDER BY start ASC`,
        )
        .all(to, from) as Record<string, unknown>[]
    ).map(rowToPowerSpan);
  }

  /** Every closed span of one state, oldest first. Feeds the runtime estimate. */
  powerSpansOfState(state: PowerState): PowerSpan[] {
    return (
      this.raw
        .prepare('SELECT * FROM power_spans WHERE state = ? AND end IS NOT NULL ORDER BY start ASC')
        .all(state) as Record<string, unknown>[]
    ).map(rowToPowerSpan);
  }

  // -- usage ---------------------------------------------------------------

  addUsage(day: string, downBytes: number, upBytes: number): void {
    this.raw
      .prepare(
        `INSERT INTO usage_daily (day, down_bytes, up_bytes) VALUES (?, ?, ?)
         ON CONFLICT(day) DO UPDATE SET
           down_bytes = down_bytes + excluded.down_bytes,
           up_bytes   = up_bytes   + excluded.up_bytes`,
      )
      .run(day, Math.round(downBytes), Math.round(upBytes));
  }

  usageBetween(fromDay: string, toDay: string): UsageBucket[] {
    return (
      this.raw
        .prepare('SELECT * FROM usage_daily WHERE day >= ? AND day <= ? ORDER BY day ASC')
        .all(fromDay, toDay) as Record<string, unknown>[]
    ).map((r) => ({
      day: String(r['day']),
      downBytes: Number(r['down_bytes']),
      upBytes: Number(r['up_bytes']),
    }));
  }

  // -- notices -------------------------------------------------------------

  addNotice(author: string, body: string, pinned = false): Notice {
    const ts = Date.now();
    const info = this.raw
      .prepare('INSERT INTO notices (ts, author, body, pinned) VALUES (?, ?, ?, ?)')
      .run(ts, author, body, b(pinned));
    return { id: Number(info.lastInsertRowid), ts, author, body, pinned };
  }

  listNotices(limit = 50): Notice[] {
    return (
      this.raw
        .prepare('SELECT * FROM notices ORDER BY pinned DESC, ts DESC LIMIT ?')
        .all(limit) as Record<string, unknown>[]
    ).map((r) => ({
      id: Number(r['id']),
      ts: Number(r['ts']),
      author: String(r['author']),
      body: String(r['body']),
      pinned: truthy(r['pinned']),
    }));
  }

  deleteNotice(id: number): void {
    this.raw.prepare('DELETE FROM notices WHERE id = ?').run(id);
  }

  // -- subscriptions -------------------------------------------------------

  /**
   * Newest window first. The whole table is a handful of rows a year, so it
   * is read whole and sliced in the caller rather than paged.
   */
  listSubscriptions(): Subscription[] {
    return (
      this.raw
        .prepare('SELECT * FROM subscriptions ORDER BY start_ts DESC, id DESC')
        .all() as Record<string, unknown>[]
    ).map(rowToSubscription);
  }

  getSubscription(id: number): Subscription | null {
    const r = this.raw.prepare('SELECT * FROM subscriptions WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return r === undefined ? null : rowToSubscription(r);
  }

  addSubscription(input: SubscriptionInput): Subscription {
    const info = this.raw
      .prepare(
        `INSERT INTO subscriptions (paid_ts, start_ts, end_ts, plan, amount, reference, note)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.paidTs,
        input.startTs,
        input.endTs,
        input.plan,
        n(input.amount),
        n(input.reference),
        n(input.note),
      );
    return { id: Number(info.lastInsertRowid), ...input };
  }

  /**
   * Whole-row rewrite from the merged record rather than a built-up SET list.
   * Every field here is one somebody typed, so the caller already has to hold
   * the complete form to render it, and a partial update statement would be
   * seven optional bindings to save nothing.
   */
  updateSubscription(id: number, patch: Partial<SubscriptionInput>): Subscription | null {
    const existing = this.getSubscription(id);
    if (existing === null) return null;
    const merged: Subscription = { ...existing, ...patch, id };
    this.raw
      .prepare(
        `UPDATE subscriptions
            SET paid_ts = ?, start_ts = ?, end_ts = ?, plan = ?, amount = ?, reference = ?, note = ?
          WHERE id = ?`,
      )
      .run(
        merged.paidTs,
        merged.startTs,
        merged.endTs,
        merged.plan,
        n(merged.amount),
        n(merged.reference),
        n(merged.note),
        id,
      );
    return merged;
  }

  deleteSubscription(id: number): void {
    this.raw.prepare('DELETE FROM subscriptions WHERE id = ?').run(id);
  }

  // -- alert cooldown ------------------------------------------------------

  /** True when this alert key has not fired inside the cooldown window. */
  shouldAlert(key: string, cooldownMs: number, now = Date.now()): boolean {
    const r = this.raw.prepare('SELECT ts FROM alerts_sent WHERE k = ?').get(key) as
      | { ts: number }
      | undefined;
    if (r && now - Number(r.ts) < cooldownMs) return false;
    this.raw
      .prepare('INSERT INTO alerts_sent (k, ts) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET ts = excluded.ts')
      .run(key, now);
    return true;
  }

  clearAlertCooldown(key: string): void {
    this.raw.prepare('DELETE FROM alerts_sent WHERE k = ?').run(key);
  }

  // -- discovery -----------------------------------------------------------

  recordPage(path: string, ok: boolean, bytes: number, kinds: string[]): void {
    this.raw
      .prepare(
        `INSERT INTO ont_pages (path, ts, ok, bytes, kinds) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET ts = excluded.ts, ok = excluded.ok,
                                        bytes = excluded.bytes, kinds = excluded.kinds`,
      )
      .run(path, Date.now(), b(ok), bytes, kinds.join(','));
  }

  knownGoodPages(): { path: string; kinds: string[] }[] {
    return (
      this.raw.prepare('SELECT path, kinds FROM ont_pages WHERE ok = 1').all() as Record<
        string,
        unknown
      >[]
    ).map((r) => ({
      path: String(r['path']),
      kinds: String(r['kinds'] ?? '').split(',').filter(Boolean),
    }));
  }
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function rowToOptical(r: Record<string, unknown>): OpticalSample {
  return {
    ts: Number(r['ts']),
    rxPower: numOrNull(r['rx']),
    txPower: numOrNull(r['tx']),
    biasCurrent: numOrNull(r['bias']),
    voltage: numOrNull(r['volt']),
    temperature: numOrNull(r['temp']),
    ponStatus: strOrNull(r['pon']),
  };
}

function rowToWan(r: Record<string, unknown>): WanSample {
  return {
    ts: Number(r['ts']),
    up: truthy(r['up']),
    ipv4: strOrNull(r['ipv4']),
    ipv6: strOrNull(r['ipv6']),
    connectionUptimeSec: numOrNull(r['uptime_sec']),
    rxBytes: numOrNull(r['rx_bytes']),
    txBytes: numOrNull(r['tx_bytes']),
  };
}

function rowToProbe(r: Record<string, unknown>): ProbeSample {
  return {
    ts: Number(r['ts']),
    target: String(r['target']),
    tier: String(r['tier']) as ProbeTier,
    rttMs: numOrNull(r['rtt']),
    jitterMs: numOrNull(r['jitter']),
    loss: Number(r['loss']),
    ok: truthy(r['ok']),
  };
}

function rowToSpeedtest(r: Record<string, unknown>): SpeedtestSample {
  return {
    ts: Number(r['ts']),
    downMbps: Number(r['down']),
    upMbps: Number(r['up']),
    pingMs: numOrNull(r['ping']),
    jitterMs: numOrNull(r['jitter']),
    serverName: strOrNull(r['server']),
    source: String(r['source']),
  };
}

function rowToDevice(r: Record<string, unknown>): Device {
  return {
    mac: String(r['mac']),
    hostname: strOrNull(r['hostname']),
    label: strOrNull(r['label']),
    owner: strOrNull(r['owner']),
    ip: strOrNull(r['ip']),
    vendor: strOrNull(r['vendor']),
    connection: String(r['connection'] ?? 'unknown'),
    firstSeen: Number(r['first_seen']),
    lastSeen: Number(r['last_seen']),
    onlineSince: numOrNull(r['online_since']),
    online: truthy(r['online']),
    trusted: truthy(r['trusted']),
    mainsWitness: truthy(r['mains_witness']),
    rssi: numOrNull(r['rssi']),
  };
}

function rowToPowerSpan(r: Record<string, unknown>): PowerSpan {
  const start = Number(r['start']);
  const end = numOrNull(r['end']);
  return {
    id: Number(r['id']),
    state: String(r['state']) as PowerState,
    start,
    end,
    durationSec: end === null ? null : Math.round((end - start) / 1000),
    source: String(r['source'] ?? 'live') as 'live' | 'reconstructed',
    detail: String(r['detail'] ?? ''),
  };
}

function rowToIncident(r: Record<string, unknown>): Incident {
  const start = Number(r['start']);
  const end = numOrNull(r['end']);
  return {
    id: Number(r['id']),
    kind: String(r['kind']) as IncidentKind,
    severity: String(r['severity']) as IncidentSeverity,
    start,
    end,
    durationSec: end === null ? null : Math.round((end - start) / 1000),
    detail: String(r['detail'] ?? ''),
    note: strOrNull(r['note']),
  };
}

function rowToSubscription(r: Record<string, unknown>): Subscription {
  return {
    id: Number(r['id']),
    paidTs: Number(r['paid_ts']),
    startTs: Number(r['start_ts']),
    endTs: Number(r['end_ts']),
    plan: String(r['plan'] ?? ''),
    amount: numOrNull(r['amount']),
    reference: strOrNull(r['reference']),
    note: strOrNull(r['note']),
  };
}
