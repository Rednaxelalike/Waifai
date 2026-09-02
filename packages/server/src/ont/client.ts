import { config } from '../config.ts';
import { logger } from '../log.ts';

const log = logger('ont');

/**
 * HTTP client for the Huawei EchoLife HG8145V5 web UI.
 *
 * No headless browser. The ONT serves plain `.asp` pages with the data baked
 * into JS literals and table cells, and its login is an ordinary form POST, so
 * a browser buys nothing but ~400MB of Chromium and a 300MB RAM spike on every
 * poll. That matters when the host is a Raspberry Pi.
 *
 * Two things about this firmware family shape the whole design:
 *
 *  1. It allows a single concurrent web session. If we do not log out, the
 *     household is locked out of the router UI until the session times out.
 *     Every poll is therefore login -> fetch everything -> logout.
 *  2. Login details vary between firmware builds. Rather than pinning one
 *     flow, `login()` tries each known variant until one sticks, then
 *     remembers which worked.
 */

export interface OntPage {
  path: string;
  status: number;
  body: string;
  ok: boolean;
}

type LoginVariant = 'token' | 'plain' | 'form';

export class OntError extends Error {
  readonly detail: unknown;

  constructor(message: string, detail?: unknown) {
    super(message);
    this.name = 'OntError';
    this.detail = detail;
  }
}

export class OntClient {
  private cookies = new Map<string, string>();
  private loggedIn = false;
  private variant: LoginVariant | null = null;
  private csrfToken: string | null = null;
  /** Serialises everything: the ONT cannot cope with concurrent sessions. */
  private queue: Promise<unknown> = Promise.resolve();

  private readonly baseUrl: string;
  private readonly user: string;
  private readonly pass: string;

  constructor(
    baseUrl: string = config.ont.baseUrl,
    user: string = config.ont.adminUser || config.ont.user,
    pass: string = config.ont.adminPass || config.ont.pass,
  ) {
    this.baseUrl = baseUrl;
    this.user = user;
    this.pass = pass;
  }

  /**
   * Runs `fn` inside an exclusive ONT session. Callers never manage login or
   * logout themselves, which is what keeps the single-session rule honoured
   * even when the scheduler fires two jobs at once.
   */
  session<T>(fn: (c: OntClient) => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      await this.login();
      try {
        return await fn(this);
      } finally {
        if (config.ont.logoutAfterPoll) await this.logout().catch(() => {});
      }
    });
    // Keep the chain alive even when this run rejects.
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  // -- transport -----------------------------------------------------------

  private cookieHeader(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  private absorbCookies(res: Response): void {
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const first = raw.split(';', 1)[0] ?? '';
      const eq = first.indexOf('=');
      if (eq <= 0) continue;
      this.cookies.set(first.slice(0, eq).trim(), first.slice(eq + 1).trim());
    }
  }

  private async request(
    path: string,
    init: { method?: string; body?: string; extraCookie?: string } = {},
  ): Promise<{ status: number; body: string }> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
    const cookie = [init.extraCookie, this.cookieHeader()].filter(Boolean).join('; ');
    const headers: Record<string, string> = {
      // The firmware sniffs the UA on some builds and serves a stripped page
      // to anything it does not recognise.
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: `${this.baseUrl}/`,
    };
    if (cookie) headers['Cookie'] = cookie;
    if (init.body !== undefined) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      headers['Origin'] = this.baseUrl;
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
        headers,
        body: init.body,
        redirect: 'manual',
        signal: AbortSignal.timeout(config.ont.timeoutMs),
      });
    } catch (err) {
      throw new OntError(`request to ${path} failed`, err);
    }
    this.absorbCookies(res);
    const body = await res.text().catch(() => '');
    return { status: res.status, body };
  }

  // -- auth ----------------------------------------------------------------

  /**
   * Fetches the login page and pulls out whichever anti-CSRF token this build
   * uses. Different firmware puts it in `/asp/GetRandCount.asp`, in a hidden
   * input, or in a bare JS variable, so all three are tried.
   */
  private async fetchToken(): Promise<string | null> {
    try {
      const rand = await this.request('/asp/GetRandCount.asp');
      // The response is the token, sometimes with a BOM or stray control bytes.
      const cleaned = rand.body.replace(/[^\w+/=-]/g, '').trim();
      if (rand.status === 200 && cleaned.length >= 8) return cleaned;
    } catch {
      /* fall through to scraping the login page */
    }
    try {
      const page = await this.request('/');
      const patterns = [
        /id=["']?(?:Frm_Logintoken|hardcodeOfCsrfvalue|csrf_param)["']?[^>]*value=["']([^"']+)["']/i,
        /name=["']?x\.X_HW_Token["']?[^>]*value=["']([^"']+)["']/i,
        /(?:Cookie_TokenValue|csrf_token|g_requestToken)\s*=\s*["']([^"']+)["']/i,
      ];
      for (const re of patterns) {
        const m = page.body.match(re);
        if (m?.[1]) return m[1];
      }
    } catch {
      /* no token available; the plain variant may still work */
    }
    return null;
  }

  async login(): Promise<void> {
    if (this.loggedIn) return;
    if (!this.pass) throw new OntError('no ONT password configured (set ONT_PASS)');

    const token = await this.fetchToken();
    const encoded = Buffer.from(this.pass, 'utf8').toString('base64');
    const order: LoginVariant[] = this.variant ? [this.variant] : ['token', 'plain', 'form'];

    let lastStatus = 0;
    for (const variant of order) {
      const params = new URLSearchParams();
      params.set('UserName', this.user);
      // Huawei expects base64 for the two token flows and cleartext for the
      // older form post. Guessing wrong just fails the attempt harmlessly.
      params.set('PassWord', variant === 'form' ? this.pass : encoded);
      params.set('Language', 'english');
      if (variant === 'token' && token) params.set('x.X_HW_Token', token);
      if (variant === 'form') params.set('Submit', 'Login');

      const res = await this.request('/login.cgi', {
        method: 'POST',
        body: params.toString(),
        // This sentinel cookie is what the stock login page sends; some builds
        // reject the POST without it.
        extraCookie: 'Cookie=body:Language:english:id=-1',
      });
      lastStatus = res.status;

      if (await this.verifySession()) {
        this.loggedIn = true;
        this.variant = variant;
        this.csrfToken = token;
        log.debug(`logged in as ${this.user} using the "${variant}" flow`);
        return;
      }
      // A failed attempt can leave a half-set session cookie behind.
      this.cookies.delete('SessionID');
    }

    throw new OntError(
      `login failed for user "${this.user}" (last HTTP ${lastStatus}). ` +
        'Check ONT_PASS, and note that the ONT locks out for a few minutes after ' +
        'repeated bad passwords. If root works but pages are empty, set ' +
        'ONT_ADMIN_USER=telecomadmin.',
    );
  }

  /**
   * Confirms the session is real by fetching a page that only authenticated
   * users get. A 200 that still contains the login form means we are out.
   */
  private async verifySession(): Promise<boolean> {
    const probe = await this.request('/html/ssmp/deviceinfo/deviceinfo.asp').catch(() => null);
    if (!probe) return false;
    if (probe.status === 302 || probe.status === 401 || probe.status === 403) return false;
    const looksLikeLogin = /name=["']?(?:UserName|PassWord)["']?/i.test(probe.body) &&
      !/DeviceInfo|Device Information|SerialNumber/i.test(probe.body);
    return probe.status === 200 && !looksLikeLogin && probe.body.length > 200;
  }

  async logout(): Promise<void> {
    if (!this.loggedIn) return;
    // Different builds expose different logout endpoints; try them in order
    // and stop at the first that is not a 404.
    for (const path of ['/logout.cgi', '/logout.cgi?RequestFile=html/logout.html', '/html/logout.html']) {
      const res = await this.request(path).catch(() => null);
      if (res && res.status !== 404) break;
    }
    this.cookies.clear();
    this.loggedIn = false;
  }

  // -- fetching ------------------------------------------------------------

  /** Fetch one page. Never throws for HTTP errors; inspect `ok` instead. */
  async page(path: string): Promise<OntPage> {
    const res = await this.request(path);
    const ok = res.status === 200 && res.body.length > 0;
    return { path, status: res.status, body: res.body, ok };
  }

  /** Fetch several pages in sequence. The ONT chokes on parallel requests. */
  async pages(paths: readonly string[]): Promise<OntPage[]> {
    const out: OntPage[] = [];
    for (const p of paths) {
      try {
        out.push(await this.page(p));
      } catch (err) {
        log.debug(`page ${p} errored`, err);
        out.push({ path: p, status: 0, body: '', ok: false });
      }
    }
    return out;
  }

  /**
   * Reboots the ONT. Exposed because a reboot fixes a surprising share of WAN
   * session faults, but it drops everyone for ~90 seconds, so the API gates
   * this behind an explicit confirmation.
   */
  async reboot(): Promise<boolean> {
    const params = new URLSearchParams();
    if (this.csrfToken) params.set('x.X_HW_Token', this.csrfToken);
    const targets = [
      '/html/ssmp/reset/set.cgi?x=InternetGatewayDevice.X_HW_DEBUG.SMP.DEVM.ResetBoard&RequestFile=html/ssmp/reset/reset.asp',
      '/html/ssmp/reset/reset.cgi',
    ];
    for (const t of targets) {
      const res = await this.request(t, { method: 'POST', body: params.toString() }).catch(() => null);
      if (res && res.status < 400) {
        this.loggedIn = false;
        this.cookies.clear();
        return true;
      }
    }
    return false;
  }

  /** True when the ONT answers at all, regardless of credentials. */
  async reachable(): Promise<boolean> {
    try {
      const res = await fetch(this.baseUrl, {
        redirect: 'manual',
        signal: AbortSignal.timeout(Math.min(5000, config.ont.timeoutMs)),
      });
      return res.status > 0;
    } catch {
      return false;
    }
  }
}

/**
 * Candidate page paths across HG8145V5 firmware builds. Discovery probes all
 * of them once, records which answered, and polling then uses only those.
 * Parsers are content-driven rather than path-driven, so an unfamiliar build
 * that puts optical data somewhere new still works as long as the page is in
 * this list.
 */
export const CANDIDATE_PAGES: readonly string[] = [
  // Optical / PON
  '/html/amp/ponstatus/ponstatus.asp',
  '/html/amp/opticinfo/opticinfo.asp',
  '/html/ssmp/opticinfo/opticinfo.asp',
  '/html/amp/ponmgmt/ponmgmt.asp',
  '/html/network/pon.asp',
  // Device / system info
  '/html/ssmp/deviceinfo/deviceinfo.asp',
  '/html/ssmp/deviceinfo/deviceinfo_lua.asp',
  '/html/status/deviceinfo.asp',
  // WAN
  '/html/amp/wanstatus/wanstatus.asp',
  '/html/bbsp/wan/wan.asp',
  '/html/status/waninfo.asp',
  '/html/amp/wanstatistic/wanstatistic.asp',
  '/html/ssmp/wanstatistic/wanstatistic.asp',
  // Attached devices / DHCP
  '/html/ssmp/accessdev/accessdev.asp',
  '/html/bbsp/dhcpinfo/dhcpinfo.asp',
  '/html/bbsp/lancfg/lancfg.asp',
  '/html/status/lanuserinfo.asp',
  '/html/amp/userdevinfo/userdevinfo.asp',
  // WLAN
  '/html/amp/wlanstatus/wlanstatus.asp',
  '/html/bbsp/wlanbasic/wlanbasic.asp',
  '/html/ssmp/wlanuser/wlanuser.asp',
  '/html/status/wlanuserinfo.asp',

  /*
   * V5R022C10S590 (the build MTN is currently shipping) serves almost none of
   * the paths above. These are the ones it does serve, read out of the
   * router's own menu index at /asp/getMenuArray.asp rather than guessed.
   *
   * Several are the small XHR endpoints the router's UI calls to refresh
   * itself. They are preferred over the full pages where both exist: the
   * device list is 11KB here against a 42KB rendered page, which matters when
   * every poll holds the ONT's only web session open while it fetches.
   */
  '/html/bbsp/common/GetLanUserDevInfo.asp', // attached devices, with online state
  '/html/bbsp/common/GetLanUserDhcpInfo.asp', // DHCP leases, for names the list above lacks
  '/html/bbsp/common/getwanlist.asp', // WAN session: status and external address
  '/html/amp/ethinfo/ethinfo.asp', // GEM port counters - the only WAN byte totals here
  '/html/bbsp/waninfo/waninfo.asp',
  '/html/bbsp/userdevinfo/userdevinfo1.asp',
];
