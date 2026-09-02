import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { buildStatus } from '../analyze/status.ts';
import { logger } from '../log.ts';

const log = logger('ws');

/**
 * Live push to open dashboards.
 *
 * Polling would work, but this is a phone-first app on a home connection: a
 * socket that stays quiet costs nothing, whereas six phones polling every few
 * seconds keeps their radios awake and drains batteries for no benefit. It
 * also means the "internet is down" card flips the instant the collector
 * notices, rather than up to a poll interval later.
 */
export function registerWebSocket(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/live', { websocket: true }, (socket) => {
    // Send current state immediately so a freshly opened tab is never blank
    // while it waits for the next collector tick.
    try {
      socket.send(JSON.stringify({ type: 'status', payload: buildStatus(ctx) }));
    } catch {
      /* the socket can already be closing */
    }

    const unsubscribe = ctx.bus.subscribe((event) => {
      if (socket.readyState !== socket.OPEN) return;
      try {
        socket.send(JSON.stringify(event));
      } catch (err) {
        log.debug('send failed', err);
      }
    });

    /*
     * Phones suspend sockets aggressively when the screen locks, and a
     * half-dead connection looks alive from the server side indefinitely.
     * Ping/pong reaps those, otherwise the bus accumulates listeners for
     * every tab anyone has ever opened.
     */
    let alive = true;
    socket.on('pong', () => {
      alive = true;
    });
    const heartbeat = setInterval(() => {
      if (!alive) {
        socket.terminate();
        return;
      }
      alive = false;
      try {
        socket.ping();
      } catch {
        socket.terminate();
      }
    }, 30_000);

    const cleanup = (): void => {
      clearInterval(heartbeat);
      unsubscribe();
    };
    socket.on('close', cleanup);
    socket.on('error', cleanup);
  });
}
