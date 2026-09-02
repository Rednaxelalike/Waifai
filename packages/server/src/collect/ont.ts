import { rxPowerBand } from '@waifai/shared';
import { config } from '../config.ts';
import type { AppContext } from '../context.ts';
import { logger } from '../log.ts';
import { CANDIDATE_PAGES } from '../ont/client.ts';
import { parseDevices, parseOntInfo, parseOptical, parseWan, ponIsUp } from '../ont/parse.ts';
import { vendorFor } from '../probes/oui.ts';
import { counterDelta, recordUsage } from '../analyze/usage.ts';
import { opticalTrend } from '../analyze/optical.ts';

const log = logger('collect:ont');

/**
 * One full ONT poll: log in, pull every page that this firmware is known to
 * serve, run every parser over all of them, log out.
 *
 * The whole poll happens inside a single session because the ONT only permits
 * one, and it logs out afterwards so the household is not locked out of the
 * router UI.
 */
export async function collectOnt(ctx: AppContext): Promise<void> {
  const ts = Date.now();

  // Which pages to ask for. After the first discovery run this narrows to the
  // handful that actually exist on this build, which cuts a poll from twenty
  // requests to about five.
  const known = ctx.db.knownGoodPages();
  const paths = known.length > 0 ? known.map((k) => k.path) : CANDIDATE_PAGES;

  let pages;
  try {
    pages = await ctx.ont.session((c) => c.pages(paths));
  } catch (err) {
    // Not an incident on its own: the probe collector decides that, and it has
    // better information (it knows whether the ONT answers ICMP at all).
    log.warn('ONT poll failed', err);
    ctx.lastPonUp = null;
    return;
  }

  const okCount = pages.filter((p) => p.ok).length;
  if (okCount === 0) {
    log.warn('ONT session succeeded but every page came back empty');
    return;
  }

  // -- optical -------------------------------------------------------------
  const optical = parseOptical(pages, ts);
  if (optical.rxPower !== null || optical.ponStatus !== null) {
    ctx.db.insertOptical(optical);
    ctx.lastPonUp = optical.ponStatus === null ? null : ponIsUp(optical.ponStatus);
  }

  // -- wan and derived throughput / usage ----------------------------------
  const wan = parseWan(pages, ts);
  const previous = ctx.db.latestWan();
  ctx.db.insertWan(wan);

  if (previous && wan.rxBytes !== null && wan.txBytes !== null) {
    const elapsedSec = (wan.ts - previous.ts) / 1000;
    const downBytes = counterDelta(previous.rxBytes, wan.rxBytes);
    const upBytes = counterDelta(previous.txBytes, wan.txBytes);

    // A gap far longer than the poll interval means the collector was asleep;
    // the bytes are real and belong in usage, but dividing by the gap would
    // produce a meaningless throughput point.
    const plausibleInterval = elapsedSec > 0 && elapsedSec < config.intervals.ontPollSec * 4;
    if (plausibleInterval) {
      ctx.db.insertThroughput({
        ts: wan.ts,
        downBps: (downBytes * 8) / elapsedSec,
        upBps: (upBytes * 8) / elapsedSec,
      });
    }
    recordUsage(ctx.db, downBytes, upBytes, wan.ts);
  }

  // -- attached devices ----------------------------------------------------
  // The ONT's own list is the richest source of names and connection type, but
  // it is stale by design: DHCP keeps showing devices for the whole lease. So
  // this only *adds* metadata (name, connection, rssi), and the ARP sweep in
  // the presence collector is what actually decides who is currently online.
  for (const sighting of parseDevices(pages)) {
    ctx.db.recordDeviceMetadata({
      mac: sighting.mac,
      hostname: sighting.hostname,
      ip: sighting.ip,
      vendor: vendorFor(sighting.mac),
      connection: sighting.connection,
      rssi: sighting.rssi,
      ts,
    });
  }

  // -- static info, stored once so the UI can show what it is talking to ----
  const info = parseOntInfo(pages);
  if (info.model) ctx.db.setMeta('ont_model', info.model);
  if (info.firmware) ctx.db.setMeta('ont_firmware', info.firmware);
  if (info.uptimeSec !== null) {
    ctx.db.setMeta('ont_uptime_sec', String(info.uptimeSec));
    /*
     * Uptime is stored as the moment the router booted rather than as the
     * count itself, because a count is only true at the instant it was read.
     * A boot time can be compared against anything later - which is what lets
     * a monitor that was dead for three hours come back and say whether the
     * Wi-Fi survived them.
     */
    ctx.power.noteOntBoot(ts - info.uptimeSec * 1000);
  }
  // The serial number is what MTN uses to authorise the ONT on their PON.
  // It is deliberately not stored: it is account-identifying, the dashboard
  // has no use for it, and a database that never holds it cannot leak it.

  await checkOpticalHealth(ctx);

  log.debug(
    `poll ok: rx=${optical.rxPower ?? '?'}dBm pon=${optical.ponStatus ?? '?'} ` +
      `wan=${wan.up ? 'up' : 'down'} pages=${okCount}/${pages.length}`,
  );
}

/**
 * Optical alerting, kept separate from the poll so a noisy line cannot delay
 * data collection.
 */
async function checkOpticalHealth(ctx: AppContext): Promise<void> {
  if (!config.alerts.onOpticalDrift) return;

  const latest = ctx.db.latestOptical();
  if (!latest || latest.rxPower === null) return;

  // Immediate: the signal is bad right now.
  if (rxPowerBand(latest.rxPower) === 'poor') {
    await ctx.alerter.send({
      key: 'optical:poor',
      title: 'Fibre signal is weak',
      body:
        `Rx optical power is ${latest.rxPower} dBm, past the level where this ONT starts ` +
        'losing sync. Expect dropouts. This is a line fault, not a Wi-Fi problem - report it to MTN.',
      priority: 'high',
      tags: ['warning'],
    });
    return;
  }
  ctx.alerter.resolve('optical:poor');

  // Slow: the signal is fine today but heading the wrong way. Checked far less
  // often than the poll, because a drift verdict cannot change in a minute.
  const lastCheck = Number(ctx.db.getMeta('last_drift_check') ?? '0');
  if (Date.now() - lastCheck < 6 * 3_600_000) return;
  ctx.db.setMeta('last_drift_check', String(Date.now()));

  const trend = opticalTrend(ctx.db);
  if (trend.degrading) {
    await ctx.alerter.send({
      key: 'optical:drift',
      title: 'Fibre signal is drifting down',
      body: trend.verdict,
      priority: 'normal',
      tags: ['chart_with_downwards_trend'],
    });
  } else {
    ctx.alerter.resolve('optical:drift');
  }
}
