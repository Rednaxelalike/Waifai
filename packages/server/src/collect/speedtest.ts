import { config } from '../config.ts';
import type { AppContext } from '../context.ts';
import { logger } from '../log.ts';
import { runSpeedtest } from '../probes/speedtest.ts';
import { capFraction, usageSummary } from '../analyze/usage.ts';
import { formatBytes } from '@waifai/shared';

const log = logger('collect:speedtest');

/**
 * Scheduled throughput measurement.
 *
 * Skipped when the line is already known to be down (the result would be a
 * meaningless zero that drags the average down and looks like a speed problem
 * in the charts) and when the household is clearly busy, because a test run
 * during a Netflix session measures leftover capacity rather than the line.
 */
export async function collectSpeedtest(ctx: AppContext, force = false): Promise<void> {
  if (!config.speedtest.enabled && !force) return;

  if (!force) {
    const active = ctx.db.activeIncident();
    if (active && active.severity === 'critical') {
      log.debug('skipping speedtest: line is down');
      return;
    }

    // ~4 Mbps of existing traffic is roughly one HD stream. Above that the
    // number would say more about the household than about MTN.
    const current = ctx.db.latestThroughput();
    if (current && current.downBps > 4_000_000) {
      log.debug('skipping speedtest: line is busy');
      return;
    }
  }

  const result = await runSpeedtest();
  if (!result) {
    log.warn('speedtest produced no result');
    return;
  }

  ctx.db.insertSpeedtest(result);
  ctx.bus.emit({ type: 'speedtest', payload: result });
  log.info(`speedtest: ${result.downMbps} down / ${result.upMbps} up Mbps via ${result.source}`);

  await checkAgainstPlan(ctx, result.downMbps);
}

/**
 * Compare against the advertised plan. This is the number that turns "the
 * internet feels slow" into a support ticket with evidence, so the threshold
 * is deliberately forgiving: alerting at 90% of plan would fire constantly and
 * teach everyone to ignore it. Half of what you pay for is not arguable.
 */
async function checkAgainstPlan(ctx: AppContext, downMbps: number): Promise<void> {
  const plan = config.speedtest.planDownMbps;
  if (plan <= 0) return;

  const ratio = downMbps / plan;
  if (ratio >= 0.5) {
    ctx.alerter.resolve('speed:below_plan');
    return;
  }

  // Confirm against recent history before shouting: one bad test is usually a
  // congested test server, not a congested line.
  const recent = ctx.db.speedtestsSince(Date.now() - 24 * 3_600_000);
  const badRuns = recent.filter((s) => s.downMbps / plan < 0.5).length;
  if (badRuns < 2) return;

  await ctx.alerter.send({
    key: 'speed:below_plan',
    title: 'Speed is well below your plan',
    body:
      `Last test: ${downMbps} Mbps down against a ${plan} Mbps plan (${Math.round(ratio * 100)}%). ` +
      `${badRuns} of the last ${recent.length} tests in 24h were under half the plan speed. ` +
      'The speed history page has the full record to send to MTN.',
    priority: 'normal',
    tags: ['turtle'],
  });
}

/**
 * Data cap watch. Runs on the maintenance tick rather than per-poll, since
 * crossing a monthly threshold is not a per-minute event.
 */
export async function checkUsageCap(ctx: AppContext): Promise<void> {
  const summary = usageSummary(ctx.db);
  const fraction = capFraction(summary);
  if (fraction === null) return;

  if (fraction < config.alerts.usageThreshold) {
    ctx.alerter.resolve('usage:threshold');
    return;
  }

  await ctx.alerter.send({
    key: 'usage:threshold',
    title: fraction >= 1 ? 'Data cap reached' : 'Approaching your data cap',
    body:
      `${formatBytes(summary.monthToDateBytes)} used this cycle` +
      `${summary.capBytes ? ` of ${formatBytes(summary.capBytes)}` : ''} ` +
      `(${Math.round(fraction * 100)}%). On the current pace the cycle will finish at about ` +
      `${formatBytes(summary.projectedMonthBytes)}.`,
    priority: fraction >= 1 ? 'high' : 'normal',
    tags: ['bar_chart'],
  });
}
