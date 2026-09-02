import { Resolver } from 'node:dns/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { networkInterfaces, platform } from 'node:os';

const run = promisify(execFile);
const IS_WIN = platform() === 'win32';

/**
 * Non-ICMP reachability probes.
 *
 * DNS and HTTP are separated from ping on purpose. A line where ICMP flies but
 * DNS times out is a completely different fault from one where the fibre is
 * cut, and the household experiences both as "the internet is broken". Keeping
 * them apart is what lets the dashboard say which one it is.
 */

export interface DnsResult {
  name: string;
  server: string | null;
  /** Time to resolve, ms. Null on failure. */
  ms: number | null;
  ok: boolean;
  error: string | null;
}

/**
 * Resolve `name`, optionally forcing a specific resolver. Forcing a public
 * resolver and comparing against the ONT's own is how you tell "MTN's DNS is
 * sick" apart from "there is no route out at all".
 */
export async function resolveTimed(name: string, server?: string, timeoutMs = 4000): Promise<DnsResult> {
  const resolver = new Resolver({ timeout: timeoutMs, tries: 1 });
  if (server) resolver.setServers([server]);
  const started = performance.now();
  try {
    const addrs = await resolver.resolve4(name);
    if (!addrs.length) throw new Error('empty answer');
    return { name, server: server ?? null, ms: Number((performance.now() - started).toFixed(1)), ok: true, error: null };
  } catch (err) {
    return {
      name,
      server: server ?? null,
      ms: null,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface HttpResult {
  url: string;
  status: number | null;
  ms: number | null;
  ok: boolean;
}

/**
 * Fetch a captive-portal detection endpoint. These return a tiny empty body,
 * so this measures reachability and time-to-first-byte without pulling data.
 */
export async function httpCheck(
  url = 'http://cp.cloudflare.com/generate_204',
  timeoutMs = 6000,
): Promise<HttpResult> {
  const started = performance.now();
  try {
    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'Cache-Control': 'no-cache' },
    });
    // Anything under 400 counts: a 204, a 200, or a redirect all prove a
    // working path out of the network.
    return {
      url,
      status: res.status,
      ms: Number((performance.now() - started).toFixed(1)),
      ok: res.status > 0 && res.status < 400,
    };
  } catch {
    return { url, status: null, ms: null, ok: false };
  }
}

// ---------------------------------------------------------------------------
// ARP
// ---------------------------------------------------------------------------

export interface ArpEntry {
  ip: string;
  mac: string;
}

const MAC_ANY = /([0-9A-Fa-f]{2}(?:[:-][0-9A-Fa-f]{2}){5})/;
const IPV4 = /((?:\d{1,3}\.){3}\d{1,3})/;

/**
 * Read the host's ARP/neighbour table.
 *
 * This is a second, independent source of device presence alongside the ONT's
 * DHCP list. The DHCP table lies: it keeps showing devices for the whole lease
 * duration long after they have left the house. ARP entries expire in minutes,
 * so presence built on ARP actually tracks who is home.
 */
/** 224.0.0.0/4 - a group address, never a host. */
function isMulticastV4(ip: string): boolean {
  const first = Number(ip.split('.')[0]);
  return Number.isFinite(first) && first >= 224 && first <= 239;
}

export async function arpTable(): Promise<ArpEntry[]> {
  const out: ArpEntry[] = [];
  const seen = new Set<string>();
  const push = (ip: string, mac: string): void => {
    const m = mac.replace(/-/g, ':').toUpperCase();
    if (m === '00:00:00:00:00:00' || m === 'FF:FF:FF:FF:FF:FF') return;
    /*
     * Multicast, not a device. Every ARP table carries the standing IPv4
     * multicast group entries (`01:00:5E:...` against 224.0.0.0/4) for mDNS,
     * SSDP and IGMP, and the broadcast address of the subnet.
     *
     * Left in, each one is counted as a household device that is permanently
     * present, and each one fires an "unrecognised device joined your network"
     * alert the first time it is seen. That is the exact failure the
     * randomised-MAC handling elsewhere exists to avoid: an alert that cries
     * wolf gets muted, and then it is not there when a real stranger joins.
     */
    if (m.startsWith('01:00:5E') || m.startsWith('33:33') || m.startsWith('01:80:C2')) return;
    if (isMulticastV4(ip) || ip.endsWith('.255')) return;
    const key = `${ip}|${m}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ ip, mac: m });
  };

  // Include the host machine's own non-loopback network interface(s),
  // which never appear in its own arp -a table.
  try {
    const ifaces = networkInterfaces();
    for (const addrs of Object.values(ifaces)) {
      for (const addr of addrs ?? []) {
        if (
          addr.family === 'IPv4' &&
          !addr.internal &&
          addr.mac &&
          addr.mac !== '00:00:00:00:00:00' &&
          !addr.address.startsWith('169.254.')
        ) {
          push(addr.address, addr.mac);
        }
      }
    }
  } catch {
    /* ignore if networkInterfaces is unavailable */
  }

  const commands: [string, string[]][] = IS_WIN
    ? [['arp', ['-a']]]
    : [
        ['ip', ['neigh', 'show']],
        ['arp', ['-an']],
      ];

  for (const [bin, argv] of commands) {
    try {
      const { stdout } = await run(bin, argv, { windowsHide: true, encoding: 'utf8', timeout: 8000 });
      for (const line of stdout.split(/\r?\n/)) {
        // `ip neigh` marks stale/failed entries; FAILED means no such device.
        if (/\bFAILED\b|\bINCOMPLETE\b/i.test(line)) continue;
        const ip = line.match(IPV4)?.[1];
        const mac = line.match(MAC_ANY)?.[1];
        if (ip && mac) push(ip, mac);
      }
      if (out.length) break;
    } catch {
      /* try the next command */
    }
  }
  return out;
}

/**
 * Ping every address in a /24 to force ARP entries into existence.
 *
 * Passive ARP only shows devices that have talked to this host recently, which
 * on a quiet network is almost none of them. A sweep costs one tiny packet per
 * address and makes presence detection actually work. Concurrency is capped
 * hard: a Pi will drop its own replies if you fan out too wide.
 */
export async function sweepSubnet(cidrBase: string, concurrency = 24, timeoutMs = 700): Promise<void> {
  const parts = cidrBase.split('.').slice(0, 3);
  if (parts.length !== 3) return;
  const prefix = parts.join('.');
  const hosts: string[] = [];
  for (let i = 1; i <= 254; i++) hosts.push(`${prefix}.${i}`);

  const pingArgs = (t: string): string[] =>
    IS_WIN ? ['-n', '1', '-w', String(timeoutMs), t] : ['-c', '1', '-W', '1', t];

  const queue = [...hosts];
  const workers = Array.from({ length: concurrency }, async () => {
    for (let t = queue.shift(); t !== undefined; t = queue.shift()) {
      // Failures are the common case and carry no information here: the point
      // is the side effect on the ARP cache, not the result.
      await run('ping', pingArgs(t), { windowsHide: true, timeout: timeoutMs + 1500 }).catch(() => {});
    }
  });
  await Promise.all(workers);
}
