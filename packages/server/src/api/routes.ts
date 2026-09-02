import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { formatBytes, formatDuration } from '@waifai/shared';
import { config } from '../config.ts';
import type { AppContext } from '../context.ts';
import type { Scheduler } from '../scheduler.ts';
import { buildUptimeReport } from '../analyze/incidents.ts';
import { opticalTrend } from '../analyze/optical.ts';
import { powerSummary } from '../analyze/power.ts';
import { buildStatus } from '../analyze/status.ts';
import { usageSummary } from '../analyze/usage.ts';
import { logger } from '../log.ts';

const log = logger('api');

const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Clamp a user-supplied range so nobody can ask for 10 years of raw samples. */
function windowMs(raw: unknown, defHours: number, maxHours: number): number {
  const n = Number(raw);
  const hours = Number.isFinite(n) && n > 0 ? Math.min(n, maxHours) : defHours;
  return hours * HOUR;
}

export function registerRoutes(app: FastifyInstance, ctx: AppContext, scheduler: Scheduler): void {
  // -- auth ----------------------------------------------------------------
  /*
   * Off by default. The intended deployment is LAN-only with Tailscale for
   * remote access, where the tailnet *is* the auth boundary and a second login
   * would be security theatre that everyone works around. ACCESS_CODE exists
   * for anyone who exposes the port more widely.
   */
  if (config.server.accessCode) {
    app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
      if (!req.url.startsWith('/api/')) return;
      const given =
        (req.headers['x-access-code'] as string | undefined) ??
        (req.query as Record<string, string> | undefined)?.['code'];
      if (given !== config.server.accessCode) {
        await reply.code(401).send({ error: 'access code required' });
      }
    });
  }

  // -- status and health ---------------------------------------------------

  app.get('/api/status', async () => buildStatus(ctx));

  app.get('/api/health', async () => ({
    ok: true,
    uptimeSec: Math.round((Date.now() - ctx.startedAt) / 1000),
    jobs: scheduler.status(),
    tracker: ctx.tracker.state,
    ont: {
      host: config.ont.host,
      model: ctx.db.getMeta('ont_model'),
      firmware: ctx.db.getMeta('ont_firmware'),
      uptimeSec: Number(ctx.db.getMeta('ont_uptime_sec') ?? '0') || null,
      // The derived form, which is the one the power log actually reasons
      // about: a count is only true at the instant it was read, a boot time
      // stays true afterwards.
      bootTs: Number(ctx.db.getMeta('ont_boot_ts') ?? '0') || null,
      // Which pages this firmware actually serves, so a failed discovery is
      // visible rather than silently producing an empty dashboard.
      knownPages: ctx.db.knownGoodPages(),
    },
    /*
     * Which channels a power cut would actually reach a phone through. The PWA
     * cannot wake a locked phone by itself, so whether anything is configured
     * here is the difference between the power log being a record after the
     * fact and being the alarm the whole project is for.
     */
    alerts: {
      channels: [
        config.alerts.ntfyUrl ? 'ntfy' : null,
        config.alerts.telegramToken && config.alerts.telegramChatId ? 'Telegram' : null,
        config.alerts.webhookUrl ? 'a webhook' : null,
      ].filter((v): v is string => v !== null),
      cooldownMin: config.alerts.cooldownMin,
    },
    db: { file: config.db.file },
  }));

  // -- time series ---------------------------------------------------------

  app.get('/api/optical', async (req) => {
    const q = req.query as Record<string, string>;
    const span = windowMs(q['hours'], 24, 24 * 90);
    const since = Date.now() - span;
    // Past a couple of days the raw series is both huge and needlessly noisy,
    // so hand back hourly means instead. The shapes differ, so the response
    // says which one it is rather than making the client guess.
    if (span > 3 * DAY) {
      return { resolution: 'hourly', points: ctx.db.opticalHourlySince(since) };
    }
    return { resolution: 'raw', points: ctx.db.opticalSince(since) };
  });

  app.get('/api/optical/trend', async (req) => {
    const q = req.query as Record<string, string>;
    const days = Math.min(365, Math.max(1, Number(q['days']) || config.optical.trendWindowDays));
    return opticalTrend(ctx.db, days);
  });

  app.get('/api/throughput', async (req) => {
    const q = req.query as Record<string, string>;
    return { points: ctx.db.throughputSince(Date.now() - windowMs(q['hours'], 6, 24 * 30)) };
  });

  app.get('/api/probes', async (req) => {
    const q = req.query as Record<string, string>;
    const tier = q['tier'] as never;
    return { points: ctx.db.probesSince(Date.now() - windowMs(q['hours'], 6, 24 * 14), tier || undefined) };
  });

  app.get('/api/speedtests', async (req) => {
    const q = req.query as Record<string, string>;
    const days = Math.min(365, Math.max(1, Number(q['days']) || 30));
    return {
      plan: { downMbps: config.speedtest.planDownMbps, upMbps: config.speedtest.planUpMbps },
      points: ctx.db.speedtestsSince(Date.now() - days * DAY),
    };
  });

  // -- incidents and the uptime report -------------------------------------

  app.get('/api/incidents', async (req) => {
    const q = req.query as Record<string, string>;
    const days = Math.min(730, Math.max(1, Number(q['days']) || 30));
    return { incidents: ctx.db.incidentsBetween(Date.now() - days * DAY, Date.now()) };
  });

  app.patch('/api/incidents/:id/note', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { note } = (req.body ?? {}) as { note?: string };
    const incident = ctx.db.getIncident(Number(id));
    if (!incident) return reply.code(404).send({ error: 'no such incident' });
    ctx.db.annotateIncident(Number(id), String(note ?? '').slice(0, 2000));
    return ctx.db.getIncident(Number(id));
  });

  app.get('/api/uptime', async (req) => {
    const q = req.query as Record<string, string>;
    const days = Math.min(730, Math.max(1, Number(q['days']) || 30));
    return buildUptimeReport(ctx.db, Date.now() - days * DAY, Date.now());
  });

  /*
   * The evidence export. A screenshot of a dashboard is easy for a support
   * desk to wave away; a CSV of timestamped, classified outages is not. This
   * is the single most useful thing the project produces.
   */
  app.get('/api/uptime.csv', async (req, reply) => {
    const q = req.query as Record<string, string>;
    const days = Math.min(730, Math.max(1, Number(q['days']) || 30));
    const report = buildUptimeReport(ctx.db, Date.now() - days * DAY, Date.now());

    const rows: string[] = [
      `# Connection report for the ${days} days to ${new Date().toISOString()}`,
      `# Measured from inside the LAN by polling the ONT and probing upstream every ${config.intervals.probeSec}s.`,
      `# Uptime ${report.uptimePct.toFixed(3)}% - ${formatDuration(report.totalDowntimeSec)} of downtime across ${report.incidentCount} incidents.`,
      '# Windows where the monitor itself was offline are excluded from the uptime figure.',
      '',
      'start_local,end_local,duration,kind,severity,detail,note',
    ];
    for (const inc of report.incidents) {
      rows.push(
        [
          new Date(inc.start).toLocaleString('en-GB', { timeZone: config.usage.timezone }),
          inc.end ? new Date(inc.end).toLocaleString('en-GB', { timeZone: config.usage.timezone }) : 'ongoing',
          inc.durationSec === null ? 'ongoing' : formatDuration(inc.durationSec),
          inc.kind,
          inc.severity,
          inc.detail,
          inc.note ?? '',
        ]
          .map(csvCell)
          .join(','),
      );
    }

    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="connection-report-${days}d.csv"`)
      .send(rows.join('\n'));
  });

  // -- power ---------------------------------------------------------------

  /*
   * "When is the Wi-Fi on, and is that the light or the battery?" - which is a
   * different question from the uptime report above. That one is about whose
   * fault an outage was; this one is about whether there was any Wi-Fi at all,
   * and it counts a fibre fault as perfectly fine because the router was still
   * on and still serving the house.
   */
  app.get('/api/power', async (req) => {
    const q = req.query as Record<string, string>;
    const days = Math.min(730, Math.max(1, Number(q['days']) || 30));
    return powerSummary(ctx.db, Date.now() - days * DAY, Date.now(), ctx.power.now());
  });

  /*
   * The household power log, in the same spirit as uptime.csv: something you
   * can put in front of a landlord, an estate manager or whoever sold you the
   * battery pack, with dates on it.
   */
  app.get('/api/power.csv', async (req, reply) => {
    const q = req.query as Record<string, string>;
    const days = Math.min(730, Math.max(1, Number(q['days']) || 30));
    const report = powerSummary(ctx.db, Date.now() - days * DAY, Date.now(), ctx.power.now());

    const rows: string[] = [
      `# Power log for the ${days} days to ${new Date().toISOString()}`,
      '# Worked out from the router answering or not, from mains-only devices going quiet,',
      "# and from the router's own uptime counter. Nothing here reads a wall socket directly.",
      `# Mains on ${formatDuration(report.totals.mains)}, on battery ${formatDuration(report.totals.battery)}, ` +
        `no Wi-Fi ${formatDuration(report.totals.off)}, unaccounted ${formatDuration(report.totals.unknown)}.`,
      `# ${report.mainsCuts} stretch(es) where the mains was not confirmed on.`,
      '',
      'start_local,end_local,duration,state,wifi,evidence,detail',
    ];
    for (const span of report.spans) {
      rows.push(
        [
          new Date(span.start).toLocaleString('en-GB', { timeZone: config.usage.timezone }),
          span.end ? new Date(span.end).toLocaleString('en-GB', { timeZone: config.usage.timezone }) : 'ongoing',
          span.durationSec === null ? 'ongoing' : formatDuration(span.durationSec),
          span.state,
          span.state === 'off' ? 'off' : span.state === 'unknown' ? 'unclear' : 'on',
          span.source === 'live' ? 'watched' : 'reconstructed afterwards',
          span.detail,
        ]
          .map(csvCell)
          .join(','),
      );
    }

    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="power-log-${days}d.csv"`)
      .send(rows.join('\n'));
  });

  // -- devices and presence ------------------------------------------------

  app.get('/api/devices', async () => ({ devices: ctx.db.listDevices() }));

  app.patch('/api/devices/:mac', async (req, reply) => {
    const { mac } = req.params as { mac: string };
    const body = (req.body ?? {}) as {
      label?: string;
      owner?: string;
      trusted?: boolean;
      mainsWitness?: boolean;
    };
    if (!ctx.db.getDevice(mac)) return reply.code(404).send({ error: 'no such device' });
    ctx.db.updateDeviceMeta(mac, {
      label: body.label === undefined ? undefined : String(body.label).slice(0, 64) || null,
      owner: body.owner === undefined ? undefined : String(body.owner).slice(0, 64) || null,
      trusted: body.trusted,
      mainsWitness: body.mainsWitness,
    });
    return ctx.db.getDevice(mac);
  });

  app.get('/api/presence', async (req) => {
    const q = req.query as Record<string, string>;
    const days = Math.min(90, Math.max(1, Number(q['days']) || 7));
    return { sessions: ctx.db.presenceSince(Date.now() - days * DAY, q['mac']) };
  });

  // -- usage ---------------------------------------------------------------

  app.get('/api/usage', async () => {
    const summary = usageSummary(ctx.db);
    return {
      ...summary,
      human: {
        monthToDate: formatBytes(summary.monthToDateBytes),
        projected: formatBytes(summary.projectedMonthBytes),
        cap: summary.capBytes ? formatBytes(summary.capBytes) : null,
      },
    };
  });

  // -- noticeboard ---------------------------------------------------------

  app.get('/api/notices', async () => ({ notices: ctx.db.listNotices() }));

  app.post('/api/notices', async (req, reply) => {
    const body = (req.body ?? {}) as { author?: string; body?: string; pinned?: boolean };
    const text = String(body.body ?? '').trim();
    if (!text) return reply.code(400).send({ error: 'body is required' });
    const notice = ctx.db.addNotice(
      String(body.author ?? 'Someone').slice(0, 40),
      text.slice(0, 500),
      Boolean(body.pinned),
    );
    ctx.bus.emit({ type: 'notice', payload: notice });
    return notice;
  });

  app.delete('/api/notices/:id', async (req) => {
    const { id } = req.params as { id: string };
    ctx.db.deleteNotice(Number(id));
    return { ok: true };
  });

  // -- guest Wi-Fi ---------------------------------------------------------

  /*
   * Returns the standard `WIFI:` payload string; the PWA renders the QR code
   * itself. Sending the string rather than an image keeps the server free of
   * an image dependency, and the credentials never leave the LAN either way.
   */
  app.get('/api/wifi', async (_req, reply) => {
    if (!config.wifi.ssid) return reply.code(404).send({ error: 'WIFI_SSID is not configured' });
    const esc = (s: string): string => s.replace(/([\\;,:"])/g, '\\$1');
    return {
      ssid: config.wifi.ssid,
      qr: `WIFI:T:${config.wifi.security};S:${esc(config.wifi.ssid)};P:${esc(config.wifi.password)};;`,
    };
  });

  // -- manual actions ------------------------------------------------------

  app.post('/api/actions/poll', async () => ({ started: await scheduler.trigger('ont') }));

  app.post('/api/actions/speedtest', async (_req, reply) => {
    // Fire and forget: a speed test takes up to a minute and the browser
    // should not sit on an open request that long.
    void scheduler.trigger('speedtest');
    return reply.code(202).send({ started: true });
  });

  /*
   * Rebooting drops every device in the house for around 90 seconds, so it
   * takes an explicit confirmation in the body rather than being a bare POST
   * that a mis-click or a prefetcher could trigger.
   */
  app.post('/api/actions/reboot', async (req, reply) => {
    const body = (req.body ?? {}) as { confirm?: string };
    if (body.confirm !== 'reboot') {
      return reply.code(400).send({
        error: 'confirmation required',
        detail: 'Send {"confirm":"reboot"}. This drops everyone in the house for about 90 seconds.',
      });
    }
    log.warn('ONT reboot requested from the API');
    const ok = await ctx.ont.reboot().catch(() => false);
    return { ok, detail: ok ? 'Reboot command accepted. Expect ~90 seconds offline.' : 'The ONT refused the reboot command.' };
  });
}

/** RFC 4180 quoting: double the quotes, wrap anything containing a separator. */
function csvCell(v: string): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
