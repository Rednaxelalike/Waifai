import { logger } from './log.ts';

const log = logger('scheduler');

/**
 * A small interval runner with the two properties cron does not give you here:
 * jobs never overlap themselves, and a job that throws does not kill the
 * process or stop its own schedule.
 *
 * Overlap protection matters most for the ONT poll. The ONT allows one web
 * session, so a slow poll that was still running when the next tick fired
 * would deadlock against itself and lock the household out of the router UI.
 */

interface Job {
  name: string;
  intervalMs: number;
  fn: () => Promise<void>;
  timer?: NodeJS.Timeout;
  running: boolean;
  lastRun: number;
  lastError: string | null;
  runs: number;
  failures: number;
  /** Whether this job's last run is written down and read back at startup. */
  remembered: boolean;
}

/**
 * Where a deferred job's last run is kept between restarts.
 *
 * An interface rather than the database itself, so the scheduler keeps its one
 * import and so a scheduler built without a store behaves exactly as it did
 * before there was one.
 */
export interface RunStore {
  load(job: string): number | null;
  save(job: string, ts: number): void;
}

/**
 * How long an overdue job waits after startup before its first run.
 *
 * Not zero. The whole reason a job is deferred is that its first run competes
 * with every other collector's, and a speed test measuring a box that is still
 * opening its database and discovering the ONT is measuring the startup rather
 * than the line.
 */
const OVERDUE_DELAY_MS = 60_000;

export class Scheduler {
  private jobs = new Map<string, Job>();
  private stopped = false;
  /*
   * Assigned in the body rather than declared as a constructor parameter
   * property: this project's server is run by node straight off the .ts
   * sources, and strip-only type removal rejects that syntax outright.
   */
  private readonly store: RunStore | null;

  constructor(store: RunStore | null = null) {
    this.store = store;
  }

  /**
   * `immediate` runs the job once at startup rather than waiting a full
   * interval, so a fresh install shows data within seconds instead of after a
   * minute of empty charts.
   */
  add(name: string, intervalMs: number, fn: () => Promise<void>, immediate = true): void {
    const job: Job = {
      name,
      intervalMs,
      fn,
      running: false,
      lastRun: 0,
      lastError: null,
      runs: 0,
      failures: 0,
      // Only the deferred jobs, because they are the only ones that read it
      // back. Remembering the probe job would be a database write every twenty
      // seconds to answer a question nothing asks.
      remembered: !immediate,
    };
    this.jobs.set(name, job);

    // Stagger startup. Firing every collector at once on a Pi produces a burst
    // of CPU and network contention that shows up as phantom packet loss in
    // the very first samples.
    const startDelay = immediate ? Math.floor(Math.random() * 2000) : this.dueIn(job);
    setTimeout(() => {
      if (this.stopped) return;
      void this.run(job);
      job.timer = setInterval(() => void this.run(job), intervalMs);
    }, startDelay);
  }

  /**
   * How long a deferred job waits for its first run.
   *
   * One full interval is the answer when nothing is known, and it used to be
   * the only answer: the countdown lived in memory, so a machine restarted
   * more often than the interval never reached the end of one. For the speed
   * test - three hours - that meant a desktop ran one on the schedule roughly
   * never, and every reading in the database came from someone pressing the
   * button.
   *
   * With a remembered last run the wait is whatever is left of the interval,
   * and a job that came due while the process was down runs a minute after
   * boot instead of a full interval later.
   *
   * Note what the stored time means: when the job last *ran*, which includes a
   * run that returned early - a speed test skipped because the line was busy -
   * and a manual trigger from the dashboard. That is the intent, since the
   * question is "how long since this last happened", but it does mean pressing
   * the speed test button moves the next scheduled one, which the in-memory
   * interval never did inside a single process.
   */
  private dueIn(job: Job): number {
    const last = job.remembered ? (this.store?.load(job.name) ?? null) : null;
    if (last === null) return job.intervalMs;

    const elapsed = Date.now() - last;
    /*
     * A last run in the future means the clock moved, not that the job ran
     * ahead of itself: a Pi with no RTC boots in 1970 and gets the real time
     * from NTP seconds later, which leaves every job stamped decades ahead.
     * Treat it as knowing nothing rather than sleeping until it comes round.
     */
    if (elapsed < 0) {
      log.warn(`${job.name} was last run in the future; ignoring the stored time`);
      return job.intervalMs;
    }

    const remaining = job.intervalMs - elapsed;
    if (remaining <= 0) {
      log.info(`${job.name} came due while we were down; running it shortly after startup`);
    }
    return Math.max(OVERDUE_DELAY_MS, remaining);
  }

  private async run(job: Job): Promise<void> {
    if (this.stopped) return;
    if (job.running) {
      log.warn(`${job.name} is still running from the previous tick; skipping this one`);
      return;
    }
    job.running = true;
    const started = performance.now();
    try {
      await job.fn();
      job.lastError = null;
      job.runs++;
    } catch (err) {
      job.failures++;
      job.lastError = err instanceof Error ? err.message : String(err);
      // Never rethrow: an unhandled rejection here would take down the whole
      // monitor over one bad HTTP response.
      log.error(`${job.name} failed`, err);
    } finally {
      job.running = false;
      job.lastRun = Date.now();
      if (job.remembered) this.store?.save(job.name, job.lastRun);
      const ms = Math.round(performance.now() - started);
      if (ms > job.intervalMs) {
        log.warn(`${job.name} took ${ms}ms, longer than its ${job.intervalMs}ms interval`);
      }
    }
  }

  /** Run a job now, outside its schedule. Used by the manual-trigger endpoints. */
  async trigger(name: string): Promise<boolean> {
    const job = this.jobs.get(name);
    if (!job || job.running) return false;
    await this.run(job);
    return true;
  }

  /** Job health, surfaced on /api/health so a silent collector is visible. */
  status(): { name: string; lastRun: number; running: boolean; runs: number; failures: number; lastError: string | null }[] {
    return [...this.jobs.values()].map((j) => ({
      name: j.name,
      lastRun: j.lastRun,
      running: j.running,
      runs: j.runs,
      failures: j.failures,
      lastError: j.lastError,
    }));
  }

  stop(): void {
    this.stopped = true;
    for (const job of this.jobs.values()) {
      if (job.timer) clearInterval(job.timer);
    }
    log.info('scheduler stopped');
  }
}
