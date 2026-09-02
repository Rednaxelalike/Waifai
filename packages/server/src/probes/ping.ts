import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { platform } from 'node:os';

const run = promisify(execFile);
const IS_WIN = platform() === 'win32';

/**
 * ICMP probing by shelling out to the system `ping`.
 *
 * A raw-socket implementation would need root (or CAP_NET_RAW), which is a bad
 * trade for a box that sits on a home LAN for years. The system binary is
 * already setuid everywhere this runs.
 *
 * Rather than trusting each platform's summary line, individual RTTs are
 * parsed and the statistics computed here, so Windows and Linux produce
 * identical numbers.
 */

export interface PingResult {
  target: string;
  /** Mean RTT over the packets that came back, ms. Null when all were lost. */
  rttMs: number | null;
  /** Population standard deviation of RTT, ms. Null with fewer than 2 replies. */
  jitterMs: number | null;
  /** 0..1 */
  loss: number;
  sent: number;
  received: number;
  ok: boolean;
}

function args(target: string, count: number, timeoutMs: number): string[] {
  if (IS_WIN) {
    // -n count, -w per-reply timeout in ms.
    return ['-n', String(count), '-w', String(timeoutMs), target];
  }
  // -c count, -W per-reply timeout in seconds, -i interval between packets.
  // 0.25s spacing keeps a 5-packet burst under two seconds without tripping
  // the "only root can set interval below 0.2s" restriction.
  return ['-c', String(count), '-W', String(Math.max(1, Math.ceil(timeoutMs / 1000))), '-i', '0.25', target];
}

/** Windows prints "time=2ms" or "time<1ms"; Unix prints "time=2.41 ms". */
const TIME_RE = /time[=<]\s*([\d.]+)\s*ms/gi;

export async function ping(target: string, count = 5, timeoutMs = 1000): Promise<PingResult> {
  let stdout = '';
  try {
    const res = await run('ping', args(target, count, timeoutMs), {
      // The system ping waits out every lost packet in turn, so a blackholed
      // target costs count * timeoutMs. The margin here only covers process
      // startup; the real bound is set by the caller's choice of those two.
      timeout: timeoutMs * count + 2000,
      windowsHide: true,
      encoding: 'utf8',
    });
    stdout = res.stdout;
  } catch (err) {
    // A ping with 100% loss exits non-zero but still prints useful output.
    const e = err as { stdout?: string };
    stdout = e.stdout ?? '';
  }

  const times = [...stdout.matchAll(TIME_RE)]
    .map((m) => Number(m[1]))
    .filter((v) => Number.isFinite(v) && v >= 0);

  // `time<1ms` on Windows means sub-millisecond, not 1ms; close enough at LAN
  // distances and it never matters for the up/down decision.
  const received = times.length;
  const sent = count;
  const loss = sent === 0 ? 1 : Math.max(0, Math.min(1, (sent - received) / sent));

  let rttMs: number | null = null;
  let jitterMs: number | null = null;
  if (received > 0) {
    const mean = times.reduce((a, b) => a + b, 0) / received;
    rttMs = Number(mean.toFixed(2));
    if (received > 1) {
      const variance = times.reduce((a, b) => a + (b - mean) ** 2, 0) / received;
      jitterMs = Number(Math.sqrt(variance).toFixed(2));
    }
  }

  return { target, rttMs, jitterMs, loss, sent, received, ok: received > 0 };
}

/**
 * Ping several targets concurrently. Concurrency is capped because a Pi with a
 * cheap USB-Ethernet adapter will drop its own packets if you fork thirty
 * pings at once, which shows up as phantom packet loss.
 */
export async function pingAll(
  targets: readonly string[],
  count = 5,
  timeoutMs = 1000,
  concurrency = 6,
): Promise<PingResult[]> {
  const out: PingResult[] = [];
  const queue = [...targets];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (let t = queue.shift(); t !== undefined; t = queue.shift()) {
      out.push(await ping(t, count, timeoutMs));
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Find the first hop past the ONT by reading the routing table. Used when
 * PROBE_GATEWAY is unset. On MTN FibreX the ONT is normally the gateway too,
 * in which case this returns the ONT address and the gateway tier collapses
 * into the ont tier, which is correct rather than a bug.
 */
export async function defaultGateway(): Promise<string | null> {
  try {
    if (IS_WIN) {
      const { stdout } = await run('route', ['print', '0.0.0.0'], { windowsHide: true, encoding: 'utf8' });
      const m = stdout.match(/0\.0\.0\.0\s+0\.0\.0\.0\s+((?:\d{1,3}\.){3}\d{1,3})/);
      return m?.[1] ?? null;
    }
    const { stdout } = await run('ip', ['route', 'show', 'default'], { encoding: 'utf8' });
    return stdout.match(/default\s+via\s+((?:\d{1,3}\.){3}\d{1,3})/)?.[1] ?? null;
  } catch {
    return null;
  }
}
