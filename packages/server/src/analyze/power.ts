import {
  formatDuration,
  type Millis,
  type PowerNow,
  type PowerPatternStats,
  type PowerPrediction,
  type PowerSpan,
  type PowerState,
  type PowerSummary,
  type PredictionConfidence,
} from '@waifai/shared';
import { config } from '../config.ts';
import type { Db } from '../db/index.ts';
import { logger } from '../log.ts';

const log = logger('power');

/**
 * Is the Wi-Fi on, and if it is, what is keeping it on?
 *
 * Nothing here can see a wall socket, so every answer is an inference drawn
 * from three things: whether the router answers a ping, whether devices that
 * have no battery of their own are still on the network, and - the one that
 * does the real work - the router's own uptime counter.
 *
 * That counter is what makes an unwatched power cut recoverable. Uptime is the
 * router saying "I have been on since 18:42", so a monitor that was dead for
 * three hours can still come back and say, with evidence, whether the router
 * stayed up through them. Without it the whole window would be a shrug.
 *
 * The limit is worth stating plainly, because it decides how the output reads:
 * when the monitor is on the wall socket it dies at the same instant the light
 * does. It can then prove the router survived a cut, or prove it did not, but
 * it cannot see the minute the battery pack gave out - nothing was awake to
 * watch. Putting the monitor on the same pack as the router removes that blind
 * spot entirely, which is the whole reason POWER_MONITOR_ON_BATTERY exists.
 */

const META_GAP = 'power_gap_pending';
const META_BOOT = 'ont_boot_ts';
const META_CLEAN = 'shutdown_clean';

/** How long to wait for an uptime reading before giving up on a gap. */
const GAP_RESOLVE_TIMEOUT_MS = 15 * 60_000;

export interface PowerVerdict {
  state: PowerState;
  because: string;
}

export interface PowerChange {
  opened?: PowerSpan;
  closed?: PowerSpan;
}

interface PendingGap {
  from: Millis;
  to: Millis;
}

/**
 * Decide what is powering the router from what can be seen right now.
 *
 * Ordered by what the evidence is worth. A router that does not answer is the
 * only thing here that is directly observed rather than inferred, so it wins
 * outright; everything below it is an argument from absence.
 */
export function decidePower(
  db: Db,
  ontUp: boolean,
  // Passed rather than read straight from config so a test can exercise both
  // deployments without reaching into the environment.
  monitorOnBattery = config.power.monitorOnBattery,
): PowerVerdict {
  if (!ontUp) {
    return {
      state: 'off',
      /*
       * One clause, not a paragraph. These strings are read under a headline
       * that has already said what the state is, so anything restating it is
       * text the reader has to skip to reach the evidence.
       */
      because: monitorOnBattery
        ? 'The router is not answering. The pack has run flat, or the router has a fault.'
        : 'This monitor is on the wall socket and still running, so the light is on - the fault is the router.',
    };
  }

  const witness = db.mainsWitnessCounts();

  // The monitor is itself a mains-only device. If it is executing this line it
  // has power, and there is nothing left to infer.
  if (!monitorOnBattery) {
    return {
      state: 'mains',
      because: 'This monitor runs off the wall socket, and it is running.',
    };
  }

  if (witness.online > 0) {
    return {
      state: 'mains',
      because:
        witness.total === 1
          ? 'The mains-only device is still on the network.'
          : `${witness.online} of ${witness.total} mains-only devices are still on the network.`,
    };
  }

  if (witness.total > 0) {
    return {
      state: 'battery',
      because:
        witness.total === 1
          ? 'The one mains-only device dropped off the network, and the router did not.'
          : `All ${witness.total} mains-only devices dropped off the network at once.`,
    };
  }

  return {
    state: 'unknown',
    because:
      'Nothing here can tell the mains from the pack. Mark an always-on device with no battery of ' +
      'its own as a power witness, on the Devices tab.',
  };
}

/**
 * Stateful detector, held for the process lifetime.
 *
 * Deliberately does no alerting of its own: it returns the boundary it crossed
 * and the probe collector decides what is worth a notification, the same
 * division of labour the incident tracker uses.
 */
export class PowerTracker {
  private pendingState: PowerState | null = null;
  private pendingCount = 0;
  // Written out longhand rather than as a parameter property, because Node's
  // built-in type stripping rejects those and running the sources directly is
  // what keeps `npm run dev` free of a build step.
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  /**
   * Feed one probe sweep.
   *
   * The confirm count is the debounce. Without it a single dropped ping to the
   * router would enter the household's power log as a blackout, and a log that
   * cries wolf is one nobody reads when it matters.
   */
  update(ts: Millis, ontUp: boolean): PowerChange {
    this.expireStaleGap(ts);

    const verdict = decidePower(this.db, ontUp);
    const change: PowerChange = {};

    if (verdict.state === this.pendingState) this.pendingCount++;
    else {
      this.pendingState = verdict.state;
      this.pendingCount = 1;
    }

    const current = this.db.currentPowerSpan();
    if (!current) {
      change.opened = this.db.openPowerSpan(verdict.state, ts, 'live', verdict.because);
      return change;
    }
    if (current.state === verdict.state) return change;
    if (this.pendingCount < config.power.confirmSamples) return change;

    // Backdate to the first sweep that saw the change rather than the one that
    // confirmed it, so the recorded times match what the house experienced.
    const at = Math.max(
      current.start + 1000,
      ts - (this.pendingCount - 1) * config.intervals.probeSec * 1000,
    );
    change.closed = this.db.closePowerSpan(current.id, at) ?? undefined;
    change.opened = this.db.openPowerSpan(verdict.state, at, 'live', verdict.because);
    log.info(`power: ${current.state} -> ${verdict.state}`);
    return change;
  }

  /**
   * Called with the router's own boot time on every successful ONT poll.
   *
   * Three jobs, all of them things only the uptime counter can settle: resolve
   * a gap the monitor slept through, notice a restart that happened while it
   * was awake, and take back a "power cut" the counter proves never was.
   */
  noteOntBoot(bootTs: Millis): void {
    const drift = config.power.bootDriftSec * 1000;
    const known = Number(this.db.getMeta(META_BOOT) ?? '0') || null;

    const gap = this.pendingGap();
    if (gap) this.resolveGap(gap, bootTs);
    else if (known !== null && bootTs > known + drift) {
      log.warn(`the router restarted at ${clock(bootTs)}`);
      this.confirmOutageWasPowerLoss(bootTs);
    }

    this.reviseOutageThatWasNotPowerLoss(bootTs, drift);

    // The reported uptime is whole seconds read a minute apart, so the same
    // boot lands a few seconds off every time. Only move the stored value when
    // it is genuinely a different boot, or the timeline jitters for no reason.
    if (known === null || Math.abs(bootTs - known) > drift) {
      this.db.setMeta(META_BOOT, String(bootTs));
    }
  }

  /**
   * Run at startup, before anything overwrites the heartbeat.
   *
   * A gap in the heartbeat means the monitor was not running. What that gap
   * *was* cannot be decided yet - it takes the router's uptime, and the router
   * has not been polled at this point - so the window is parked here and
   * settled by the first poll that gets one.
   */
  beginGapReconstruction(now = Date.now()): void {
    const last = Number(this.db.getMeta('heartbeat') ?? '0');
    const cleanStop = this.db.getMeta(META_CLEAN) === '1';
    this.db.setMeta(META_CLEAN, '0');
    if (!last) return;

    const gapMs = now - last;
    const threshold = Math.max(3 * config.intervals.probeSec * 1000, 120_000);
    if (gapMs < threshold) return;

    // Whatever was open stopped being observed the moment we died. Leaving it
    // open would let one span swallow the entire outage and report the house
    // as being on mains right through a blackout.
    const open = this.db.currentPowerSpan();
    if (open) this.db.closePowerSpan(open.id, last);

    if (cleanStop) {
      // Someone stopped the monitor on purpose. There is nothing to infer, and
      // inventing a power cut out of a deliberate restart would be worse than
      // the honest hole this leaves in the timeline.
      log.info(`monitor was stopped deliberately for ${formatDuration(gapMs / 1000)}; not treated as a cut`);
      return;
    }

    this.db.setMeta(META_GAP, JSON.stringify({ from: last, to: now } satisfies PendingGap));
    log.warn(
      `monitor died without shutting down and was away for ${formatDuration(gapMs / 1000)}; ` +
        "waiting on the router's uptime to explain it",
    );
  }

  /** Stamped on a graceful shutdown so a restart is not read as a power cut. */
  markCleanShutdown(): void {
    this.db.setMeta(META_CLEAN, '1');
  }

  /** The compact form the status payload and the WebSocket both carry. */
  now(): PowerNow {
    const span = this.db.currentPowerSpan();
    const bootTs = Number(this.db.getMeta(META_BOOT) ?? '0') || null;
    const stats = batteryStats(this.db);
    return {
      state: span?.state ?? 'unknown',
      since: span?.start ?? null,
      because: span?.detail ?? 'Nothing has been observed yet.',
      wifiOn: span !== null && span.state !== 'off',
      ontUptimeSec: bootTs === null ? null : Math.round((Date.now() - bootTs) / 1000),
      batteryRuntimeSec: stats.runtimeSec,
    };
  }

  // -- internals -----------------------------------------------------------

  private pendingGap(): PendingGap | null {
    const raw = this.db.getMeta(META_GAP);
    if (!raw) return null;
    try {
      const gap = JSON.parse(raw) as PendingGap;
      return Number.isFinite(gap.from) && Number.isFinite(gap.to) ? gap : null;
    } catch {
      return null;
    }
  }

  /**
   * Settle a parked gap now that the router has said how long it has been up.
   *
   * Two cases, and the difference between them is the whole question the
   * household actually asks: did the Wi-Fi survive, or did it die?
   */
  private resolveGap(gap: PendingGap, bootTs: Millis): void {
    this.db.setMeta(META_GAP, '');
    const drift = config.power.bootDriftSec * 1000;
    const away = formatDuration((gap.to - gap.from) / 1000);
    const restarted = bootTs > gap.from + drift && bootTs < gap.to + drift;

    if (!restarted) {
      // The router has been up since before we died, so it never lost power.
      const state: PowerState = config.power.monitorOnBattery ? 'unknown' : 'battery';
      const detail = config.power.monitorOnBattery
        ? `The monitor stopped for ${away}, but the router never restarted, so the Wi-Fi stayed up right ` +
          'through it. What was feeding it cannot be told apart from here.'
        : `The light went off at ${clock(gap.from)} and this monitor died with it, but the router never ` +
          `restarted - the battery pack carried the Wi-Fi through the whole ${away}. The router has been ` +
          `up since ${clock(bootTs)}.`;
      this.db.insertPowerSpan(state, gap.from, gap.to, 'reconstructed', detail);
      log.info(`gap of ${away} reconstructed: the router stayed up throughout`);
      return;
    }

    // The router restarted inside the window, so at some point it had no power
    // at all. Where the battery stopped and the darkness started is exactly
    // what was not observed, and saying so is better than picking a minute.
    const stats = batteryStats(this.db);
    const guess =
      stats.runtimeSec !== null
        ? ` The pack has run flat after about ${formatDuration(stats.runtimeSec)} before, so the Wi-Fi ` +
          `probably went around ${clock(gap.from + stats.runtimeSec * 1000)}.`
        : stats.longestHoldSec !== null
          ? ` The pack has held for as long as ${formatDuration(stats.longestHoldSec)} before.`
          : '';

    this.db.insertPowerSpan(
      'unknown',
      gap.from,
      bootTs,
      'reconstructed',
      `The light went off at ${clock(gap.from)} and the router restarted at ${clock(bootTs)}. The pack ` +
        'carried the Wi-Fi for part of that and then gave out; nothing was running to see which minute.' +
        guess,
    );
    this.db.insertPowerSpan(
      'mains',
      bootTs,
      gap.to,
      'reconstructed',
      `The router powered itself back on at ${clock(bootTs)}, so the light was back on by then.`,
    );
    log.info(`gap of ${away} reconstructed: the router restarted at ${clock(bootTs)}`);
  }

  /**
   * A gap can only be settled by a router that reports its uptime. On firmware
   * that does not, waiting forever would leave the window silently missing, so
   * it gets written down as unexplained instead.
   */
  private expireStaleGap(ts: Millis): void {
    const gap = this.pendingGap();
    if (!gap || ts - gap.to < GAP_RESOLVE_TIMEOUT_MS) return;
    this.db.setMeta(META_GAP, '');
    this.db.insertPowerSpan(
      'unknown',
      gap.from,
      gap.to,
      'reconstructed',
      'The monitor was off for this window and the router did not report an uptime afterwards, so there ' +
        'is no way to say whether the Wi-Fi stayed up.',
    );
    log.warn('gave up reconstructing a gap: no uptime reading from the router');
  }

  /** A restart seen live confirms the outage recorded around it was real. */
  private confirmOutageWasPowerLoss(bootTs: Millis): void {
    const last = this.db.lastClosedPowerSpan();
    if (!last || last.state !== 'off' || last.end === null) return;
    if (bootTs < last.start || bootTs > last.end + config.power.bootDriftSec * 1000) return;
    this.db.revisePowerSpan(
      last.id,
      'off',
      `${last.detail} The router restarted at ${clock(bootTs)}, which confirms it had lost power completely.`,
    );
  }

  /**
   * The correction that stops this log blaming power for everything.
   *
   * A router that stopped answering but whose uptime shows no restart never
   * lost power at all - it was a cable, a crash, or a router too busy to
   * reply. Recording that as a blackout would quietly inflate every figure on
   * the page, so the span is rewritten once the counter contradicts it.
   */
  private reviseOutageThatWasNotPowerLoss(bootTs: Millis, drift: number): void {
    const last = this.db.lastClosedPowerSpan();
    if (!last || last.state !== 'off' || last.source !== 'live') return;
    if (bootTs > last.start - drift) return;

    this.db.revisePowerSpan(
      last.id,
      'unknown',
      `The router stopped answering for ${formatDuration(last.durationSec ?? 0)}, but its own uptime ` +
        `shows it has been running since ${clock(bootTs)} without a break. It did not lose power: this ` +
        'was the network between here and it, or the router being too busy to reply.',
    );
    log.info('revised an outage that the router uptime shows was not a power cut');
  }
}

// ---------------------------------------------------------------------------
// Derived figures
// ---------------------------------------------------------------------------

/**
 * What the battery pack has actually done, as opposed to what the box claims.
 *
 * `runtimeSec` only counts holds that ended in the router going dark, because
 * those are the only ones that measured the pack rather than the length of the
 * power cut. The smallest of them is used rather than the average: a number
 * you plan around should be one the pack has never failed to reach.
 */
export function batteryStats(db: Db): { longestHoldSec: number | null; runtimeSec: number | null } {
  const spans = db.powerSpansBetween(0, Date.now());
  const adjacencyMs = 2 * config.intervals.probeSec * 1000;
  let longest: number | null = null;
  const drained: number[] = [];

  for (let i = 0; i < spans.length; i++) {
    const span = spans[i]!;
    if (span.state !== 'battery' || span.durationSec === null || span.end === null) continue;
    longest = Math.max(longest ?? 0, span.durationSec);
    const next = spans[i + 1];
    if (next && next.state === 'off' && next.start - span.end <= adjacencyMs) drained.push(span.durationSec);
  }

  return { longestHoldSec: longest, runtimeSec: drained.length ? Math.min(...drained) : null };
}

/**
 * "It has been on the pack for 40 minutes" is the one power message worth
 * interrupting someone for: it is the only one they can still act on.
 */
export function batteryHoldWarning(db: Db, now = Date.now()): { title: string; body: string } | null {
  if (config.power.batteryWarnMin <= 0) return null;
  const span = db.currentPowerSpan();
  if (!span || span.state !== 'battery') return null;

  const heldSec = Math.round((now - span.start) / 1000);
  if (heldSec < config.power.batteryWarnMin * 60) return null;

  const stats = batteryStats(db);
  const outlook =
    stats.runtimeSec !== null
      ? ` It has previously run flat after about ${formatDuration(stats.runtimeSec)}.`
      : stats.longestHoldSec !== null
        ? ` The longest it has held before is ${formatDuration(stats.longestHoldSec)}.`
        : '';

  return {
    title: 'Still running on the battery pack',
    body: `The light has been off for ${formatDuration(heldSec)} and the pack is still carrying the router.${outlook}`,
  };
}

/** The window view behind the Power tab and the CSV export. */
export function powerSummary(db: Db, from: Millis, to: Millis, current: PowerNow): PowerSummary {
  const spans = db.powerSpansBetween(from, to);
  const totals: Record<PowerState, number> = { mains: 0, battery: 0, off: 0, unknown: 0 };
  let coveredSec = 0;

  for (const span of spans) {
    const start = Math.max(span.start, from);
    const end = Math.min(span.end ?? to, to);
    totals[span.state] += Math.max(0, (end - start) / 1000);
    coveredSec += Math.max(0, (end - start) / 1000);
  }

  // Time no span covers is time nothing was watching. Folding it into
  // `unknown` rather than dropping it keeps the four totals adding up to the
  // window, which is what stops the page implying more certainty than it has.
  totals.unknown += Math.max(0, (to - from) / 1000 - coveredSec);
  for (const state of Object.keys(totals) as PowerState[]) totals[state] = Math.round(totals[state]);

  // A cut is a run of consecutive spans where the mains was not confirmed on,
  // counted once however it ended.
  let cuts = 0;
  let inCut = false;
  for (const span of spans) {
    const off = span.state !== 'mains';
    if (off && !inCut) cuts++;
    inCut = off;
  }

  const stats = batteryStats(db);
  const patterns = analyzePowerPatterns(db, config.usage.timezone, 60, to);
  const prediction = predictPowerRestoration(db, to, config.usage.timezone, patterns);

  return {
    ...current,
    window: { from, to },
    totals,
    mainsCuts: cuts,
    longestBatteryHoldSec: stats.longestHoldSec,
    witnesses: { ...db.mainsWitnessCounts(), monitorCounts: !config.power.monitorOnBattery },
    spans,
    prediction,
    patterns,
  };
}

// ---------------------------------------------------------------------------
// Pattern recognition & power restoration prediction
// ---------------------------------------------------------------------------

export interface OutageInterval {
  start: Millis;
  end: Millis | null;
  durationSec: number | null;
}

/**
 * Reconstruct contiguous outage intervals (periods with no mains power)
 * from individual power spans (battery, off, unknown).
 */
export function extractOutageIntervals(spans: PowerSpan[]): OutageInterval[] {
  const outages: OutageInterval[] = [];
  let activeStart: Millis | null = null;
  let lastEnd: Millis | null = null;

  for (let i = 0; i < spans.length; i++) {
    const span = spans[i]!;
    const isMains = span.state === 'mains';

    if (!isMains) {
      if (activeStart === null) {
        activeStart = span.start;
      }
      lastEnd = span.end;
    } else {
      if (activeStart !== null) {
        const end = span.start; // Ended when mains started
        outages.push({
          start: activeStart,
          end,
          durationSec: Math.max(1, Math.round((end - activeStart) / 1000)),
        });
        activeStart = null;
        lastEnd = null;
      }
    }
  }

  // If spans ended while still in an outage
  if (activeStart !== null) {
    outages.push({
      start: activeStart,
      end: lastEnd,
      durationSec: lastEnd ? Math.max(1, Math.round((lastEnd - activeStart) / 1000)) : null,
    });
  }

  return outages;
}

/** Get local day of week (0=Mon .. 6=Sun) and hour of day (0..23) in the target timezone. */
export function getLocalDayAndHour(
  ts: Millis,
  timezone = config.usage.timezone,
): { dayOfWeek: number; hour: number; minute: number } {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    });
    const parts = formatter.formatToParts(new Date(ts));
    let weekdayStr = 'Mon';
    let hour = 0;
    let minute = 0;
    for (const part of parts) {
      if (part.type === 'weekday') weekdayStr = part.value;
      else if (part.type === 'hour') hour = parseInt(part.value, 10);
      else if (part.type === 'minute') minute = parseInt(part.value, 10);
    }
    if (hour === 24) hour = 0;
    const days: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
    const dayOfWeek = days[weekdayStr] ?? 0;
    return { dayOfWeek, hour, minute };
  } catch {
    const d = new Date(ts);
    const day = (d.getUTCDay() + 6) % 7;
    return { dayOfWeek: day, hour: d.getUTCHours(), minute: d.getUTCMinutes() };
  }
}

/** Detect if the grid in this area has been operating on a repeating ON/OFF duty cycle. */
export function detectRotationalCycle(spans: PowerSpan[]): { onSec: number; offSec: number; reliability: number } | null {
  const outages = extractOutageIntervals(spans);
  const closedOutages = outages.filter((o) => o.end !== null && o.durationSec !== null && o.durationSec > 120);
  if (closedOutages.length < 3) return null;

  const recentOutages = closedOutages.slice(-6);
  const offDurations: number[] = [];
  const onDurations: number[] = [];

  for (let i = 0; i < recentOutages.length; i++) {
    const out = recentOutages[i]!;
    offDurations.push(out.durationSec!);

    if (i < recentOutages.length - 1) {
      const nextOut = recentOutages[i + 1]!;
      const onSec = Math.round((nextOut.start - out.end!) / 1000);
      if (onSec > 120) onDurations.push(onSec);
    }
  }

  if (offDurations.length < 3 || onDurations.length < 2) return null;

  const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const stdDev = (arr: number[], m: number) => Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length);

  const meanOff = mean(offDurations);
  const stdOff = stdDev(offDurations, meanOff);
  const cvOff = stdOff / Math.max(1, meanOff);

  const meanOn = mean(onDurations);
  const stdOn = stdDev(onDurations, meanOn);
  const cvOn = stdOn / Math.max(1, meanOn);

  if (cvOff < 0.35 && meanOff >= 1800) {
    const reliability = Math.max(0.4, Math.min(0.95, 1 - (cvOff + cvOn) / 2));
    return {
      onSec: Math.round(meanOn),
      offSec: Math.round(meanOff),
      reliability: Math.round(reliability * 100) / 100,
    };
  }

  return null;
}

/** Analyze historical power patterns, weekly 7x24 grid availability heatmap, and grid stats. */
export function analyzePowerPatterns(
  db: Db,
  timezone = config.usage.timezone,
  windowDays = 60,
  now = Date.now(),
): PowerPatternStats {
  const from = now - windowDays * 86_400_000;
  const spans = db.powerSpansBetween(from, now);
  const outages = extractOutageIntervals(spans);

  // 7x24 matrix: Monday=0..Sunday=6, Hour=0..23
  const mainsSec: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  const observedSec: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));

  for (const span of spans) {
    if (span.state === 'unknown') continue;
    const sStart = Math.max(span.start, from);
    const sEnd = Math.min(span.end ?? now, now);
    if (sEnd <= sStart) continue;

    // Slice in 15-minute steps for accurate hour allocation
    const sliceMs = 15 * 60_000;
    for (let t = sStart; t < sEnd; t += sliceMs) {
      const tEnd = Math.min(t + sliceMs, sEnd);
      const dur = (tEnd - t) / 1000;
      const { dayOfWeek, hour } = getLocalDayAndHour((t + tEnd) / 2, timezone);
      observedSec[dayOfWeek]![hour]! += dur;
      if (span.state === 'mains') {
        mainsSec[dayOfWeek]![hour]! += dur;
      }
    }
  }

  const weeklyHeatmap: (number | null)[][] = Array.from({ length: 7 }, (_, d) =>
    Array.from({ length: 24 }, (_, h) => {
      const obs = observedSec[d]![h]!;
      // Null, not 50. Inventing a coin flip for an hour nothing was recorded
      // in made the heatmap assert a confident "even odds" across every hour
      // the monitor happened to be off, which is most of a fresh install.
      if (obs < 300) return null;
      return Math.min(100, Math.max(0, Math.round((mainsSec[d]![h]! / obs) * 100)));
    }),
  );

  const closedOutages = outages.filter((o) => o.end !== null && o.durationSec !== null && o.durationSec > 60);
  const durations = closedOutages.map((o) => o.durationSec!).sort((a, b) => a - b);
  const medianOutageSec = durations.length > 0 ? durations[Math.floor(durations.length / 2)]! : null;

  let longestMainsStreakSec: number | null = null;
  let totalMainsSec = 0;
  for (const span of spans) {
    if (span.state === 'mains') {
      const dur = ((span.end ?? now) - span.start) / 1000;
      totalMainsSec += dur;
      longestMainsStreakSec = Math.max(longestMainsStreakSec ?? 0, Math.round(dur));
    }
  }

  const observedDays = Math.max(1, (now - from) / 86_400_000);
  const averageMainsHoursPerDay =
    totalMainsSec > 0 ? Math.round((totalMainsSec / (observedDays * 3600)) * 10) / 10 : null;

  const startHourCounts: Record<number, number> = {};
  for (const out of closedOutages) {
    const { hour } = getLocalDayAndHour(out.start, timezone);
    startHourCounts[hour] = (startHourCounts[hour] ?? 0) + 1;
  }
  const peakOutageHours = Object.entries(startHourCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([h]) => Number(h));

  return {
    medianOutageSec,
    averageMainsHoursPerDay,
    peakOutageHours,
    longestMainsStreakSec,
    weeklyHeatmap,
    totalOutagesAnalyzed: closedOutages.length,
  };
}

/** Predict when grid power (light) will return based on active cut and historical patterns. */
export function predictPowerRestoration(
  db: Db,
  now = Date.now(),
  timezone = config.usage.timezone,
  patterns?: PowerPatternStats,
): PowerPrediction {
  const currentSpan = db.currentPowerSpan();
  if (!currentSpan || currentSpan.state === 'mains') {
    return {
      expectedRestoreTs: null,
      expectedDurationSec: null,
      confidence: 'none',
      basis: null,
      detectedCycle: null,
    };
  }

  const allSpans = db.powerSpansBetween(now - 60 * 86_400_000, now);
  const outages = extractOutageIntervals(allSpans);
  const detectedCycle = detectRotationalCycle(allSpans);

  // Active outage start
  const activeOutage = outages[outages.length - 1];
  const outageStart = activeOutage ? activeOutage.start : currentSpan.start;
  const elapsedSec = Math.max(0, Math.round((now - outageStart) / 1000));

  const stats = patterns ?? analyzePowerPatterns(db, timezone, 60, now);
  const closedOutages = outages.filter((o) => o.end !== null && o.durationSec !== null && o.durationSec > 60);

  if (closedOutages.length === 0 && !detectedCycle) {
    return {
      expectedRestoreTs: null,
      expectedDurationSec: null,
      confidence: 'none',
      basis: 'Not enough historical power cut data to predict restoration time yet.',
      detectedCycle: null,
    };
  }

  const { hour: curStartHour } = getLocalDayAndHour(outageStart, timezone);

  // 1. If active rotational schedule is detected with good confidence
  if (detectedCycle && detectedCycle.reliability >= 0.7) {
    const expectedDurationSec = detectedCycle.offSec;
    const expectedRestoreTs = outageStart + expectedDurationSec * 1000;
    return {
      expectedRestoreTs,
      expectedDurationSec,
      confidence: 'high',
      basis: `Matching an active ~${formatDuration(detectedCycle.offSec)} OFF / ~${formatDuration(detectedCycle.onSec)} ON rotation schedule.`,
      detectedCycle,
    };
  }

  // 2. Find historical cuts starting near the same hour (+/- 2 hours)
  const matchingCuts = closedOutages.filter((o) => {
    const { hour } = getLocalDayAndHour(o.start, timezone);
    const diff = Math.abs(hour - curStartHour);
    const hourDist = Math.min(diff, 24 - diff);
    return hourDist <= 2;
  });

  if (matchingCuts.length >= 2) {
    const durations = matchingCuts.map((o) => o.durationSec!).sort((a, b) => a - b);
    const medianSec = durations[Math.floor(durations.length / 2)]!;

    if (elapsedSec < medianSec) {
      const expectedRestoreTs = outageStart + medianSec * 1000;
      const confidence: PredictionConfidence = matchingCuts.length >= 5 ? 'high' : 'medium';
      return {
        expectedRestoreTs,
        expectedDurationSec: medianSec,
        confidence,
        basis: `Based on ${matchingCuts.length} historical outages starting around ${String(curStartHour).padStart(2, '0')}:00 (typical duration ~${formatDuration(medianSec)}).`,
        detectedCycle,
      };
    } else {
      const p80 = durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.8))]!;
      if (elapsedSec < p80) {
        const expectedRestoreTs = outageStart + p80 * 1000;
        return {
          expectedRestoreTs,
          expectedDurationSec: p80,
          confidence: 'low',
          basis: `Cut has lasted longer than typical (~${formatDuration(medianSec)}). 80th percentile restoration is ~${formatDuration(p80)}.`,
          detectedCycle,
        };
      }
    }
  }

  // 3. Fallback: check weekly availability heatmap for next high-probability slot
  let nextHighProbHourOffset = 0;
  for (let offset = 1; offset <= 24; offset++) {
    const checkTs = now + offset * 3600_000;
    const { dayOfWeek: d, hour: h } = getLocalDayAndHour(checkTs, timezone);
    if ((stats.weeklyHeatmap[d]?.[h] ?? 0) >= 65) {
      nextHighProbHourOffset = offset;
      break;
    }
  }

  if (nextHighProbHourOffset > 0) {
    const targetHourTs = now + nextHighProbHourOffset * 3600_000;
    const expectedDurationSec = Math.round((targetHourTs - outageStart) / 1000);
    return {
      expectedRestoreTs: targetHourTs,
      expectedDurationSec,
      confidence: 'low',
      basis: `Estimated from weekly power schedule: next high-availability window begins in ~${nextHighProbHourOffset}h.`,
      detectedCycle,
    };
  }

  // 4. Fallback to overall median
  if (stats.medianOutageSec) {
    const expectedRestoreTs = outageStart + stats.medianOutageSec * 1000;
    return {
      expectedRestoreTs,
      expectedDurationSec: stats.medianOutageSec,
      confidence: 'low',
      basis: `Based on overall median cut duration (~${formatDuration(stats.medianOutageSec)}).`,
      detectedCycle,
    };
  }

  return {
    expectedRestoreTs: null,
    expectedDurationSec: null,
    confidence: 'none',
    basis: null,
    detectedCycle,
  };
}

/** Local wall-clock time, which is how a power cut actually gets talked about. */
function clock(ts: Millis): string {
  return new Date(ts).toLocaleString('en-GB', {
    timeZone: config.usage.timezone,
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
