import type { OpticalTrend } from '@waifai/shared';
import { config } from '../config.ts';
import type { Db } from '../db/index.ts';

/**
 * Optical drift detection.
 *
 * The absolute Rx power number matters far less than people assume. A line
 * sitting flat at -24 dBm for two years is fine. A line that was -19 dBm in
 * January and is -23 dBm in April is failing, and will keep failing until
 * somebody re-terminates a connector - even though -23 still looks "in spec".
 *
 * So the alert condition is the slope, not the level. A least-squares fit over
 * a month of hourly means is more than enough: real degradation from a dirty
 * connector, a tightening bend radius, or water ingress shows up as a steady
 * downward line well before it crosses any threshold.
 */

export function opticalTrend(db: Db, windowDays = config.optical.trendWindowDays): OpticalTrend {
  const since = Date.now() - windowDays * 86400_000;

  // Prefer hourly rollups: they cover the full window even after raw samples
  // have been pruned, and averaging away the minute-to-minute noise makes the
  // fit far more stable.
  const hourly = db.opticalHourlySince(since);
  const points: { t: number; rx: number }[] = hourly
    .filter((h) => h.rx !== null)
    .map((h) => ({ t: h.hour, rx: h.rx! }));

  if (points.length < 24) {
    for (const s of db.opticalSince(since)) {
      if (s.rxPower !== null) points.push({ t: s.ts, rx: s.rxPower });
    }
  }

  if (points.length < 10) {
    return {
      slopePerDay: null,
      // Rounded to match the settled-trend branch below. Unrounded, the first
      // few hours of a fresh install show "-12.510000000000002 dBm", which
      // reads as a precision the optical module does not have.
      meanRx: points.length ? Number(avg(points.map((p) => p.rx)).toFixed(2)) : null,
      windowDays,
      samples: points.length,
      degrading: false,
      verdict:
        'Not enough history yet. Drift only becomes readable after a week or so of samples; ' +
        'until then, note the current reading as your baseline.',
    };
  }

  points.sort((a, b) => a.t - b.t);
  const t0 = points[0]!.t;
  // Regress against days-since-start so the slope is directly dB/day.
  const xs = points.map((p) => (p.t - t0) / 86400_000);
  const ys = points.map((p) => p.rx);
  const slope = leastSquaresSlope(xs, ys);
  const meanRx = Number(avg(ys).toFixed(2));

  const spanDays = xs[xs.length - 1]! - xs[0]!;
  const degrading =
    slope !== null && slope < -config.optical.driftDbPerDay && spanDays >= 3;
  const belowFloor = meanRx <= config.optical.rxFloorDbm;

  return {
    slopePerDay: slope === null ? null : Number(slope.toFixed(4)),
    meanRx,
    windowDays,
    samples: points.length,
    degrading: degrading || belowFloor,
    verdict: verdictFor(slope, meanRx, spanDays, degrading, belowFloor),
  };
}

function verdictFor(
  slope: number | null,
  meanRx: number,
  spanDays: number,
  degrading: boolean,
  belowFloor: boolean,
): string {
  if (belowFloor && degrading) {
    return (
      `Rx power is averaging ${meanRx} dBm and still falling by about ` +
      `${Math.abs(slope ?? 0).toFixed(3)} dB per day. This needs a technician: a connector or ` +
      'splice is going, and the line will start dropping sync.'
    );
  }
  if (belowFloor) {
    return (
      `Rx power is averaging ${meanRx} dBm, which is close to the level where this ONT ` +
      'starts losing sync. It is stable rather than falling, but there is no margin left ' +
      'for a rainy season or a nudged patch lead.'
    );
  }
  if (degrading) {
    const daysToFloor =
      slope && slope < 0 ? Math.round((meanRx - config.optical.rxFloorDbm) / Math.abs(slope)) : null;
    return (
      `Rx power is falling by about ${Math.abs(slope ?? 0).toFixed(3)} dB per day from a mean of ` +
      `${meanRx} dBm. Still within spec, but the trend is the warning` +
      (daysToFloor && daysToFloor < 400
        ? `: at this rate it reaches the trouble threshold in roughly ${daysToFloor} days.`
        : '.') +
      ' Worth raising with MTN now, while you have the data.'
    );
  }
  if (spanDays < 3) {
    return `Rx power is averaging ${meanRx} dBm. Too early to read a trend from ${spanDays.toFixed(1)} days.`;
  }
  return (
    `Rx power is averaging ${meanRx} dBm and holding steady over ${Math.round(spanDays)} days. ` +
    'This is what a healthy line looks like.'
  );
}

function avg(xs: readonly number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Ordinary least squares slope of y over x. Null when x has no spread. */
function leastSquaresSlope(xs: readonly number[], ys: readonly number[]): number | null {
  const n = xs.length;
  if (n < 2) return null;
  const mx = avg(xs);
  const my = avg(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    num += dx * (ys[i]! - my);
    den += dx * dx;
  }
  if (den === 0) return null;
  return num / den;
}
