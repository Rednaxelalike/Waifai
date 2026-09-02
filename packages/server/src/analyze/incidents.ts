import type { Incident, IncidentKind, IncidentSeverity, Millis } from '@waifai/shared';
import { config } from '../config.ts';
import type { Db } from '../db/index.ts';
import { logger } from '../log.ts';

const log = logger('incidents');

/**
 * Turns a stream of probe results into a ledger of discrete outages.
 *
 * The classification is the whole point. "The internet was down for 40
 * minutes" is an anecdote MTN support can wave away. "The PON link dropped out
 * of O5 at 14:02 while the ONT stayed powered and reachable, for 40 minutes,
 * and it has happened eleven times this month" is a fault report they have to
 * act on. Everything below exists to produce the second sentence.
 */

/** What one probe sweep observed. */
export interface HealthInput {
  ts: Millis;
  /** The ONT answered ICMP. */
  ontReachable: boolean;
  /**
   * PON link state from the last successful ONT poll, or null when unknown
   * (ONT unreachable, or the firmware does not expose it).
   */
  ponUp: boolean | null;
  /** Any first-hop gateway answered. */
  gatewayOk: boolean;
  /** Any public internet target answered. */
  internetOk: boolean;
  /** Name resolution succeeded. */
  dnsOk: boolean;
  /** Worst packet loss seen on the internet tier this sweep, 0..1. */
  internetLoss: number;
  /** Mean RTT on the internet tier this sweep, ms. */
  internetRttMs: number | null;
}

interface Verdict {
  healthy: boolean;
  kind: IncidentKind;
  severity: IncidentSeverity;
  detail: string;
}

const SEVERITY_RANK: Record<IncidentSeverity, number> = { info: 0, warn: 1, critical: 2 };

/**
 * Decide what, if anything, is wrong. Ordered most-specific first: knowing the
 * ONT is unreachable makes every downstream signal meaningless, so it wins.
 */
export function classify(h: HealthInput): Verdict {
  if (!h.ontReachable) {
    return {
      healthy: false,
      kind: 'ont_unreachable',
      severity: 'critical',
      detail:
        'The ONT itself did not respond. That is usually the router losing power, ' +
        'an unplugged LAN cable, or the ONT rebooting - not a fault on the fibre.',
    };
  }

  if (h.ponUp === false) {
    return {
      healthy: false,
      kind: 'pon_down',
      severity: 'critical',
      detail:
        'The ONT is powered and reachable but the PON link is not in the operational state. ' +
        'The fault is on the fibre itself or at the MTN OLT. This is the one worth reporting.',
    };
  }

  if (!h.internetOk) {
    return {
      healthy: false,
      kind: 'wan_down',
      severity: 'critical',
      detail: h.gatewayOk
        ? 'The gateway answers but nothing beyond it does. The WAN session or upstream routing has dropped.'
        : 'No route out of the network. The ONT is up but has no working WAN session.',
    };
  }

  if (!h.dnsOk) {
    return {
      healthy: false,
      kind: 'dns_failure',
      severity: 'warn',
      detail:
        'Traffic is flowing but names are not resolving. Pages will fail to load even though ' +
        'the line is fine. Usually the ISP resolver; switching to 1.1.1.1 normally fixes it.',
    };
  }

  const lossBad = h.internetLoss >= config.probes.degradedLoss;
  const rttBad = h.internetRttMs !== null && h.internetRttMs >= config.probes.degradedRttMs;
  if (lossBad || rttBad) {
    const bits: string[] = [];
    if (lossBad) bits.push(`${Math.round(h.internetLoss * 100)}% packet loss`);
    if (rttBad) bits.push(`${Math.round(h.internetRttMs ?? 0)}ms latency`);
    return {
      healthy: false,
      kind: 'degraded',
      severity: 'warn',
      detail: `The line is up but performing badly: ${bits.join(' and ')}. Calls and video will stutter.`,
    };
  }

  return { healthy: true, kind: 'degraded', severity: 'info', detail: '' };
}

export interface IncidentChange {
  opened?: Incident;
  closed?: Incident;
}

/**
 * Stateful detector. Held for the process lifetime; the consecutive-sample
 * counters are the debounce that stops a single dropped packet from creating
 * an "outage" every few minutes.
 */
export class IncidentTracker {
  private consecutiveBad = 0;
  private consecutiveGood = 0;
  private pending: Verdict | null = null;
  // Written out longhand rather than as a parameter property: Node's built-in
  // type stripping rejects those, and running the sources directly is what
  // keeps `npm run dev` free of a build step.
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  /**
   * On boot, look for a gap in the heartbeat. If the collector was off for
   * longer than a few probe intervals, something took it down - almost always
   * mains power - and that gap is recorded as its own incident kind so it is
   * never mistaken for a fibre fault in the uptime report.
   */
  recordDowntimeGap(now = Date.now()): Incident | null {
    const last = Number(this.db.getMeta('heartbeat') ?? '0');
    this.db.setMeta('heartbeat', String(now));
    if (!last) return null;

    const gapMs = now - last;
    const threshold = Math.max(3 * config.intervals.probeSec * 1000, 120_000);
    if (gapMs < threshold) return null;

    // Do not double-count: if an incident was already open when we died, close
    // it at the point we stopped observing rather than inventing a second one.
    const open = this.db.activeIncident();
    if (open) this.db.closeIncident(open.id, last);

    const inc = this.db.openIncident(
      'collector_down',
      'info',
      last,
      'The monitor was not running, so nothing was observed during this window. ' +
        'Most often this is a mains power cut rather than a network fault. ' +
        'It is excluded from the line uptime figure.',
    );
    this.db.closeIncident(inc.id, now);
    log.warn(`monitor was down for ${Math.round(gapMs / 1000)}s; recorded as a gap`);
    return this.db.getIncident(inc.id);
  }

  /** Feed one probe sweep. Returns whatever incident boundary it crossed. */
  update(h: HealthInput): IncidentChange {
    const verdict = classify(h);
    const open = this.db.activeIncident();
    const change: IncidentChange = {};

    if (!verdict.healthy) {
      this.consecutiveGood = 0;
      this.consecutiveBad++;
      this.pending = verdict;

      if (!open) {
        if (this.consecutiveBad >= config.probes.failuresToOpen) {
          // Backdate to the first bad sweep, not the one that tripped the
          // threshold, so reported downtime matches what people experienced.
          const start = h.ts - (this.consecutiveBad - 1) * config.intervals.probeSec * 1000;
          change.opened = this.db.openIncident(verdict.kind, verdict.severity, start, verdict.detail);
          log.warn(`incident opened: ${verdict.kind} - ${verdict.detail}`);
        }
      } else if (
        open.kind !== verdict.kind &&
        SEVERITY_RANK[verdict.severity] > SEVERITY_RANK[open.severity]
      ) {
        // Escalation: a degraded line that then went fully down should not be
        // filed as one long "degraded" period.
        change.closed = this.db.closeIncident(open.id, h.ts) ?? undefined;
        change.opened = this.db.openIncident(verdict.kind, verdict.severity, h.ts, verdict.detail);
        log.warn(`incident escalated: ${open.kind} -> ${verdict.kind}`);
      }
      return change;
    }

    this.consecutiveBad = 0;
    this.consecutiveGood++;
    this.pending = null;

    if (open && this.consecutiveGood >= config.probes.successesToClose) {
      const end = h.ts - (this.consecutiveGood - 1) * config.intervals.probeSec * 1000;
      change.closed = this.db.closeIncident(open.id, Math.max(end, open.start + 1000)) ?? undefined;
      log.info(`incident closed: ${open.kind} after ${change.closed?.durationSec}s`);
    }
    return change;
  }

  /** Exposed so the status endpoint can show "3 bad checks so far" honestly. */
  get state(): { consecutiveBad: number; consecutiveGood: number; pendingKind: IncidentKind | null } {
    return {
      consecutiveBad: this.consecutiveBad,
      consecutiveGood: this.consecutiveGood,
      pendingKind: this.pending?.kind ?? null,
    };
  }
}

/**
 * Build the uptime report for a window.
 *
 * `collector_down` time is excluded from the denominator rather than counted
 * as downtime. Blaming MTN for your own power cut would make the number
 * useless as evidence, and useless-as-evidence is the only failure mode that
 * matters for this report.
 */
export function buildUptimeReport(db: Db, from: Millis, to: Millis) {
  const incidents = db.incidentsBetween(from, to);
  const byKind: Record<string, { count: number; downtimeSec: number }> = {};
  let downtimeSec = 0;
  let unobservedSec = 0;

  for (const inc of incidents) {
    // Clip to the window: an outage spanning the boundary only counts inside.
    const start = Math.max(inc.start, from);
    const end = Math.min(inc.end ?? to, to);
    const sec = Math.max(0, (end - start) / 1000);

    const bucket = (byKind[inc.kind] ??= { count: 0, downtimeSec: 0 });
    bucket.count++;
    bucket.downtimeSec += Math.round(sec);

    if (inc.kind === 'collector_down') unobservedSec += sec;
    else if (inc.severity === 'critical') downtimeSec += sec;
  }

  const observedSec = Math.max(1, (to - from) / 1000 - unobservedSec);
  const uptimePct = Math.max(0, Math.min(100, ((observedSec - downtimeSec) / observedSec) * 100));

  return {
    from,
    to,
    uptimePct: Number(uptimePct.toFixed(4)),
    totalDowntimeSec: Math.round(downtimeSec),
    incidentCount: incidents.filter((i) => i.kind !== 'collector_down').length,
    byKind,
    incidents,
  };
}
