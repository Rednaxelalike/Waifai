import { config } from '../config.ts';
import type { Db } from '../db/index.ts';
import { logger } from '../log.ts';

const log = logger('alerts');

/**
 * Outbound notifications.
 *
 * This is the reason the project does not need a native mobile app. A PWA
 * cannot reliably wake a phone that has the browser closed, but ntfy and
 * Telegram both already have apps that can, so pushing through them costs one
 * file instead of a second codebase and a Play Store listing.
 *
 * Nothing is sent unless the corresponding URL or token is configured, so a
 * default install is silent.
 */

export type AlertPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface Alert {
  /**
   * Stable identity for the condition, e.g. `incident:pon_down`. Used for
   * cooldown, so a flapping line sends one message rather than forty.
   */
  key: string;
  title: string;
  body: string;
  priority?: AlertPriority;
  /** Skip the cooldown. Used for recoveries, which are always worth sending. */
  force?: boolean;
  tags?: string[];
}

const NTFY_PRIORITY: Record<AlertPriority, string> = {
  low: '2',
  normal: '3',
  high: '4',
  urgent: '5',
};

export class Alerter {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  /** Returns true when the alert was actually dispatched somewhere. */
  async send(alert: Alert): Promise<boolean> {
    const cooldownMs = config.alerts.cooldownMin * 60_000;
    if (!alert.force && !this.db.shouldAlert(alert.key, cooldownMs)) {
      log.debug(`suppressed by cooldown: ${alert.key}`);
      return false;
    }

    const targets: Promise<boolean>[] = [];
    if (config.alerts.ntfyUrl) targets.push(this.viaNtfy(alert));
    if (config.alerts.telegramToken && config.alerts.telegramChatId) targets.push(this.viaTelegram(alert));
    if (config.alerts.webhookUrl) targets.push(this.viaWebhook(alert));

    if (targets.length === 0) {
      log.debug(`no alert channel configured; would have sent: ${alert.title}`);
      return false;
    }

    const results = await Promise.allSettled(targets);
    const delivered = results.some((r) => r.status === 'fulfilled' && r.value);
    if (delivered) log.info(`alert sent: ${alert.title}`);
    else log.warn(`alert failed on every channel: ${alert.title}`);
    return delivered;
  }

  /**
   * Clears the cooldown for a condition. Called when a condition resolves, so
   * that if it recurs an hour later the alert fires again immediately instead
   * of being swallowed as a duplicate.
   */
  resolve(key: string): void {
    this.db.clearAlertCooldown(key);
  }

  private async viaNtfy(alert: Alert): Promise<boolean> {
    try {
      const res = await fetch(config.alerts.ntfyUrl, {
        method: 'POST',
        body: alert.body,
        headers: {
          Title: alert.title,
          Priority: NTFY_PRIORITY[alert.priority ?? 'normal'],
          ...(alert.tags?.length ? { Tags: alert.tags.join(',') } : {}),
        },
        signal: AbortSignal.timeout(10_000),
      });
      return res.ok;
    } catch (err) {
      log.debug('ntfy failed', err);
      return false;
    }
  }

  private async viaTelegram(alert: Alert): Promise<boolean> {
    try {
      const url = `https://api.telegram.org/bot${config.alerts.telegramToken}/sendMessage`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: config.alerts.telegramChatId,
          text: `*${escapeMarkdown(alert.title)}*\n${escapeMarkdown(alert.body)}`,
          parse_mode: 'MarkdownV2',
          disable_notification: alert.priority === 'low',
        }),
        signal: AbortSignal.timeout(10_000),
      });
      return res.ok;
    } catch (err) {
      log.debug('telegram failed', err);
      return false;
    }
  }

  private async viaWebhook(alert: Alert): Promise<boolean> {
    try {
      const res = await fetch(config.alerts.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...alert, ts: Date.now() }),
        signal: AbortSignal.timeout(10_000),
      });
      return res.ok;
    } catch (err) {
      log.debug('webhook failed', err);
      return false;
    }
  }
}

/** Telegram's MarkdownV2 requires escaping a long list of ASCII punctuation. */
function escapeMarkdown(s: string): string {
  return s.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => `\\${c}`);
}
