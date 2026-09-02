import { useMemo } from 'react';
import type { Incident, PowerState, PowerSummary } from '@waifai/shared';
import { useApi } from './api.ts';
import { incidentMeta } from './incidents.ts';
import type { LiveEvent } from './live.ts';

/**
 * The activity feed, seeded from history rather than from this session alone.
 *
 * It used to render only what arrived over the socket since the app was
 * opened, which meant the most common reading of the most-visited card on the
 * home screen was "Nothing has changed since you opened this" - the app
 * admitting it forgets everything on refresh. The events it was waiting for
 * are all already in the database, so the last couple of days are fetched and
 * merged underneath whatever the socket has delivered live.
 */

export interface ActivityItem {
  id: string;
  ts: number;
  text: string;
  tone: 'good' | 'warn' | 'bad';
}

/** How far back to seed. Long enough to cover a night, short enough to stay a feed. */
const SEED_DAYS = 3;
const MAX_ITEMS = 12;

const POWER_TEXT: Record<PowerState, string> = {
  mains: 'Light came back on',
  battery: 'Light went off — router on the battery pack',
  off: 'Router lost power',
  unknown: 'Could not tell what was powering the router',
};

const POWER_TONE: Record<PowerState, ActivityItem['tone']> = {
  mains: 'good',
  battery: 'warn',
  off: 'bad',
  unknown: 'warn',
};

export function useActivity(recent: LiveEvent[]): {
  items: ActivityItem[];
  loading: boolean;
} {
  const incidents = useApi<{ incidents: Incident[] }>(`/incidents?days=${SEED_DAYS}`);
  const power = useApi<PowerSummary>(`/power?days=${SEED_DAYS}`);

  const seeded = useMemo(() => {
    const out: ActivityItem[] = [];

    for (const inc of incidents.data?.incidents ?? []) {
      const monitor = inc.kind === 'collector_down';
      out.push({
        id: `inc-open-${inc.id}`,
        ts: inc.start,
        text: incidentMeta(inc.kind).title,
        tone: monitor ? 'warn' : inc.severity === 'critical' ? 'bad' : 'warn',
      });
      if (inc.end !== null) {
        const mins = Math.max(1, Math.round((inc.durationSec ?? 0) / 60));
        out.push({
          id: `inc-close-${inc.id}`,
          ts: inc.end,
          // "Back up" is wrong for the one incident kind that is about this
          // app rather than about the line.
          text: monitor ? `Monitor came back after ${mins} min` : `Back up after ${mins} min`,
          tone: 'good',
        });
      }
    }

    for (const span of power.data?.spans ?? []) {
      out.push({
        id: `pwr-${span.id}`,
        ts: span.start,
        text: POWER_TEXT[span.state],
        tone: POWER_TONE[span.state],
      });
    }

    return out;
  }, [incidents.data, power.data]);

  const items = useMemo(() => {
    const live: ActivityItem[] = recent.map((e) => ({
      id: e.id,
      ts: e.ts,
      text: e.text,
      tone: /fail|down|cut|error|problem|off|lost/i.test(e.text) ? 'warn' : 'good',
    }));

    /*
     * The socket and the database describe the same events, so the same power
     * change arrives twice - once live, once in the seed - a few seconds apart.
     * Collapsing on the minute plus the text is crude and exactly right here:
     * two entries saying the same sentence about the same minute are one event.
     */
    const seen = new Set<string>();
    const merged: ActivityItem[] = [];
    for (const item of [...live, ...seeded].sort((a, b) => b.ts - a.ts)) {
      const key = `${Math.round(item.ts / 60_000)}:${item.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }

    return merged.slice(0, MAX_ITEMS);
  }, [recent, seeded]);

  return { items, loading: incidents.loading || power.loading };
}
