import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { SpeedtestSample } from '@waifai/shared';
import { config } from '../config.ts';
import { logger } from '../log.ts';

const run = promisify(execFile);
const log = logger('speedtest');

/**
 * Throughput measurement, with a graceful ladder of options.
 *
 * The Ookla CLI is the accurate one and the only result MTN support will
 * recognise, but it is a manual install on a Pi. When it is missing we fall
 * back to a plain HTTP transfer against Cloudflare's speed endpoints, which
 * needs nothing installed and is good to within a few percent on a home line.
 *
 * A caveat worth understanding before reading these charts: a speed test run
 * while the household is streaming measures the *leftover* capacity, not the
 * line. Tests are scheduled a few times a day rather than hourly for exactly
 * that reason, and the throughput series from the WAN counters is the better
 * signal for "is the line busy".
 */

interface OoklaResult {
  ping?: { latency?: number; jitter?: number };
  download?: { bandwidth?: number };
  upload?: { bandwidth?: number };
  server?: { name?: string; location?: string };
}

async function viaOokla(): Promise<SpeedtestSample | null> {
  try {
    const { stdout } = await run(
      config.speedtest.ooklaBin,
      ['--format=json', '--accept-license', '--accept-gdpr', '--progress=no'],
      { timeout: 180_000, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
    );
    const json = JSON.parse(stdout) as OoklaResult;
    // Ookla reports bandwidth in bytes per second.
    const down = ((json.download?.bandwidth ?? 0) * 8) / 1e6;
    const up = ((json.upload?.bandwidth ?? 0) * 8) / 1e6;
    if (down <= 0 && up <= 0) return null;
    return {
      ts: Date.now(),
      downMbps: Number(down.toFixed(2)),
      upMbps: Number(up.toFixed(2)),
      pingMs: json.ping?.latency ?? null,
      jitterMs: json.ping?.jitter ?? null,
      serverName: [json.server?.name, json.server?.location].filter(Boolean).join(', ') || null,
      source: 'ookla',
    };
  } catch (err) {
    log.debug('ookla CLI unavailable or failed', err);
    return null;
  }
}

/** Time a fixed-size download, discarding the bytes as they arrive. */
async function timedDownload(bytes: number, timeoutMs: number): Promise<number | null> {
  // The nonce defeats any transparent proxy between here and Cloudflare; a
  // cached response would report an absurd speed.
  const url = `https://speed.cloudflare.com/__down?bytes=${bytes}&n=${Date.now()}`;
  const started = performance.now();
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (!res.ok || !res.body) return null;
    let received = 0;
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) received += chunk.byteLength;
    const seconds = (performance.now() - started) / 1000;
    if (seconds <= 0 || received === 0) return null;
    return (received * 8) / seconds / 1e6;
  } catch {
    return null;
  }
}

async function timedUpload(bytes: number, timeoutMs: number): Promise<number | null> {
  const payload = new Uint8Array(bytes);
  const started = performance.now();
  try {
    const res = await fetch('https://speed.cloudflare.com/__up', {
      method: 'POST',
      body: payload,
      headers: { 'Content-Type': 'application/octet-stream' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    await res.arrayBuffer().catch(() => undefined);
    const seconds = (performance.now() - started) / 1000;
    if (seconds <= 0) return null;
    return (bytes * 8) / seconds / 1e6;
  } catch {
    return null;
  }
}

async function viaHttp(): Promise<SpeedtestSample | null> {
  const downBytes = Math.max(1, config.speedtest.fallbackMb) * 1024 * 1024;
  // Upstream on a home fibre plan is much smaller than downstream; sending the
  // same volume up would take minutes.
  const upBytes = Math.max(1, Math.round(config.speedtest.fallbackMb / 5)) * 1024 * 1024;

  // Two download runs, best-of. The first often catches TCP still ramping up.
  const runs = [await timedDownload(downBytes, 120_000), await timedDownload(downBytes, 120_000)].filter(
    (v): v is number => v !== null,
  );
  const down = runs.length ? Math.max(...runs) : null;
  const up = await timedUpload(upBytes, 120_000);

  if (down === null && up === null) return null;
  return {
    ts: Date.now(),
    downMbps: Number((down ?? 0).toFixed(2)),
    upMbps: Number((up ?? 0).toFixed(2)),
    pingMs: null,
    jitterMs: null,
    serverName: 'speed.cloudflare.com',
    source: 'http-fallback',
  };
}

export async function runSpeedtest(): Promise<SpeedtestSample | null> {
  if (!config.speedtest.enabled) return null;
  const ookla = await viaOokla();
  if (ookla) return ookla;
  log.info('falling back to HTTP throughput measurement (install the Ookla CLI for better numbers)');
  return viaHttp();
}
