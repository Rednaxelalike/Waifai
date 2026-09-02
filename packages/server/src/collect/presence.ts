import { config } from '../config.ts';
import type { AppContext } from '../context.ts';
import { logger } from '../log.ts';
import { arpTable, sweepSubnet } from '../probes/net.ts';
import { isRandomisedMac, vendorFor } from '../probes/oui.ts';

const log = logger('collect:presence');

/**
 * Who is actually on the network right now.
 *
 * This is deliberately independent of the ONT's DHCP list. That list keeps
 * showing a phone for the whole lease duration - often 24 hours - long after
 * its owner has left the house, which makes it useless for presence. ARP
 * entries expire in minutes, so a sweep plus an ARP read tracks reality.
 *
 * The presence table this builds gives you two things the raw device list
 * cannot: a timeline of who was home when, and a reliable "a device nobody
 * recognises just joined the Wi-Fi" alert.
 */
export async function collectPresence(ctx: AppContext): Promise<void> {
  const ts = Date.now();

  if (config.presence.sweepEnabled) {
    // Populates the ARP cache. On a quiet network almost nothing is in there
    // otherwise, and presence detection silently reports an empty house.
    await sweepSubnet(config.presence.subnetBase).catch((err) =>
      log.debug('subnet sweep failed', err),
    );
  }

  const entries = await arpTable();
  if (entries.length === 0) {
    // Better to skip a cycle than to declare the whole house offline because
    // `arp` was missing or returned nothing.
    log.warn('ARP table came back empty; skipping this presence cycle');
    return;
  }

  for (const entry of entries) {
    const { isNew } = ctx.db.seeDevice({
      mac: entry.mac,
      ip: entry.ip,
      vendor: vendorFor(entry.mac),
      ts,
    });
    ctx.db.openPresence(entry.mac, ts);

    if (isNew) await announceNewDevice(ctx, entry.mac);
  }

  // Anything not seen for a while has left. The window is generous because a
  // sleeping phone stops answering ARP long before its owner walks out.
  const cutoff = ts - config.presence.offlineAfterSec * 1000;
  for (const mac of ctx.db.markOffline(cutoff)) {
    ctx.db.closePresence(mac, ts);
  }

  log.debug(`presence: ${entries.length} devices answered, ${ctx.db.countOnlineDevices()} online`);
}

async function announceNewDevice(ctx: AppContext, mac: string): Promise<void> {
  const device = ctx.db.getDevice(mac);
  if (!device) return;

  ctx.bus.emit({ type: 'device_new', payload: device });
  if (!config.alerts.onNewDevice) return;

  /*
   * Randomised MACs are the reason this check exists. iOS and Android rotate a
   * private Wi-Fi address per network by default, so the same phone reappears
   * as a brand-new device after a Wi-Fi reset or an OS update. Alerting on
   * those would produce a false "stranger on your network" warning every few
   * weeks, and an alert that cries wolf gets muted - which costs you the real
   * one later.
   */
  if (isRandomisedMac(mac)) {
    log.info(`new device ${mac} uses a randomised address; recorded but not alerted`);
    return;
  }

  const name = device.hostname ?? device.vendor ?? 'Unknown device';
  await ctx.alerter.send({
    key: `newdev:${mac}`,
    title: 'New device on the Wi-Fi',
    body:
      `${name} (${mac}${device.ip ? `, ${device.ip}` : ''}) joined for the first time. ` +
      'If you recognise it, name it in the dashboard and it will stop being flagged.',
    priority: 'normal',
    tags: ['bust_in_silhouette'],
  });
}
