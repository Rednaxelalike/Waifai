/**
 * Schema migrations, applied in order. Each entry runs exactly once and the
 * applied version is recorded in `meta`. Never edit a migration that has
 * shipped: append a new one instead, or an existing database will diverge
 * from a fresh one.
 */
export const MIGRATIONS: readonly string[] = [
  // 1 - core time series and state
  `
  CREATE TABLE IF NOT EXISTS meta (
    k TEXT PRIMARY KEY,
    v TEXT NOT NULL
  );

  -- Raw ONT optical readings. One row per ONT poll.
  CREATE TABLE IF NOT EXISTS optical_samples (
    ts    INTEGER PRIMARY KEY,
    rx    REAL,
    tx    REAL,
    bias  REAL,
    volt  REAL,
    temp  REAL,
    pon   TEXT
  );

  -- Raw ONT WAN readings, including the cumulative byte counters that
  -- throughput and usage are both derived from.
  CREATE TABLE IF NOT EXISTS wan_samples (
    ts         INTEGER PRIMARY KEY,
    up         INTEGER NOT NULL,
    ipv4       TEXT,
    ipv6       TEXT,
    uptime_sec INTEGER,
    rx_bytes   INTEGER,
    tx_bytes   INTEGER
  );

  -- Differentiated from wan_samples so a counter reset does not corrupt it.
  CREATE TABLE IF NOT EXISTS throughput (
    ts       INTEGER PRIMARY KEY,
    down_bps REAL NOT NULL,
    up_bps   REAL NOT NULL
  );

  CREATE TABLE IF NOT EXISTS probe_samples (
    ts     INTEGER NOT NULL,
    target TEXT    NOT NULL,
    tier   TEXT    NOT NULL,
    rtt    REAL,
    jitter REAL,
    loss   REAL    NOT NULL,
    ok     INTEGER NOT NULL,
    PRIMARY KEY (ts, target)
  );
  CREATE INDEX IF NOT EXISTS idx_probe_ts   ON probe_samples (ts);
  CREATE INDEX IF NOT EXISTS idx_probe_tier ON probe_samples (tier, ts);

  CREATE TABLE IF NOT EXISTS speedtests (
    ts     INTEGER PRIMARY KEY,
    down   REAL NOT NULL,
    up     REAL NOT NULL,
    ping   REAL,
    jitter REAL,
    server TEXT,
    source TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS devices (
    mac        TEXT PRIMARY KEY,
    hostname   TEXT,
    label      TEXT,
    owner      TEXT,
    ip         TEXT,
    vendor     TEXT,
    connection TEXT    NOT NULL DEFAULT 'unknown',
    first_seen INTEGER NOT NULL,
    last_seen  INTEGER NOT NULL,
    online     INTEGER NOT NULL DEFAULT 0,
    trusted    INTEGER NOT NULL DEFAULT 0,
    rssi       INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_devices_last ON devices (last_seen);

  -- Contiguous spans of presence, closed when a device stops answering.
  CREATE TABLE IF NOT EXISTS presence (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    mac   TEXT    NOT NULL,
    start INTEGER NOT NULL,
    end   INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_presence_mac ON presence (mac, start);

  CREATE TABLE IF NOT EXISTS incidents (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    kind     TEXT    NOT NULL,
    severity TEXT    NOT NULL,
    start    INTEGER NOT NULL,
    end      INTEGER,
    detail   TEXT    NOT NULL DEFAULT '',
    note     TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_incidents_start ON incidents (start);
  CREATE INDEX IF NOT EXISTS idx_incidents_open  ON incidents (end) WHERE end IS NULL;

  -- Bucketed in the configured local timezone, not UTC, so "yesterday" means
  -- what the household thinks it means.
  CREATE TABLE IF NOT EXISTS usage_daily (
    day        TEXT PRIMARY KEY,
    down_bytes INTEGER NOT NULL DEFAULT 0,
    up_bytes   INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS notices (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    ts     INTEGER NOT NULL,
    author TEXT    NOT NULL,
    body   TEXT    NOT NULL,
    pinned INTEGER NOT NULL DEFAULT 0
  );

  -- Cooldown ledger so a flapping line does not send 200 notifications.
  CREATE TABLE IF NOT EXISTS alerts_sent (
    k  TEXT PRIMARY KEY,
    ts INTEGER NOT NULL
  );

  -- What --discover learned about this firmware, so polling can skip the
  -- paths that 404 on this particular build.
  CREATE TABLE IF NOT EXISTS ont_pages (
    path  TEXT PRIMARY KEY,
    ts    INTEGER NOT NULL,
    ok    INTEGER NOT NULL,
    bytes INTEGER NOT NULL,
    kinds TEXT
  );
  `,

  // 2 - hourly rollups, so multi-year history stays small
  `
  CREATE TABLE IF NOT EXISTS optical_hourly (
    hour   INTEGER PRIMARY KEY,
    rx_avg REAL, rx_min REAL, rx_max REAL,
    tx_avg REAL, temp_avg REAL,
    n      INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS probe_hourly (
    hour     INTEGER NOT NULL,
    tier     TEXT    NOT NULL,
    rtt_avg  REAL,
    rtt_p95  REAL,
    loss_avg REAL,
    n        INTEGER NOT NULL,
    PRIMARY KEY (hour, tier)
  );

  CREATE TABLE IF NOT EXISTS throughput_hourly (
    hour     INTEGER PRIMARY KEY,
    down_avg REAL, up_avg REAL,
    down_max REAL, up_max REAL,
    n        INTEGER NOT NULL
  );
  `,

  // 3 - mains vs battery power tracking
  `
  -- One row per contiguous stretch on a single power source. Written both
  -- live and after the fact: when the monitor is itself on mains it dies with
  -- the light, so the spans covering a cut are reconstructed on the next boot
  -- from the ONT's own uptime counter.
  CREATE TABLE IF NOT EXISTS power_spans (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    state  TEXT    NOT NULL,
    start  INTEGER NOT NULL,
    end    INTEGER,
    source TEXT    NOT NULL DEFAULT 'live',
    detail TEXT    NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_power_start ON power_spans (start);
  CREATE INDEX IF NOT EXISTS idx_power_open  ON power_spans (end) WHERE end IS NULL;

  -- A device with no battery of its own that is never switched off. Its
  -- disappearance while the router still answers is the only direct evidence
  -- this system can get that the mains supply has gone.
  ALTER TABLE devices ADD COLUMN mains_witness INTEGER NOT NULL DEFAULT 0;
  `,
];
