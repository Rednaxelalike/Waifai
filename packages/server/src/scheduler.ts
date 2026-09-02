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
}

export class Scheduler {
  private jobs = new Map<string, Job>();
  private stopped = false;

  /**
   * `immediate` runs the job once at startup rather than waiting a full
   * interval, so a fresh install shows data within seconds instead of after a
   * minute of empty charts.
   */
  add(name: string, intervalMs: number, fn: () => Promise<void>, immediate = true): void {
    const job: Job = { name, intervalMs, fn, running: false, lastRun: 0, lastError: null, runs: 0, failures: 0 };
    this.jobs.set(name, job);

    // Stagger startup. Firing every collector at once on a Pi produces a burst
    // of CPU and network contention that shows up as phantom packet loss in
    // the very first samples.
    const startDelay = immediate ? Math.floor(Math.random() * 2000) : intervalMs;
    setTimeout(() => {
      if (this.stopped) return;
      void this.run(job);
      job.timer = setInterval(() => void this.run(job), intervalMs);
    }, startDelay);
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
