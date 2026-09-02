/**
 * Minimal levelled logger. Deliberately not a dependency: on a Pi the log is
 * read with `journalctl` or `docker logs`, and a structured logging library
 * would be more machinery than the job needs.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
export type Level = keyof typeof LEVELS;

const threshold = LEVELS[(process.env['LOG_LEVEL'] as Level) || 'info'] ?? LEVELS.info;

function emit(level: Level, scope: string, msg: string, extra?: unknown): void {
  if (LEVELS[level] < threshold) return;
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const line = `${ts} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}`;
  const stream = LEVELS[level] >= LEVELS.warn ? process.stderr : process.stdout;
  stream.write(extra === undefined ? `${line}\n` : `${line} ${fmt(extra)}\n`);
}

function fmt(v: unknown): string {
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export function logger(scope: string) {
  return {
    debug: (msg: string, extra?: unknown) => emit('debug', scope, msg, extra),
    info: (msg: string, extra?: unknown) => emit('info', scope, msg, extra),
    warn: (msg: string, extra?: unknown) => emit('warn', scope, msg, extra),
    error: (msg: string, extra?: unknown) => emit('error', scope, msg, extra),
  };
}

export type Logger = ReturnType<typeof logger>;
