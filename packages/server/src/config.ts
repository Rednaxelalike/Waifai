import { resolve } from 'node:path';

/**
 * All runtime configuration, read from the environment exactly once.
 *
 * Secrets are never given defaults: an unset ONT password should fail loudly
 * at boot rather than silently produce a monitor that reports "ONT down"
 * forever. Everything else has a sensible default so a fresh clone runs.
 */

function str(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number, got ${JSON.stringify(v)}`);
  return n;
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

function list(name: string, fallback: string[]): string[] {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

const root = resolve(import.meta.dirname, '../../..');

export const config = {
  root,

  server: {
    host: str('HOST', '0.0.0.0'),
    port: num('PORT', 8477),
    /** Serve the built PWA from this directory when it exists. */
    webRoot: resolve(root, 'packages/web/dist'),
    /**
     * Optional shared passphrase. Left empty by default because the intended
     * deployment is LAN-only plus Tailscale, where the tailnet is the auth
     * boundary. Set it if you expose the port more widely.
     */
    accessCode: str('ACCESS_CODE', ''),
    /**
     * A TLS certificate and its private key, in PEM. Both or neither.
     *
     * This is not about eavesdroppers on your own LAN. It is what makes the
     * dashboard installable: a browser only registers a service worker on a
     * secure origin, and `http://192.168.x.x` is not one however local it is.
     * Served over plain http, "Add to home screen" on Android gives a browser
     * shortcut rather than the app, and nothing is ever cached for offline -
     * which is precisely the state you need it in during an outage.
     *
     * Loopback is the exception browsers make, so a desktop looking at
     * 127.0.0.1 sees the full PWA and the phone on the same LAN does not.
     * That asymmetry is the whole reason this setting exists. The README has
     * the `tailscale serve` recipe, which is the way to get a genuinely
     * trusted certificate for a machine with no public DNS name.
     */
    tlsCert: str('TLS_CERT_FILE', ''),
    tlsKey: str('TLS_KEY_FILE', ''),
  },

  db: {
    file: resolve(str('DB_FILE', resolve(root, 'data/waifai.sqlite'))),
    /** Raw high-frequency samples older than this are rolled up and deleted. */
    rawRetentionDays: num('RAW_RETENTION_DAYS', 14),
    /** Hourly rollups are kept far longer; they are tiny. */
    rollupRetentionDays: num('ROLLUP_RETENTION_DAYS', 730),
  },

  ont: {
    host: str('ONT_HOST', '192.168.100.1'),
    /** http only. These ONTs ship a self-signed cert at best. */
    baseUrl: `http://${str('ONT_HOST', '192.168.100.1')}`,
    user: str('ONT_USER', 'root'),
    pass: str('ONT_PASS', ''),
    /**
     * Optional second credential. `telecomadmin` sees WAN and PON pages that
     * `root` cannot. When set, the client prefers it and falls back to `root`.
     */
    adminUser: str('ONT_ADMIN_USER', ''),
    adminPass: str('ONT_ADMIN_PASS', ''),
    timeoutMs: num('ONT_TIMEOUT_MS', 12_000),
    /**
     * The ONT permits a single concurrent web session. Every poll logs out
     * afterwards, otherwise the household is locked out of the router UI.
     */
    logoutAfterPoll: bool('ONT_LOGOUT_AFTER_POLL', true),
    /** Where --discover writes raw page bodies for regex tuning. */
    dumpDir: resolve(root, 'page_dumps'),
  },

  intervals: {
    /** Optical, WAN counters, DHCP table. One ONT session per tick. */
    ontPollSec: num('ONT_POLL_SEC', 60),
    /** Cheap ICMP sweep. This is what gives outage detection its resolution. */
    probeSec: num('PROBE_SEC', 20),
    /** ARP sweep for presence, independent of the ONT DHCP table. */
    presenceSec: num('PRESENCE_SEC', 120),
    speedtestMin: num('SPEEDTEST_MIN', 180),
    /** Rollup + retention sweep. */
    maintenanceMin: num('MAINTENANCE_MIN', 60),
  },

  probes: {
    /** The ONT itself. If this fails, nothing else tells you anything useful. */
    ont: str('PROBE_ONT', str('ONT_HOST', '192.168.100.1')),
    /**
     * The default gateway for internet traffic. On MTN FibreX the ONT is
     * usually also the gateway, so leave this empty to auto-detect the first
     * hop beyond the ONT.
     */
    gateway: str('PROBE_GATEWAY', ''),
    internet: list('PROBE_INTERNET', ['1.1.1.1', '8.8.8.8']),
    /**
     * A host inside Nigeria, to split local from global reachability: it tells
     * you whether MTN broke or an international transit link did.
     *
     * Empty by default on purpose. There is no Nigerian address that reliably
     * answers ICMP for everyone, and shipping one that silently blackholes
     * would draw a permanent 100% loss line on the chart and teach you to
     * ignore it. See the README for finding one from your own traceroute.
     */
    localNg: list('PROBE_LOCAL_NG', []),
    dnsNames: list('PROBE_DNS_NAMES', ['google.com', 'mtn.ng']),
    /** Packets per burst. Higher is a better loss estimate but slower. */
    count: num('PROBE_COUNT', 5),
    /**
     * Per-packet wait. This is the number that bounds a sweep: a target that
     * blackholes traffic costs `count * timeout`, because the system ping
     * waits out every packet in turn. Keep `count * timeout` comfortably under
     * PROBE_SEC or sweeps will overrun their own interval.
     */
    timeoutMs: num('PROBE_TIMEOUT_MS', 1000),
    /** Sustained loss above this fraction opens a `degraded` incident. */
    degradedLoss: num('DEGRADED_LOSS', 0.2),
    /** Sustained RTT above this to the internet tier counts as degraded. */
    degradedRttMs: num('DEGRADED_RTT_MS', 300),
    /** Consecutive failing sweeps before an incident opens. Debounces blips. */
    failuresToOpen: num('FAILURES_TO_OPEN', 3),
    /** Consecutive good sweeps before an incident closes. */
    successesToClose: num('SUCCESSES_TO_CLOSE', 3),
  },

  presence: {
    /**
     * Ping every address in the LAN /24 before reading the ARP table. Without
     * it, ARP only shows devices that happened to talk to this host recently,
     * which on a quiet network is almost none of them.
     */
    sweepEnabled: bool('PRESENCE_SWEEP', true),
    /** Any address inside the LAN; only the first three octets are used. */
    subnetBase: str('LAN_SUBNET', str('ONT_HOST', '192.168.100.1')),
    /** How long a device may go unseen before it counts as gone. */
    offlineAfterSec: num('PRESENCE_OFFLINE_AFTER_SEC', 600),
  },

  power: {
    /**
     * True when the machine running this monitor is plugged into the same
     * battery pack or UPS as the router.
     *
     * This one flag decides how much can be known. Left false - the monitor is
     * on the wall socket - the monitor dies with the light, so a cut is only
     * ever reconstructed afterwards from the router's uptime counter, and the
     * exact moment the pack gave out is unobservable. Set true, and every
     * transition is watched as it happens. Putting a Pi or an old phone on the
     * same pack as the router is the single change that makes this exact.
     */
    monitorOnBattery: bool('POWER_MONITOR_ON_BATTERY', false),
    /**
     * Probe sweeps a new power state must persist for before it is recorded.
     * One dropped ping should not enter the log as a power cut.
     */
    confirmSamples: num('POWER_CONFIRM_SAMPLES', 2),
    /**
     * Slack when comparing two computed boot times, seconds. The router
     * reports whole seconds and is polled a minute apart, so the same boot
     * lands a few seconds off each time; anything under this is the same boot.
     */
    bootDriftSec: num('POWER_BOOT_DRIFT_SEC', 180),
    /** Warn once the router has been on the pack this long. 0 disables it. */
    batteryWarnMin: num('POWER_BATTERY_WARN_MIN', 20),
  },

  speedtest: {
    enabled: bool('SPEEDTEST_ENABLED', true),
    /**
     * Path to the Ookla CLI. When absent, the collector falls back to a plain
     * HTTP download measurement, which is less accurate but needs nothing
     * installed.
     */
    ooklaBin: str('SPEEDTEST_BIN', 'speedtest'),
    /** Size in MB pulled by the HTTP fallback. */
    fallbackMb: num('SPEEDTEST_FALLBACK_MB', 25),
    /** What you actually pay for, for the "am I getting my plan?" comparison. */
    planDownMbps: num('PLAN_DOWN_MBPS', 0),
    planUpMbps: num('PLAN_UP_MBPS', 0),
  },

  usage: {
    /** Monthly cap in GB. 0 means uncapped. */
    capGb: num('USAGE_CAP_GB', 0),
    /** Billing cycle start day of month, for the projection. */
    cycleStartDay: num('BILLING_CYCLE_DAY', 1),
    /** IANA zone used to bucket days. */
    timezone: str('TZ_NAME', 'Africa/Lagos'),
  },

  alerts: {
    /** ntfy.sh topic, or a self-hosted ntfy URL. Empty disables ntfy. */
    ntfyUrl: str('NTFY_URL', ''),
    /** Generic webhook receiving the raw JSON event. */
    webhookUrl: str('ALERT_WEBHOOK_URL', ''),
    telegramToken: str('TELEGRAM_BOT_TOKEN', ''),
    telegramChatId: str('TELEGRAM_CHAT_ID', ''),
    /** Do not re-alert the same condition more often than this. */
    cooldownMin: num('ALERT_COOLDOWN_MIN', 15),
    onNewDevice: bool('ALERT_NEW_DEVICE', true),
    onOpticalDrift: bool('ALERT_OPTICAL_DRIFT', true),
    /** Alert when month-to-date usage crosses this fraction of the cap. */
    usageThreshold: num('ALERT_USAGE_THRESHOLD', 0.8),
  },

  optical: {
    /** Window for the drift regression. */
    trendWindowDays: num('OPTICAL_TREND_DAYS', 30),
    /** Sustained decline steeper than this (dB/day) is flagged as degrading. */
    driftDbPerDay: num('OPTICAL_DRIFT_DB_PER_DAY', 0.05),
    /** Absolute floor. Below this, alert regardless of trend. */
    rxFloorDbm: num('OPTICAL_RX_FLOOR', -26),
  },

  wifi: {
    /** Used to render the guest QR code. Never leaves the LAN. */
    ssid: str('WIFI_SSID', ''),
    password: str('WIFI_PASSWORD', ''),
    /** WPA, WEP or nopass. */
    security: str('WIFI_SECURITY', 'WPA'),
  },
} as const;

export type Config = typeof config;

/** Fail fast on configuration that would make the collector silently useless. */
export function assertUsableConfig(): void {
  const problems: string[] = [];
  if (!config.ont.pass && !config.ont.adminPass) {
    problems.push(
      'ONT_PASS is not set. Copy .env.example to .env and put the ONT web password in it. ' +
        'Without it every ONT poll fails and the dashboard shows a permanent outage.',
    );
  }
  if (Boolean(config.server.tlsCert) !== Boolean(config.server.tlsKey)) {
    problems.push(
      'TLS_CERT_FILE and TLS_KEY_FILE go together. With one of them set the server would fall ' +
        'back to http and quietly stop being installable on a phone, which is the only reason ' +
        'to set either.',
    );
  }
  if (config.intervals.probeSec < 5) {
    problems.push('PROBE_SEC below 5 will hammer the ONT for no extra resolution.');
  }
  // A blackholed target costs count * timeout, and every sweep pays that in
  // full. If the worst case exceeds the interval, sweeps queue behind each
  // other and the outage timeline quietly loses resolution.
  const worstSweepSec = (config.probes.count * config.probes.timeoutMs) / 1000;
  if (worstSweepSec > config.intervals.probeSec) {
    problems.push(
      `A sweep can take up to ${worstSweepSec}s (PROBE_COUNT x PROBE_TIMEOUT_MS) but PROBE_SEC is ` +
        `${config.intervals.probeSec}s. Raise PROBE_SEC, or lower PROBE_COUNT / PROBE_TIMEOUT_MS.`,
    );
  }
  if (problems.length) {
    throw new Error(`Configuration problem:\n  - ${problems.join('\n  - ')}`);
  }
}
