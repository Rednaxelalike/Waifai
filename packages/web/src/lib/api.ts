import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Device,
  Incident,
  Notice,
  OpticalSample,
  OpticalTrend,
  PowerSummary,
  ProbeSample,
  SpeedtestSample,
  StatusSnapshot,
  ThroughputPoint,
  UptimeReport,
  UsageSummary,
} from '@waifai/shared';

/**
 * Thin fetch layer plus a `useApi` hook.
 *
 * Deliberately not TanStack Query. The whole app has about a dozen endpoints,
 * live updates arrive over a WebSocket rather than by refetching, and adding a
 * caching library would cost more bundle than every page here put together.
 */

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * What to put in front of a person when a request fails.
 *
 * Never the thrown message. Those read `Failed to fetch`, `request failed
 * (502)`, or whatever string a route handler happened to write, and none of
 * them mean anything to someone who opened this app because the light went.
 * The status is the only part worth reading, and it separates the cases that
 * call for different things being done about them.
 */
export function humanError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return 'The access code for this monitor is wrong or missing.';
    if (err.status === 404) return 'That part is not set up on this monitor.';
    if (err.status >= 500) return 'The monitor is running but could not answer.';
    return 'The monitor would not accept that.';
  }
  return 'Could not reach the monitor.';
}

/** Optional shared passphrase, only used when the server has one configured. */
function accessCode(): string | null {
  try {
    return localStorage.getItem('waifai:code');
  } catch {
    return null;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const code = accessCode();
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(code ? { 'X-Access-Code': code } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}) as { error?: string });
    throw new ApiError(detail.error ?? `request failed (${res.status})`, res.status);
  }
  return (await res.json()) as T;
}

/**
 * URL for a file the browser downloads directly (the CSV exports).
 *
 * These are plain links rather than fetches, so the access code has to ride in
 * the query string - which the server accepts for exactly this reason.
 */
export function exportUrl(path: string): string {
  const code = accessCode();
  if (code === null) return `/api${path}`;
  return `/api${path}${path.includes('?') ? '&' : '?'}code=${encodeURIComponent(code)}`;
}

/* -- global refresh -------------------------------------------------------- */

const REFRESH_EVENT = 'waifai:refresh';

/**
 * Re-fetch everything on screen.
 *
 * The header's refresh button used to call `location.reload()`, which on a PWA
 * means a white screen and a fresh service-worker boot for what should be three
 * small requests. Every `useApi` subscribes to this instead.
 */
export function refreshAll(): void {
  window.dispatchEvent(new Event(REFRESH_EVENT));
}

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** True once a fetch has failed but stale cached data is still shown. */
  stale: boolean;
  reload: () => void;
}

/**
 * Fetch on mount, whenever `deps` change, and whenever the app asks everything
 * to refresh.
 *
 * On failure it keeps the previous data on screen and flags it stale rather
 * than blanking the page. During an outage - exactly when someone opens this
 * app - a stale reading is far more useful than an error message.
 */
export function useApi<T>(path: string | null, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [nonce, setNonce] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    window.addEventListener(REFRESH_EVENT, reload);
    return () => window.removeEventListener(REFRESH_EVENT, reload);
  }, [reload]);

  useEffect(() => {
    if (path === null) return;
    setLoading(true);
    api<T>(path)
      .then((d) => {
        if (!alive.current) return;
        setData(d);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!alive.current) return;
        setError(humanError(err));
      })
      .finally(() => {
        if (alive.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, nonce, ...deps]);

  return { data, error, loading, stale: error !== null && data !== null, reload };
}

// -- typed endpoints ---------------------------------------------------------

export const endpoints = {
  status: () => api<StatusSnapshot>('/status'),

  optical: (hours: number) =>
    api<{ resolution: 'raw' | 'hourly'; points: OpticalSample[] | HourlyOptical[] }>(
      `/optical?hours=${hours}`,
    ),
  opticalTrend: (days: number) => api<OpticalTrend>(`/optical/trend?days=${days}`),

  throughput: (hours: number) => api<{ points: ThroughputPoint[] }>(`/throughput?hours=${hours}`),
  probes: (hours: number, tier?: string) =>
    api<{ points: ProbeSample[] }>(`/probes?hours=${hours}${tier ? `&tier=${tier}` : ''}`),

  speedtests: (days: number) =>
    api<{ plan: { downMbps: number; upMbps: number }; points: SpeedtestSample[] }>(
      `/speedtests?days=${days}`,
    ),

  incidents: (days: number) => api<{ incidents: Incident[] }>(`/incidents?days=${days}`),
  uptime: (days: number) => api<UptimeReport>(`/uptime?days=${days}`),
  annotate: (id: number, note: string) =>
    api<Incident>(`/incidents/${id}/note`, { method: 'PATCH', body: JSON.stringify({ note }) }),

  power: (days: number) => api<PowerSummary>(`/power?days=${days}`),

  devices: () => api<{ devices: Device[] }>('/devices'),
  updateDevice: (
    mac: string,
    patch: Partial<Pick<Device, 'label' | 'owner' | 'trusted' | 'mainsWitness'>>,
  ) =>
    api<Device>(`/devices/${encodeURIComponent(mac)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  usage: () => api<UsageSummary & { human: Record<string, string | null> }>('/usage'),

  notices: () => api<{ notices: Notice[] }>('/notices'),
  addNotice: (author: string, body: string, pinned = false) =>
    api<Notice>('/notices', { method: 'POST', body: JSON.stringify({ author, body, pinned }) }),
  deleteNotice: (id: number) => api<{ ok: true }>(`/notices/${id}`, { method: 'DELETE' }),

  wifi: () => api<{ ssid: string; qr: string }>('/wifi'),

  runSpeedtest: () => api<{ started: boolean }>('/actions/speedtest', { method: 'POST' }),
  pollNow: () => api<{ started: boolean }>('/actions/poll', { method: 'POST' }),
  reboot: () =>
    api<{ ok: boolean; detail: string }>('/actions/reboot', {
      method: 'POST',
      body: JSON.stringify({ confirm: 'reboot' }),
    }),

  health: () => api<HealthResponse>('/health'),
};

export interface HourlyOptical {
  hour: number;
  rx: number | null;
  rxMin: number | null;
  rxMax: number | null;
  temp: number | null;
}

export interface HealthResponse {
  ok: boolean;
  uptimeSec: number;
  jobs: {
    name: string;
    lastRun: number;
    running: boolean;
    runs: number;
    failures: number;
    lastError: string | null;
  }[];
  tracker: { consecutiveBad: number; consecutiveGood: number; pendingKind: string | null };
  ont: {
    host: string;
    model: string | null;
    firmware: string | null;
    uptimeSec: number | null;
    bootTs: number | null;
    knownPages: { path: string; kinds: string[] }[];
  };
  /** Outbound notification channels the server has been given credentials for. */
  alerts: { channels: string[]; cooldownMin: number };
  db: { file: string };
}
