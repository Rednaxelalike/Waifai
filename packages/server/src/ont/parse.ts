import type { OpticalSample, WanSample } from '@waifai/shared';
import type { OntPage } from './client.ts';

/**
 * Parsers for the ONT web UI.
 *
 * These are deliberately content-driven, not path-driven. Firmware builds move
 * data between `.asp` files constantly, so instead of "read rx power from
 * ponstatus.asp" the strategy is "run every extractor over every page we
 * fetched, and keep whatever passes a plausibility check". A wrong number
 * grabbed from the wrong place gets rejected by the range test rather than
 * quietly poisoning a year of history.
 */

const MAC_RE = /\b([0-9A-Fa-f]{2}(?:[:-][0-9A-Fa-f]{2}){5})\b/;
const MAC_RE_G = new RegExp(MAC_RE.source, 'g');
const IPV4_RE = /\b((?:\d{1,3}\.){3}\d{1,3})\b/;
const IPV4_RE_G = new RegExp(IPV4_RE.source, 'g');
const IPV6_RE = /\b((?:[0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}(?:\/\d{1,3})?)\b/;

/** Collapse HTML to text so table-based layouts can be scanned like prose. */
export function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;?/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Huawei pages carry their data as JS constructor calls, e.g.
 * `new USERDevice("1","192.168.100.7","AA:BB:...","kemi-phone",...)`.
 * This pulls every such call out as an array of its string arguments.
 */
export function jsRecords(html: string): { ctor: string; args: string[] }[] {
  const out: { ctor: string; args: string[] }[] = [];
  const re = /new\s+([A-Za-z_$][\w$]*)\s*\(([^()]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const args = (m[2] ?? '')
      .split(',')
      .map((a) => a.trim().replace(/^["']|["']$/g, ''))
      .filter((a) => a.length > 0 || true);
    if (args.length >= 2) out.push({ ctor: m[1] ?? '', args });
  }
  return out;
}

/**
 * Undo Huawei's hex escaping of string literals.
 *
 * This firmware family writes every value with its punctuation escaped:
 * `"\x2d12\x2e54"` is `-12.54`, `"2C\x3a27\x3a68\x3a17\x3a15\x3aF4"` is a MAC
 * address. Nothing else in this file can match until that is undone, which is
 * why an affected build looks like "the router exposes no data" rather than
 * like a parse bug - every regex here is searching for a decimal point that is
 * not literally present in the page.
 *
 * Note the order this is used in: escapes are decoded *after* a record's
 * arguments have been split, never before. Decoding first would be a bug,
 * because values legitimately contain escaped parentheses and commas
 * (`\x28CLASS\x20B\x2b\x2f...\x29`) that would then be mistaken for argument
 * separators and structure.
 */
export function decodeHwEscapes(s: string): string {
  return s
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

export interface NamedRecord {
  ctor: string;
  args: string[];
  /** Positional arguments mapped onto the constructor's own parameter names. */
  fields: Record<string, string>;
}

/**
 * Read Huawei's data records as named fields rather than a bare list.
 *
 * These pages declare a constructor and then call it positionally:
 *
 *   function stOpticInfo(domain,LinkStatus,transOpticPower,revOpticPower,...)
 *   var opticInfos = new Array(new stOpticInfo("...","ok","2.36","-12.54",...));
 *
 * Taking the signature off the same page and zipping it against the call is
 * what turns fifteen anonymous strings into `revOpticPower`. It also survives
 * the thing that actually breaks between firmware builds: Huawei inserts a
 * column, and every hard-coded index shifts by one while every name still
 * points at the right value.
 *
 * Where a page declares the same constructor twice - older and newer builds
 * shipped side by side, which `opticinfo.asp` does - the definition whose
 * parameter count matches the call is the one that was used to make it.
 */
export function jsRecordsNamed(html: string): NamedRecord[] {
  // Signatures come from unescaped source, so they are read from the raw page.
  const sigs = new Map<string, string[][]>();
  for (const m of html.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/g)) {
    const params = (m[2] ?? '').split(',').map((p) => p.trim()).filter(Boolean);
    if (!params.length) continue;
    const list = sigs.get(m[1]!) ?? [];
    list.push(params);
    sigs.set(m[1]!, list);
  }

  const out: NamedRecord[] = [];
  for (const m of html.matchAll(/new\s+([A-Za-z_$][\w$]*)\s*\(([^()]*)\)/g)) {
    const ctor = m[1]!;
    const args = (m[2] ?? '')
      .split(',')
      .map((a) => decodeHwEscapes(a.trim().replace(/^["']|["']$/g, '')));
    if (args.length < 2) continue;

    const candidates = sigs.get(ctor) ?? [];
    const params = candidates.find((p) => p.length === args.length) ?? candidates[0];

    const fields: Record<string, string> = {};
    if (params) {
      params.forEach((name, i) => {
        const v = args[i];
        if (v !== undefined) fields[name] = v;
      });
    }
    out.push({ ctor, args, fields });
  }
  return out;
}

/** First field named by `names` that parses to a number `accept` allows. */
function numField(
  fields: Record<string, string>,
  names: readonly string[],
  accept: (v: number) => boolean,
): number | null {
  for (const n of names) {
    const raw = fields[n];
    if (raw === undefined) continue;
    const v = Number(raw.trim());
    if (Number.isFinite(v) && accept(v)) return v;
  }
  return null;
}

/**
 * Recombine one of Huawei's split 64-bit counters. They are reported as a low
 * word plus a `_H` high word because the firmware's own templating cannot
 * carry an integer wider than 32 bits. Ignoring the high word works right up
 * until the first 4GB, and then silently reports a month of traffic as a few
 * hundred megabytes.
 */
function wideCounter(lo: string | undefined, hi: string | undefined): number | null {
  const l = Number(lo ?? NaN);
  const h = Number(hi ?? 0);
  if (!Number.isFinite(l) || !Number.isFinite(h)) return null;
  return h * 2 ** 32 + l;
}

/** Extract `<td>` cell text row by row, for builds that render real tables. */
export function tableRows(html: string): string[][] {
  const rows: string[][] = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    const cells = [...(m[1] ?? '').matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) =>
      stripTags(c[1] ?? ''),
    );
    if (cells.length) rows.push(cells);
  }
  return rows;
}

/**
 * Find a number that follows one of `labels`, in either "Label: -19.2" text
 * form or `varName = "-19.2"` JS form. Returns the first value that passes
 * `accept`.
 */
function labelledNumber(
  html: string,
  labels: readonly string[],
  accept: (v: number) => boolean,
): number | null {
  const text = stripTags(html);
  for (const label of labels) {
    const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      // "Rx Optical Power(dBm) : -19.24"
      new RegExp(`${esc}[^\\n\\r]{0,40}?(-?\\d+(?:\\.\\d+)?)`, 'i'),
      // RxPower = "-19.24"  /  "RxPower":"-19.24"
      new RegExp(`${esc}["'\\s]*[:=]\\s*["']?(-?\\d+(?:\\.\\d+)?)`, 'i'),
    ];
    for (const re of patterns) {
      for (const hay of [text, html]) {
        const m = hay.match(re);
        if (!m?.[1]) continue;
        const v = Number(m[1]);
        if (Number.isFinite(v) && accept(v)) return v;
      }
    }
  }
  return null;
}

/**
 * Some builds report optical power scaled by 100 (an integer like -1924 for
 * -19.24 dBm) or by 10. Normalise anything obviously out of dBm range.
 */
function normaliseDbm(v: number | null): number | null {
  if (v === null) return null;
  let x = v;
  if (Math.abs(x) > 100) x = x / 100;
  else if (Math.abs(x) > 40) x = x / 10;
  return Number.isFinite(x) ? Number(x.toFixed(2)) : null;
}

const inRange = (lo: number, hi: number) => (v: number) => v >= lo && v <= hi;

// ---------------------------------------------------------------------------
// Optical
// ---------------------------------------------------------------------------

export function parseOptical(pages: readonly OntPage[], ts = Date.now()): OpticalSample {
  const out: OpticalSample = {
    ts,
    rxPower: null,
    txPower: null,
    biasCurrent: null,
    voltage: null,
    temperature: null,
    ponStatus: null,
  };

  for (const p of pages) {
    if (!p.ok) continue;
    const h = p.body;

    /*
     * Structured pass first. On builds that carry optical data as a positional
     * record there is nothing for the label matcher below to find: the labels
     * live in a separate translation table and the page itself only ever says
     * `revOpticPower`, so a label search for "Rx Optical Power" scans right
     * past the number it is looking for.
     */
    for (const rec of jsRecordsNamed(h)) {
      const f = rec.fields;

      out.rxPower ??= normaliseDbm(
        numField(f, ['revOpticPower', 'RxPower', 'rxPower', 'RxOpticalPower'], (v) => v >= -40 && v <= -1),
      );
      out.txPower ??= normaliseDbm(
        numField(f, ['transOpticPower', 'TxPower', 'txPower', 'TxOpticalPower'], (v) => v >= -10 && v <= 10),
      );
      out.temperature ??= numField(f, ['temperature', 'Temperature'], inRange(-20, 120));
      out.biasCurrent ??= numField(f, ['bias', 'biasCurrent', 'BiasCurrent'], inRange(0, 150));

      // Reported in millivolts on this family (3300), in volts on others.
      const volts = numField(f, ['voltage', 'Voltage'], (v) => (v >= 2 && v <= 5.5) || (v >= 2000 && v <= 5500));
      out.voltage ??= volts === null ? null : Number((volts > 100 ? volts / 1000 : volts).toFixed(2));

      /*
       * The PON state lives in its own tiny record, usually on the device-info
       * page rather than the optical one:
       *   new ONTInfo("InternetGatewayDevice.X_HW_DEBUG.AMP.ONT","0","O5")
       * It is worth reaching for specifically because it is the value that
       * separates an MTN fault from a fault in the house, and because the text
       * fallback below cannot see it - it sits inside a <script>, which
       * `stripTags` removes before the fallback ever runs.
       */
      if (out.ponStatus === null && /ONTInfo$/i.test(rec.ctor)) {
        const s = f['Status']?.trim();
        if (s && /^(?:O[1-7]|online|offline|up|down|operation|normal)$/i.test(s)) out.ponStatus = s;
      }
    }

    out.rxPower ??= normaliseDbm(
      labelledNumber(
        h,
        ['Rx Optical Power', 'RxPower', 'Receive Optical Power', 'Optical Rx', 'RXPower', 'rx_power'],
        // Pre-normalisation range is wide because of the x10 / x100 builds.
        (v) => (v >= -40 && v <= -1) || (v >= -4000 && v <= -100),
      ),
    );

    out.txPower ??= normaliseDbm(
      labelledNumber(
        h,
        ['Tx Optical Power', 'TxPower', 'Transmit Optical Power', 'Optical Tx', 'TXPower', 'tx_power'],
        (v) => (v >= -10 && v <= 10) || (v >= -1000 && v <= 1000),
      ),
    );

    out.temperature ??= labelledNumber(
      h,
      ['Temperature', 'ONT Temperature', 'Optical Module Temperature', 'temperature'],
      inRange(-20, 120),
    );

    out.voltage ??= labelledNumber(
      h,
      ['Voltage', 'Supply Voltage', 'Optical Module Voltage', 'voltage'],
      inRange(2, 5.5),
    );

    out.biasCurrent ??= labelledNumber(
      h,
      ['Bias Current', 'Laser Bias Current', 'BiasCurrent', 'bias_current'],
      inRange(0, 150),
    );

    if (out.ponStatus === null) {
      const text = stripTags(h);
      // O5 is the GPON "operational" state; anything else means the link is
      // not carrying traffic, which is the single most diagnostic value here.
      const m =
        text.match(/PON\s*(?:Link\s*)?Status[^A-Za-z0-9]{0,20}(O\d|[A-Za-z]+)/i) ??
        text.match(/\b(O[1-7])\b/) ??
        h.match(/ponStatus["'\s]*[:=]\s*["']?([\w]+)/i);
      if (m?.[1]) out.ponStatus = m[1];
    }
  }

  return out;
}

/** True when the PON state string means "link up and carrying traffic". */
export function ponIsUp(status: string | null): boolean {
  if (!status) return false;
  const s = status.trim().toLowerCase();
  return s === 'o5' || s === 'online' || s === 'up' || s === 'operation' || s === 'normal';
}

// ---------------------------------------------------------------------------
// WAN
// ---------------------------------------------------------------------------

/** RFC1918, loopback, link-local and multicast. CGNAT (100.64/10) is a real
 *  WAN address on MTN FibreX, so it is deliberately not excluded. */
function isPrivateV4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return true;
  const [a = 0, b = 0] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  if (a >= 224) return true;
  return false;
}

/**
 * Could this address plausibly be the WAN address of a CGNAT'd line?
 *
 * Deliberately more permissive than `isPrivateV4`. MTN FibreX hands the ONT a
 * 10/8 address and does the carrier-grade NAT upstream, so the rule "a WAN
 * address is never RFC1918" - correct nearly everywhere else - would reject
 * the only WAN address this line will ever have.
 *
 * The permissiveness is safe only because this is used on values pulled from a
 * WAN connection record, where the field is known to be the external address.
 * The loose "first public-looking address on the page" fallback still uses
 * `isPrivateV4`, so a LAN address in some unrelated table cannot be mistaken
 * for the WAN IP.
 */
function isPlausibleWanV4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return false;
  const [a = 0, b = 0] = parts;
  if (a === 0 || a === 127 || a >= 224) return false;
  if (a === 255 || b === 255) return false; // a netmask sitting in the next field
  if (a === 169 && b === 254) return false;
  if (a === 192 && b === 168) return false; // this ONT's own LAN
  if (a === 172 && b >= 16 && b <= 31) return false;
  return true;
}

/** Parse "5 day(s) 3 hour(s) 12 min(s)" and friends into seconds. */
export function parseUptime(text: string): number | null {
  const m = text.match(
    /(?:(\d+)\s*day)?\D{0,6}(?:(\d+)\s*hour)?\D{0,6}(?:(\d+)\s*min)?\D{0,6}(?:(\d+)\s*sec)?/i,
  );
  if (!m) return null;
  const [, d, h, mi, s] = m;
  if (!d && !h && !mi && !s) return null;
  return Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(mi ?? 0) * 60 + Number(s ?? 0);
}

export function parseWan(pages: readonly OntPage[], ts = Date.now()): WanSample {
  const out: WanSample = {
    ts,
    up: false,
    ipv4: null,
    ipv6: null,
    connectionUptimeSec: null,
    rxBytes: null,
    txBytes: null,
  };

  for (const p of pages) {
    if (!p.ok) continue;
    const h = p.body;
    const text = stripTags(h);
    const records = jsRecordsNamed(h);

    /*
     * Byte counters, from the GEM port statistics. This is the only place this
     * firmware publishes a WAN-side total: the "WAN statistics" page every
     * other build has returns 404 here, and the LAN port counters next to
     * these count traffic between devices in the house as well, which would
     * inflate the data-usage figure well past what MTN is billing for.
     *
     * IPTV GEM ports are excluded for the same reason - they carry multicast
     * that never touches the internet plan.
     *
     * `tx` and `rx` are named from the ONT's point of view, which is the
     * opposite of the household's: what the ONT transmits upstream is what we
     * uploaded.
     */
    const gems = records.filter(
      (r) => /GEMStats$/i.test(r.ctor) && /ethernet/i.test(r.fields['type'] ?? ''),
    );
    if (gems.length > 0) {
      let down = 0;
      let up = 0;
      let sawAny = false;
      for (const g of gems) {
        const rx = wideCounter(g.fields['rxBytes'], g.fields['rxBytes_H']);
        const tx = wideCounter(g.fields['txBytes'], g.fields['txBytes_H']);
        if (rx !== null) {
          down += rx;
          sawAny = true;
        }
        if (tx !== null) {
          up += tx;
          sawAny = true;
        }
      }
      if (sawAny) {
        out.rxBytes ??= down;
        out.txBytes ??= up;
      }
    }

    /*
     * WAN session state, from the connection record. The record's own
     * constructor is defined in an external .js file rather than on the page,
     * so its arguments cannot be named - but a row that says "Connected" and
     * carries an address is unambiguous enough, and the external address is
     * always the first address in it (the default gateway follows).
     */
    if (out.ipv4 === null || !out.up) {
      for (const rec of records) {
        if (!rec.args.some((a) => /^connected$/i.test(a.trim()))) continue;
        out.up = true;
        if (out.ipv4 !== null) break;
        for (const a of rec.args) {
          const ip = a.trim().match(/^((?:\d{1,3}\.){3}\d{1,3})$/)?.[1];
          if (ip && isPlausibleWanV4(ip)) {
            out.ipv4 = ip;
            break;
          }
        }
        if (out.ipv4 !== null) break;
      }
    }

    if (out.ipv4 === null) {
      // Prefer an address that sits next to a WAN-ish label; fall back to the
      // first non-private address anywhere on the page.
      const labelled = text.match(
        /(?:WAN\s*IP|IP\s*Address|IPv4\s*Address|External\s*IP)[^0-9]{0,20}((?:\d{1,3}\.){3}\d{1,3})/i,
      );
      const candidate = labelled?.[1];
      if (candidate && !isPrivateV4(candidate)) out.ipv4 = candidate;
      else {
        for (const m of text.matchAll(IPV4_RE_G)) {
          const ip = m[1]!;
          if (!isPrivateV4(ip)) {
            out.ipv4 = ip;
            break;
          }
        }
      }
    }

    if (out.ipv6 === null) {
      const m = text.match(
        new RegExp(`(?:IPv6\\s*(?:Address|Prefix))[^0-9a-fA-F:]{0,20}(${IPV6_RE.source.slice(2, -2)})`, 'i'),
      );
      if (m?.[1] && m[1].includes(':')) out.ipv6 = m[1];
    }

    if (out.connectionUptimeSec === null) {
      const m = text.match(/(?:Online\s*Duration|Connection\s*Time|Running\s*Time|Up\s*Time|Uptime)[^0-9]{0,20}([^|<]{0,60})/i);
      if (m?.[1]) {
        const secs = /^\s*\d+\s*$/.test(m[1]) ? Number(m[1].trim()) : parseUptime(m[1]);
        if (secs !== null && secs >= 0 && secs < 3650 * 86400) out.connectionUptimeSec = secs;
      }
    }

    out.rxBytes ??= bigCounter(text, [
      'Bytes Received',
      'Received Bytes',
      'Receive Bytes',
      'BytesReceived',
      'RxBytes',
      'Downstream Bytes',
    ]);
    out.txBytes ??= bigCounter(text, [
      'Bytes Sent',
      'Sent Bytes',
      'Send Bytes',
      'BytesSent',
      'TxBytes',
      'Upstream Bytes',
    ]);

    if (!out.up) {
      out.up =
        /\bConnected\b/i.test(text) && !/\bDisconnected\b/i.test(text)
          ? true
          : /(?:Connection\s*Status|WAN\s*Status)[^A-Za-z]{0,10}(?:Connected|Up|Online)/i.test(text);
    }
  }

  // A public address is itself strong evidence the session is up, whatever the
  // status string said.
  if (out.ipv4) out.up = true;
  return out;
}

function bigCounter(text: string, labels: readonly string[]): number | null {
  for (const label of labels) {
    const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = text.match(new RegExp(`${esc}[^0-9]{0,20}(\\d{1,20})`, 'i'));
    if (m?.[1]) {
      const v = Number(m[1]);
      if (Number.isFinite(v) && v >= 0) return v;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Attached devices
// ---------------------------------------------------------------------------

export interface DeviceSighting {
  mac: string;
  ip: string | null;
  hostname: string | null;
  connection: string;
  rssi: number | null;
}

const HOSTNAME_OK = /^[A-Za-z0-9][A-Za-z0-9._-]{1,62}$/;
const NOT_HOSTNAME = /^(?:0|1|true|false|null|none|unknown|n\/a|-{1,3}|ethernet|wireless|lan\d?|ssid\d?)$/i;

/**
 * Pull attached-device rows out of whatever form this firmware uses. Both the
 * JS-constructor and the HTML-table layouts are handled, and results are
 * merged by MAC so a device listed on two pages gains detail rather than
 * appearing twice.
 */
export function parseDevices(pages: readonly OntPage[]): DeviceSighting[] {
  const byMac = new Map<string, DeviceSighting>();

  const merge = (s: DeviceSighting): void => {
    const mac = s.mac.replace(/-/g, ':').toUpperCase();
    const prev = byMac.get(mac);
    if (!prev) {
      byMac.set(mac, { ...s, mac });
      return;
    }
    byMac.set(mac, {
      mac,
      ip: prev.ip ?? s.ip,
      hostname: prev.hostname ?? s.hostname,
      connection: prev.connection !== 'unknown' ? prev.connection : s.connection,
      rssi: prev.rssi ?? s.rssi,
    });
  };

  for (const p of pages) {
    if (!p.ok) continue;

    /*
     * Layout A0: named constructor records.
     *
     * Worth doing before the positional guesswork below because guessing gets
     * this particular firmware wrong in a specific, damaging way: a row
     * contains both a lease time and a hostname-shaped device type string, so
     * "the first argument that looks like a hostname" picks `MSFT 5.0` for
     * half the house. Reading `HostName` by name gets `DESKTOP-JCT7IDU`.
     *
     * `merge` keeps whatever was recorded first, so naming these here also
     * stops the looser passes from overwriting them.
     *
     * (`USERDeviceNew` additionally carries `RealMacAddr`, the hardware MAC
     * behind a randomised one. Not used yet: presence is keyed on the MAC the
     * device actually presents, and switching identity to the real MAC would
     * silently merge history that was deliberately recorded separately.)
     */
    for (const rec of jsRecordsNamed(p.body)) {
      const f = rec.fields;
      const rawMac = f['MacAddr'] ?? f['mac'];
      const mac = rawMac?.match(MAC_RE)?.[1];
      if (!mac) continue;

      const ip = (f['IpAddr'] ?? f['ip'])?.match(IPV4_RE)?.[1] ?? null;
      const host = (f['HostName'] ?? f['name'])?.trim();
      const hint = [f['Port'], f['PortType'], f['interfacetype'], f['DevType']].filter(Boolean).join(' ');

      merge({
        mac,
        ip,
        hostname: host && HOSTNAME_OK.test(host) && !NOT_HOSTNAME.test(host) ? host : null,
        connection: connectionFrom(hint || rec.args.join(' ')),
        rssi: rssiFrom(rec.args.join(' ')),
      });
    }

    // Layout A: JS constructor arguments.
    for (const rec of jsRecords(p.body)) {
      const mac = rec.args.find((a) => MAC_RE.test(a));
      if (!mac) continue;
      const ip = rec.args.find((a) => IPV4_RE.test(a) && !isPrivateV4Loose(a)) ?? rec.args.find((a) => IPV4_RE.test(a));
      const hostname = rec.args.find(
        (a) => HOSTNAME_OK.test(a) && !NOT_HOSTNAME.test(a) && !MAC_RE.test(a) && !IPV4_RE.test(a),
      );
      merge({
        mac: mac.match(MAC_RE)![1]!,
        ip: ip?.match(IPV4_RE)?.[1] ?? null,
        hostname: hostname ?? null,
        connection: connectionFrom(rec.args.join(' ')),
        rssi: rssiFrom(rec.args.join(' ')),
      });
    }

    // Layout B: real HTML tables.
    for (const cells of tableRows(p.body)) {
      const joined = cells.join(' ');
      const macMatch = joined.match(MAC_RE);
      if (!macMatch) continue;
      const ipCell = cells.find((c) => IPV4_RE.test(c));
      const hostCell = cells.find(
        (c) => HOSTNAME_OK.test(c.trim()) && !NOT_HOSTNAME.test(c.trim()) && !MAC_RE.test(c) && !IPV4_RE.test(c),
      );
      merge({
        mac: macMatch[1]!,
        ip: ipCell?.match(IPV4_RE)?.[1] ?? null,
        hostname: hostCell?.trim() ?? null,
        connection: connectionFrom(joined),
        rssi: rssiFrom(joined),
      });
    }

    // Layout C: last resort. A page that mentions MACs in no structure we
    // recognise still tells us those devices exist.
    if (byMac.size === 0) {
      for (const m of p.body.matchAll(MAC_RE_G)) {
        merge({ mac: m[1]!, ip: null, hostname: null, connection: 'unknown', rssi: null });
      }
    }
  }

  // The ONT lists its own LAN interface; that is not a household device.
  return [...byMac.values()].filter((d) => !/^(?:00:00:00:00:00:00|FF:FF:FF:FF:FF:FF)$/i.test(d.mac));
}

function isPrivateV4Loose(s: string): boolean {
  const m = s.match(IPV4_RE);
  return m?.[1] ? isPrivateV4(m[1]) : true;
}

function connectionFrom(s: string): string {
  // SSID indices are checked before the generic wireless test: this firmware
  // names the radio only as `SSID1` / `SSID5`, so without them every Wi-Fi
  // device in the house is reported as 2.4GHz.
  if (/5\s*G(?:Hz)?\b|5G_?SSID|wlan1|SSID[5-8]\b/i.test(s)) return '5G';
  if (/2\.4\s*G(?:Hz)?\b|2\.4G_?SSID|wlan0|SSID[1-4]\b/i.test(s)) return '2.4G';
  if (/ethernet|lan\s*[1-4]\b|wired|\bETH\b/i.test(s)) return 'ethernet';
  if (/wireless|wifi|wlan|802\.11/i.test(s)) return '2.4G';
  return 'unknown';
}

function rssiFrom(s: string): number | null {
  const m = s.match(/(-\d{2,3})\s*dBm/i);
  if (!m?.[1]) return null;
  const v = Number(m[1]);
  return v >= -100 && v <= -10 ? v : null;
}

// ---------------------------------------------------------------------------
// Device info
// ---------------------------------------------------------------------------

export interface OntInfo {
  model: string | null;
  serial: string | null;
  firmware: string | null;
  uptimeSec: number | null;
}

/**
 * Read `var dev_uptime = '11946';` and friends straight out of the page source.
 *
 * This deliberately bypasses `stripTags`, which throws `<script>` bodies away -
 * and on this firmware the system uptime exists *only* inside a script, as a
 * seconds count that the page then ticks up in the browser with setInterval.
 * Matching the rendered text finds nothing at all, which is why the uptime
 * looked unavailable on a build that publishes it perfectly plainly.
 *
 * Names are tried most-specific first, and a bare assignment carrying no digits
 * (`dev_uptime = ''`, which this same page also emits further down) simply
 * fails to match, so the search moves on rather than reading a zero.
 */
function jsVarSeconds(html: string, names: readonly string[]): number | null {
  for (const name of names) {
    const m = html.match(new RegExp('(?:^|[^A-Za-z0-9_])' + name + ' *= *[^0-9]{0,2}([0-9]{1,10})', 'i'));
    if (!m?.[1]) continue;
    const v = Number(m[1]);
    // Ten years is not an uptime; it is a counter that means something else.
    if (Number.isFinite(v) && v > 0 && v < 3650 * 86400) return v;
  }
  return null;
}

export function parseOntInfo(pages: readonly OntPage[]): OntInfo {
  const info: OntInfo = { model: null, serial: null, firmware: null, uptimeSec: null };
  for (const p of pages) {
    if (!p.ok) continue;

    // Named record first: on this family the visible page is built from a
    // translation table at render time, so the labels the text matcher wants
    // ("Software Version") are never in the HTML that was served.
    for (const rec of jsRecordsNamed(p.body)) {
      const f = rec.fields;
      if (!f['ModelName'] && !f['SoftwareVersion']) continue;
      info.model ??= f['ModelName']?.trim() || null;
      info.firmware ??= f['SoftwareVersion']?.trim() || null;
      info.serial ??= f['SerialNumber']?.trim() || null;
    }

    const text = stripTags(p.body);
    info.model ??= text.match(/(?:Device\s*Type|Product\s*Model|Model)[^A-Za-z0-9]{0,10}([A-Za-z0-9-]{4,32})/i)?.[1] ?? null;
    info.serial ??= text.match(/(?:Serial\s*Number|SN)[^A-Za-z0-9]{0,10}([A-Za-z0-9]{8,32})/i)?.[1] ?? null;
    info.firmware ??=
      text.match(/(?:Software\s*Version|Firmware\s*Version)[^A-Za-z0-9]{0,10}([A-Za-z0-9._-]{3,40})/i)?.[1] ?? null;
    // Uptime is what dates the last reboot, and a reboot is how a power cut
    // that nobody was awake to watch gets found afterwards. Worth two tries.
    info.uptimeSec ??= jsVarSeconds(p.body, ['dev_uptime', 'sys_uptime', 'SysUpTime', 'RunningTime']);
    if (info.uptimeSec === null) {
      const m = text.match(/(?:Running\s*Time|System\s*Up\s*Time|Uptime)[^0-9]{0,20}([^|<]{0,60})/i);
      if (m?.[1]) info.uptimeSec = parseUptime(m[1]);
    }
  }
  return info;
}

// ---------------------------------------------------------------------------
// Discovery support
// ---------------------------------------------------------------------------

/** Which extractors found something usable on this page. Drives `--discover`. */
export function detectKinds(page: OntPage): string[] {
  if (!page.ok) return [];
  const kinds: string[] = [];
  const o = parseOptical([page]);
  if (o.rxPower !== null || o.txPower !== null) kinds.push('optical');
  if (o.ponStatus !== null) kinds.push('pon');
  const w = parseWan([page]);
  if (w.ipv4 !== null) kinds.push('wan_ip');
  if (w.rxBytes !== null || w.txBytes !== null) kinds.push('counters');
  if (parseDevices([page]).length > 0) kinds.push('devices');
  const i = parseOntInfo([page]);
  if (i.serial || i.firmware) kinds.push('info');
  if (i.uptimeSec !== null) kinds.push('uptime');
  return kinds;
}
