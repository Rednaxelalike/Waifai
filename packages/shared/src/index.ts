/**
 * Types shared between the collector/API server and the PWA.
 * Kept dependency-free so both sides can import it cheaply.
 */

/** Millisecond epoch. Every timestamp in the system is UTC ms. */
export type Millis = number;

// ---------------------------------------------------------------------------
// Line health
// ---------------------------------------------------------------------------

/** One poll of the ONT optical/PON page. */
export interface OpticalSample {
  ts: Millis;
  /** Received optical power in dBm. Healthy GPON is roughly -8 to -27. */
  rxPower: number | null;
  /** Transmitted optical power in dBm. */
  txPower: number | null;
  /** Laser bias current, mA. Rising bias with falling tx suggests an ageing laser. */
  biasCurrent: number | null;
  /** Optical module supply voltage, V. */
  voltage: number | null;
  /** ONT temperature, degrees C. */
  temperature: number | null;
  /** Raw PON state string as the ONT reports it, e.g. "O5" or "Online". */
  ponStatus: string | null;
}

/** One poll of the ONT WAN page. */
export interface WanSample {
  ts: Millis;
  up: boolean;
  /** Public IPv4 as seen by the ONT. Usually CGNAT space on MTN FibreX. */
  ipv4: string | null;
  ipv6: string | null;
  /** Seconds the current WAN session has been up, if the ONT exposes it. */
  connectionUptimeSec: number | null;
  /** Cumulative WAN byte counters. Monotonic until the ONT reboots. */
  rxBytes: number | null;
  txBytes: number | null;
}

/** Derived instantaneous throughput between two WAN counter reads. */
export interface ThroughputPoint {
  ts: Millis;
  /** Bits per second, download. */
  downBps: number;
  /** Bits per second, upload. */
  upBps: number;
}

// ---------------------------------------------------------------------------
// Reachability probes
// ---------------------------------------------------------------------------

/**
 * Probe tiers exist to localise a fault. If `ont` is fine but `gateway` is
 * dead, the problem is the fibre or the OLT. If `gateway` is fine but
 * `internet` is dead, it is upstream of the MTN edge. If everything answers
 * but `dns` is slow, it is a resolver problem, not a line problem.
 */
export type ProbeTier = 'ont' | 'gateway' | 'internet' | 'local_ng' | 'dns';

export interface ProbeSample {
  ts: Millis;
  target: string;
  tier: ProbeTier;
  /** Round-trip time in ms, averaged over the burst. Null when every packet was lost. */
  rttMs: number | null;
  /** Standard deviation of RTT across the burst, ms. */
  jitterMs: number | null;
  /** 0..1 */
  loss: number;
  ok: boolean;
}

export interface SpeedtestSample {
  ts: Millis;
  downMbps: number;
  upMbps: number;
  pingMs: number | null;
  jitterMs: number | null;
  serverName: string | null;
  /** One of: ookla, librespeed, http-fallback, manual. */
  source: string;
}

// ---------------------------------------------------------------------------
// Devices and presence
// ---------------------------------------------------------------------------

export interface Device {
  mac: string;
  /** Hostname as reported by DHCP/ARP. Often useless, e.g. "android-a1b2c3". */
  hostname: string | null;
  /** Human-assigned name. Set from the PWA. */
  label: string | null;
  /** Which household member this belongs to. Free text, set from the PWA. */
  owner: string | null;
  ip: string | null;
  /** Vendor guessed from the MAC OUI prefix. */
  vendor: string | null;
  /** One of: ethernet, 2.4G, 5G, unknown. */
  connection: string;
  firstSeen: Millis;
  lastSeen: Millis;
  /**
   * When the device joined the span of presence it is currently in - not when
   * it was last seen, which ticks forward with every sweep. Null while it is
   * offline.
   */
  onlineSince: Millis | null;
  online: boolean;
  /** Suppress "new device" alerts and hide from the household view. */
  trusted: boolean;
  /**
   * Marked as a device that only ever runs on mains: no battery, no UPS,
   * always switched on. When every one of these drops off the network at once
   * while the router is still answering, the light is off and the router is
   * running on its battery pack.
   */
  mainsWitness: boolean;
  /** Signal strength in dBm where the ONT exposes it for wireless clients. */
  rssi: number | null;
}

/** A contiguous span during which a device was present on the network. */
export interface PresenceSession {
  mac: string;
  start: Millis;
  end: Millis | null;
}

// ---------------------------------------------------------------------------
// Incidents
// ---------------------------------------------------------------------------

/**
 * Why the connection was considered down. The distinction is the entire point
 * of the incident log: `pon_down` is an MTN problem and is worth a support
 * ticket, `collector_down` usually just means the house lost power.
 */
export type IncidentKind =
  | 'pon_down'         // Fibre/OLT: ONT answers but the PON link is not O5.
  | 'wan_down'         // ONT and PON fine, but no WAN session or no route out.
  | 'ont_unreachable'  // ONT itself did not answer: ONT power, cable, or reboot.
  | 'collector_down'   // The monitor itself was off. Usually mains power.
  | 'dns_failure'      // Route out is fine, name resolution is not.
  | 'degraded';        // Reachable but sustained heavy loss or latency.

export type IncidentSeverity = 'info' | 'warn' | 'critical';

export interface Incident {
  id: number;
  kind: IncidentKind;
  severity: IncidentSeverity;
  start: Millis;
  end: Millis | null;
  /** Null while ongoing. */
  durationSec: number | null;
  /** Human-readable explanation built at detection time. */
  detail: string;
  /** Set from the PWA: what MTN said, ticket numbers, what fixed it. */
  note: string | null;
}

// ---------------------------------------------------------------------------
// Mains power
// ---------------------------------------------------------------------------

/**
 * What is keeping the router alive.
 *
 * `mains` and `battery` both mean the Wi-Fi is on; the difference is whether
 * the light is on or the battery pack is carrying it, which is the difference
 * between "nothing to do" and "the clock is running". `off` means the router
 * has no power at all - no light and a flat pack - so there is no Wi-Fi.
 * `unknown` is used honestly and often: nothing here can see a wall socket, so
 * every verdict is an inference, and one that cannot be made says so.
 */
export type PowerState = 'mains' | 'battery' | 'off' | 'unknown';

/**
 * `live` spans were watched as they happened. `reconstructed` ones were worked
 * out afterwards from the router's own uptime counter, because the monitor was
 * off for them - which, for a monitor that is itself on mains, is exactly when
 * the interesting things happen.
 */
export type PowerSource = 'live' | 'reconstructed';

/** A contiguous stretch during which the router was on one power source. */
export interface PowerSpan {
  id: number;
  state: PowerState;
  start: Millis;
  end: Millis | null;
  /** Null while ongoing. */
  durationSec: number | null;
  source: PowerSource;
  /** How this span was decided, in one sentence. */
  detail: string;
}

/** The compact form carried on every status update. */
export interface PowerNow {
  state: PowerState;
  /** When the current state began. */
  since: Millis | null;
  /** Why we believe it, in one sentence a housemate can check. */
  because: string;
  /** True when the router has power from something, so the Wi-Fi is up. */
  wifiOn: boolean;
  /** Continuous seconds the router has been powered, from its own counter. */
  ontUptimeSec: number | null;
  /** Shortest battery hold that has actually ended in a flat pack, seconds. */
  batteryRuntimeSec: number | null;
}

export interface PowerSummary extends PowerNow {
  window: { from: Millis; to: Millis };
  /** Seconds in each state across the window. Unobserved time is `unknown`. */
  totals: Record<PowerState, number>;
  /** Separate stretches where the mains supply was off, however they ended. */
  mainsCuts: number;
  /** Longest stretch the pack has carried the router, seconds. */
  longestBatteryHoldSec: number | null;
  /** Mains-only devices being used as witnesses. */
  witnesses: { total: number; online: number; monitorCounts: boolean };
  spans: PowerSpan[];
  /** Restoration prediction for the active outage (if light is currently off). */
  prediction?: PowerPrediction | null;
  /** Historical grid availability patterns and weekly heatmap. */
  patterns?: PowerPatternStats | null;
}

export type PredictionConfidence = 'high' | 'medium' | 'low' | 'none';

export interface PowerPrediction {
  /** Estimated timestamp when light will return, or null if mains is on or undetermined. */
  expectedRestoreTs: Millis | null;
  /** Estimated total duration of the current cut in seconds. */
  expectedDurationSec: number | null;
  /** Confidence in the estimation. */
  confidence: PredictionConfidence;
  /** Human-readable rationale for the prediction. */
  basis: string | null;
  /** Detected ongoing rotational rhythm (e.g. ~4h ON / ~4h OFF). */
  detectedCycle: {
    onSec: number;
    offSec: number;
    reliability: number;
  } | null;
}

export interface PowerPatternStats {
  /** Median duration of historical mains power outages in seconds. */
  medianOutageSec: number | null;
  /** Average hours per day with mains power. */
  averageMainsHoursPerDay: number | null;
  /** Hours of day (0..23 in local timezone) when outages most frequently begin. */
  peakOutageHours: number[];
  /** Longest uninterrupted mains power stretch in seconds. */
  longestMainsStreakSec: number | null;
  /**
   * 7 x 24 availability matrix (Monday=0 to Sunday=6, Hour=0 to 23 in local timezone).
   * Values are percentage 0..100 representing probability mains was ON, or
   * `null` for an hour with too little observation to say anything - which is
   * most of the grid until the monitor has been running for a few weeks.
   */
  weeklyHeatmap: (number | null)[][];
  /** Total number of separate completed power cuts analyzed. */
  totalOutagesAnalyzed: number;
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

export interface UsageBucket {
  /** ISO date (YYYY-MM-DD) in the configured local timezone. */
  day: string;
  downBytes: number;
  upBytes: number;
}

export interface UsageSummary {
  monthToDateBytes: number;
  /** Straight-line projection to the end of the current month. */
  projectedMonthBytes: number;
  /** Configured cap in bytes, or null when the plan is uncapped. */
  capBytes: number | null;
  days: UsageBucket[];

  /*
   * Which month this is a month of.
   *
   * Every total above is a total over a window, and the window is the billing
   * cycle rather than the calendar: on a plan that bills from the 5th, "this
   * month" runs 5 Aug to 4 Sep. A card that says "this month" without saying
   * which one is asking to be read as the calendar month it is not, so the
   * window travels with the numbers instead of being implied by them.
   */
  /** First day of the current cycle, YYYY-MM-DD in the household's timezone. */
  cycleStart: string;
  /** Its last day, inclusive - the day the projection projects to. */
  cycleEnd: string;
  /*
   * The day the totals are through.
   *
   * Buckets are cut in the household's configured timezone and the phone
   * reading them may be in a different one, or simply - late at night - on a
   * different date. Which day "today" was is the server's to state.
   */
  today: string;
}

// ---------------------------------------------------------------------------
// Optical drift
// ---------------------------------------------------------------------------

export interface OpticalTrend {
  /** Least-squares slope of Rx power over the window, dB per day. */
  slopePerDay: number | null;
  /** Mean Rx power over the window, dBm. */
  meanRx: number | null;
  windowDays: number;
  samples: number;
  /** True when the line is drifting down fast enough to matter. */
  degrading: boolean;
  /** Plain-language reading of the numbers above. */
  verdict: string;
}

// ---------------------------------------------------------------------------
// Aggregate views the PWA consumes
// ---------------------------------------------------------------------------

export type OverallStatus = 'up' | 'degraded' | 'down' | 'unknown';

/** The single payload behind the "is the internet working?" card. */
export interface StatusSnapshot {
  ts: Millis;
  status: OverallStatus;
  /** One sentence a non-technical housemate can act on. */
  headline: string;
  optical: OpticalSample | null;
  wan: WanSample | null;
  throughput: ThroughputPoint | null;
  probes: ProbeSample[];
  devicesOnline: number;
  /** What is powering the router right now, and how sure we are. */
  power: PowerNow;
  activeIncident: Incident | null;
  /** Seconds since the last incident ended. */
  uptimeSec: number | null;
  lastSpeedtest: SpeedtestSample | null;
}

export interface UptimeReport {
  from: Millis;
  to: Millis;
  /** 0..100 */
  uptimePct: number;
  totalDowntimeSec: number;
  incidentCount: number;
  byKind: Record<string, { count: number; downtimeSec: number }>;
  incidents: Incident[];
}

// ---------------------------------------------------------------------------
// Notices (household noticeboard)
// ---------------------------------------------------------------------------

export interface Notice {
  id: number;
  ts: Millis;
  author: string;
  body: string;
  /** Pinned notices sort to the top and survive the auto-expiry sweep. */
  pinned: boolean;
}

// ---------------------------------------------------------------------------
// Subscription
// ---------------------------------------------------------------------------

/**
 * One payment for the line, and the window it bought.
 *
 * None of this comes off the router. The ONT reports light and bytes; it has
 * never heard of a plan, a receipt or an expiry date, and MTN's own portal is
 * behind a login this monitor has no business holding. So a subscription is a
 * record the household keeps, and everything derived from it is arithmetic on
 * dates somebody typed in after paying.
 *
 * Three dates rather than one because they are genuinely three different days.
 * The payment clears when it clears; the plan starts when MTN turns it on,
 * which can be that afternoon or the next morning; and the expiry is the only
 * one of the three that decides whether there is internet tomorrow.
 */
export interface Subscription {
  id: number;
  /** When the money left the account. */
  paidTs: Millis;
  /** When the plan actually started running. */
  startTs: Millis;
  /** When it lapses. Entered as a day, stored as the last instant of that day. */
  endTs: Millis;
  /** What was bought, in the household's own words, e.g. "FibreX 25 Mbps". */
  plan: string;
  /** Naira. Null when nobody wrote the amount down. */
  amount: number | null;
  /** Receipt or transaction reference - the thing a support desk asks for. */
  reference: string | null;
  note: string | null;
}

/** The fields a person fills in. Everything else about a subscription is derived. */
export type SubscriptionInput = Omit<Subscription, 'id'>;

/** Where the line stands on being paid for. */
export interface SubscriptionSummary {
  /** The server's clock at the moment this was built, so countdowns agree. */
  now: Millis;
  /** The record covering `now`, or null when nothing recorded covers today. */
  current: Subscription | null;
  /** Paid for but not started: a renewal bought before the old one ran out. */
  upcoming: Subscription | null;
  /** The most recent lapsed record, which is what to show when nothing is current. */
  previous: Subscription | null;
  /**
   * Seconds until the paid-up window ends. Negative once it has ended, which
   * is how long the line has been running unpaid - a fact worth as much as the
   * countdown, and the same number either way.
   */
  remainingSec: number | null;
  /** How much of the current window is spent, 0..1. Null when nothing is current. */
  elapsedFraction: number | null;
  /**
   * What previous subscriptions ran for, in whole days. It fills in the expiry
   * when the next payment is recorded, so renewing is three taps rather than a
   * calculation on a calendar.
   */
  typicalDays: number | null;
  /** Newest first, including whatever is current. */
  history: Subscription[];
}

// ---------------------------------------------------------------------------
// WebSocket envelope
// ---------------------------------------------------------------------------

export type ServerEvent =
  | { type: 'status'; payload: StatusSnapshot }
  | { type: 'incident_opened'; payload: Incident }
  | { type: 'incident_closed'; payload: Incident }
  | { type: 'device_new'; payload: Device }
  | { type: 'power'; payload: PowerNow }
  | { type: 'speedtest'; payload: SpeedtestSample }
  | { type: 'notice'; payload: Notice };

// ---------------------------------------------------------------------------
// Helpers usable from both sides
// ---------------------------------------------------------------------------

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatBps(bps: number): string {
  if (!Number.isFinite(bps) || bps <= 0) return '0 bps';
  const units = ['bps', 'Kbps', 'Mbps', 'Gbps'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bps) / Math.log(1000)));
  return `${(bps / 1000 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '-';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

/**
 * Money, for the one currency this line is ever paid in.
 *
 * Not configurable, deliberately. Everything else here is already specific to
 * an MTN FibreX line in Lagos - the probe tiers, the timezone default - and a
 * currency setting nobody would ever change is one more setting to maintain.
 * Whole naira unless the amount genuinely has kobo in it: a bill of
 * "25,000.00" spends two characters saying nothing.
 */
export function formatNaira(amount: number): string {
  if (!Number.isFinite(amount)) return '-';
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  }).format(amount);
}

/**
 * Health banding for GPON receive power. These are the thresholds ISPs
 * generally work to: below -27 dBm most ONTs start losing sync.
 */
export function rxPowerBand(dbm: number | null): 'good' | 'fair' | 'poor' | 'unknown' {
  if (dbm === null || !Number.isFinite(dbm)) return 'unknown';
  if (dbm >= -25 && dbm <= -8) return 'good';
  if (dbm >= -27 && dbm < -25) return 'fair';
  return 'poor';
}
