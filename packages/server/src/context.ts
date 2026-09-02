import { EventEmitter } from 'node:events';
import type { ServerEvent } from '@waifai/shared';
import { Alerter } from './alerts/index.ts';
import { IncidentTracker } from './analyze/incidents.ts';
import { Db } from './db/index.ts';
import { PowerTracker } from './analyze/power.ts';
import { OntClient } from './ont/client.ts';

/**
 * Everything long-lived, constructed once and passed down.
 *
 * Assembling it here rather than reaching for module-level singletons keeps
 * the collectors testable: each takes a context, so a test can hand them an
 * in-memory database and a stub ONT.
 */
export interface AppContext {
  db: Db;
  ont: OntClient;
  tracker: IncidentTracker;
  /** Mains vs battery vs dark, kept separate from the line-health tracker. */
  power: PowerTracker;
  alerter: Alerter;
  bus: EventBus;
  /** Set by the ONT collector; read by the probe collector for classification. */
  lastPonUp: boolean | null;
  /** Resolved once at boot, since the routing table rarely changes. */
  gateway: string | null;
  startedAt: number;
}

/** Typed wrapper over EventEmitter, so the WebSocket layer cannot mistype. */
export class EventBus {
  private emitter = new EventEmitter();

  constructor() {
    // One connection per household member plus a couple of stale tabs; the
    // default limit of 10 is genuinely reachable here.
    this.emitter.setMaxListeners(64);
  }

  emit(event: ServerEvent): void {
    this.emitter.emit('event', event);
  }

  subscribe(fn: (event: ServerEvent) => void): () => void {
    this.emitter.on('event', fn);
    return () => this.emitter.off('event', fn);
  }
}

export function createContext(db = new Db()): AppContext {
  return {
    db,
    ont: new OntClient(),
    tracker: new IncidentTracker(db),
    power: new PowerTracker(db),
    alerter: new Alerter(db),
    bus: new EventBus(),
    lastPonUp: null,
    gateway: null,
    startedAt: Date.now(),
  };
}
