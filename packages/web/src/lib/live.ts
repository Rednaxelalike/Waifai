import { useEffect, useRef, useState } from 'react';
import type {
  Device,
  Incident,
  Notice,
  PowerNow,
  ServerEvent,
  SpeedtestSample,
  StatusSnapshot,
} from '@waifai/shared';

/**
 * WebSocket connection to the collector.
 *
 * Reconnection is the entire reason this is more than four lines. The socket
 * will drop constantly in normal use: the phone locks its screen, Wi-Fi
 * roams between bands, and - most importantly - the connection this app exists
 * to monitor goes down. A dashboard that needs a manual refresh after the
 * event it was watching is worthless.
 */

export type ConnectionState = 'connecting' | 'open' | 'closed';

export interface LiveState {
  status: StatusSnapshot | null;
  connection: ConnectionState;
  /** Most recent events, newest first. Feeds the activity list on the home page. */
  recent: LiveEvent[];
}

export interface LiveEvent {
  id: string;
  ts: number;
  kind: 'incident_opened' | 'incident_closed' | 'device_new' | 'speedtest' | 'notice' | 'power';
  text: string;
}

const MAX_RECENT = 30;

export function useLive(): LiveState {
  const [status, setStatus] = useState<StatusSnapshot | null>(null);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [recent, setRecent] = useState<LiveEvent[]>([]);

  const socketRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);
  const timerRef = useRef<number | undefined>(undefined);
  const closedByUs = useRef(false);

  useEffect(() => {
    closedByUs.current = false;

    const connect = (): void => {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(`${proto}//${location.host}/api/live`);
      socketRef.current = socket;
      setConnection('connecting');

      socket.onopen = () => {
        attemptRef.current = 0;
        setConnection('open');
      };

      socket.onmessage = (msg) => {
        let event: ServerEvent;
        try {
          event = JSON.parse(String(msg.data)) as ServerEvent;
        } catch {
          return;
        }
        if (event.type === 'status') {
          setStatus(event.payload);
          return;
        }
        const entry = describe(event);
        if (entry) setRecent((prev) => [entry, ...prev].slice(0, MAX_RECENT));
      };

      socket.onclose = () => {
        setConnection('closed');
        if (closedByUs.current) return;
        /*
         * Exponential backoff, capped at 15 seconds and jittered. Without the
         * cap, a phone that was asleep for an hour would sit there not
         * reconnecting; without the jitter, six phones waking together after
         * an outage would all retry in lockstep against a Pi that is still
         * recovering.
         */
        const attempt = Math.min(attemptRef.current++, 6);
        const delay = Math.min(15_000, 500 * 2 ** attempt) * (0.75 + Math.random() * 0.5);
        timerRef.current = window.setTimeout(connect, delay);
      };

      socket.onerror = () => socket.close();
    };

    connect();

    /*
     * Phones suspend timers and sockets on lock. When the tab becomes visible
     * again the socket is often dead but has not fired onclose yet, so the
     * backoff timer never runs and the UI silently shows stale data. Retrying
     * immediately on focus is what makes the app feel live when you actually
     * pick up your phone.
     */
    const onVisible = (): void => {
      if (document.visibilityState !== 'visible') return;
      const s = socketRef.current;
      if (!s || s.readyState === WebSocket.CLOSED || s.readyState === WebSocket.CLOSING) {
        window.clearTimeout(timerRef.current);
        attemptRef.current = 0;
        connect();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      closedByUs.current = true;
      document.removeEventListener('visibilitychange', onVisible);
      window.clearTimeout(timerRef.current);
      socketRef.current?.close();
    };
  }, []);

  return { status, connection, recent };
}

function describe(event: ServerEvent): LiveEvent | null {
  const id = `${event.type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  switch (event.type) {
    case 'incident_opened': {
      const inc = event.payload as Incident;
      return { id, ts: inc.start, kind: event.type, text: `Problem started: ${inc.kind.replace(/_/g, ' ')}` };
    }
    case 'incident_closed': {
      const inc = event.payload as Incident;
      return {
        id,
        ts: inc.end ?? Date.now(),
        kind: event.type,
        text: `Recovered after ${Math.round((inc.durationSec ?? 0) / 60)} min (${inc.kind.replace(/_/g, ' ')})`,
      };
    }
    case 'device_new': {
      const d = event.payload as Device;
      return { id, ts: d.firstSeen, kind: event.type, text: `New device: ${d.label ?? d.hostname ?? d.mac}` };
    }
    case 'speedtest': {
      const s = event.payload as SpeedtestSample;
      return { id, ts: s.ts, kind: event.type, text: `Speed test: ${s.downMbps} / ${s.upMbps} Mbps` };
    }
    case 'power': {
      const p = event.payload as PowerNow;
      const said: Record<string, string> = {
        mains: 'Light is back on',
        battery: 'Light off - router is on the battery pack',
        off: 'Wi-Fi is off - the router has no power',
        unknown: 'Cannot tell what is powering the router',
      };
      return { id, ts: p.since ?? Date.now(), kind: event.type, text: said[p.state] ?? p.state };
    }
    case 'notice': {
      const nt = event.payload as Notice;
      return { id, ts: nt.ts, kind: event.type, text: `${nt.author}: ${nt.body}` };
    }
    default:
      return null;
  }
}
