# Waifai

Self-hosted monitoring for an MTN FibreX line behind a Huawei EchoLife HG8145V5 ONT,
delivered as an installable PWA.

It answers four questions the router's own web UI cannot:

1. **Is it down, and whose fault is it?** Every outage is classified — fibre fault,
   router fault, or your own power cut — rather than lumped together as "no internet".
2. **Is the line getting worse?** Optical receive power is tracked over months, and
   the alert fires on the *slope*, not the level. A connector fails long before the
   number crosses any threshold.
3. **Was there Wi-Fi at all, and was that the light or the battery pack?**
   Mains cuts are separated from the stretches the battery carried, and from
   the stretches the Wi-Fi was simply off - reconstructed from the router's own
   uptime counter even for cuts that took the monitor down too.
4. **Who and what is on the network?** Device presence, per-person grouping, and an
   alert when something unrecognised joins.

The output that matters most is `/api/uptime.csv`: a dated, classified list of every
outage, measured from inside your own LAN. That is the artefact you attach to a
support ticket.

---

## Requirements

- **Node.js 22.5 or newer.** SQLite is used through the built-in `node:sqlite`
  module, so there is nothing to compile — which is the whole reason this runs on a
  Pi without a toolchain.
- A host that is always on and on the same LAN as the ONT: a Raspberry Pi, an old
  laptop, anything.
- `ping` and, on Linux, `ip` — both present by default.

There is no Python, no headless browser, and no native module anywhere in the tree.

---

## Setup

```bash
npm install
cp .env.example .env
```

Put the ONT web password in `.env` as `ONT_PASS`, then confirm the credentials work
and find out what this particular firmware exposes:

```bash
npm run discover
```

This prints every candidate page, which ones answered, and what was readable from
each. You want `optical`, `pon` and `devices` in that list.

**If no optical data is found**, set `ONT_ADMIN_USER=telecomadmin` and
`ONT_ADMIN_PASS=admintelecom` in `.env` and run it again. The `root` account is
deliberately restricted on this firmware family and frequently cannot see the
optical page at all.

**If that still fails**, dump the raw pages and look for yourself:

```bash
npm run discover -- --dump
```

Then grep `page_dumps/` for the Rx power value you can see in the router's own web
UI, and add its label to the list in `packages/server/src/ont/parse.ts`. The parsers
match on labels, not on file paths, so one added string usually fixes a whole
firmware revision.

Then run a single pass of everything and read the output:

```bash
npm run probe
```

Finally, build and start:

```bash
npm run build
npm start
```

The server prints every address it can be reached at. Open one of them to read the
dashboard — but to *install* it on a phone, see "Putting it on a phone" below.

### Development

```bash
npm run dev:server   # collector + API, restarts on change
npm run dev:web      # Vite on :5173, proxying /api to the server
npm test             # parser and analysis tests
```

The server runs its TypeScript sources directly via Node's built-in type stripping,
so there is no build step in the dev loop.

---

## Running it permanently

**Docker** (simplest):

```bash
docker compose up -d
```

Note that `network_mode: host` is required rather than convenient — see the comment
in `docker-compose.yml`. Presence detection reads the host ARP table, which is
meaningless from inside a bridge network.

**systemd** (lighter on a Pi): see `deploy/waifai.service`.

### Putting it on a phone

Reading it over `http://<host-ip>:8477` works. **Installing** it does not, and the
reason is not this app:

> A browser only registers a service worker on a *secure origin*, and loopback is the
> only address it exempts. `http://192.168.100.7:8477` is not a secure origin however
> local it is.

So on plain http the desktop at `127.0.0.1` gets the whole PWA, and every phone on
the same LAN gets a web page that Chrome will only add to the home screen as a
browser shortcut — no standalone window, and nothing cached, which is exactly the
state you do not want it in during an outage. The server warns about this at boot.

MTN FibreX also puts you behind CGNAT, so port forwarding is not available and there
is no public name to get a certificate for. [Tailscale](https://tailscale.com) solves
both problems at once, which is why it is the recommended setup rather than one of
two options:

```bash
tailscale up
tailscale serve --bg 8477
tailscale serve status      # prints the https://<host>.<tailnet>.ts.net URL
```

That needs HTTPS certificates enabled for your tailnet (admin console → DNS → HTTPS
Certificates). Tailscale terminates TLS with a real, publicly trusted certificate and
proxies to the server on `127.0.0.1:8477`, so nothing here needs configuring — leave
`TLS_CERT_FILE` and `TLS_KEY_FILE` empty.

Then install Tailscale on each phone, sign in to the same tailnet, and open that
`https://…ts.net` URL. Chrome offers **Install app**; iOS uses Share → Add to Home
Screen. The icon opens standalone, offline caching works, and it keeps working away
from the house — the tailnet *is* the authentication boundary, which is why
`ACCESS_CODE` is empty by default. Set it only if you expose the port more widely.

If you would rather not run Tailscale, point `TLS_CERT_FILE` and `TLS_KEY_FILE` at a
certificate for the host and the server speaks https directly. It has to be a
certificate the phone trusts — a self-signed one will not do, because a certificate
error blocks service worker registration just as plain http does, so the local CA has
to be installed on every phone as well.

---

## Phone notifications

A PWA cannot reliably wake a phone whose browser is closed, so alerts go out through
[ntfy](https://ntfy.sh) instead of a second native codebase:

1. Install the ntfy app on each phone.
2. Subscribe to an unguessable topic name — anyone who knows it can read your alerts.
3. Set `NTFY_URL=https://ntfy.sh/your-unguessable-topic` in `.env`.

Telegram and a generic webhook are supported too. Everything is off unless configured.

Alerts fire on: outage start and recovery, the light going off and coming back, the
battery pack still holding after twenty minutes and then running flat, weak or
drifting optical power, an unrecognised device joining, sustained speed below half
your plan, and crossing your data cap.

---

## What it collects, and how often

| Source | Interval | Yields |
| --- | --- | --- |
| ONT web UI | 60s | Rx/Tx optical power, PON state, temperature, WAN IP and byte counters, attached devices |
| ICMP + DNS sweep | 20s | Up/down, latency, jitter, loss, split by hop distance |
| ARP sweep | 120s | Which devices are actually present, including the mains-only ones used as power witnesses |
| Speed test | 3h | Throughput against your plan |

Raw samples are kept for two weeks and rolled up hourly for two years. The database
is a single SQLite file; back it up by copying it.

### Why the hop tiers matter

Probes are grouped by distance — router, gateway, Nigeria, wider internet — because
that is what turns "the internet is broken" into a diagnosis. If the router answers
instantly but nothing beyond it does, the fault is upstream and it is MTN's. If the
router itself is slow to answer, the problem is inside the house, and it is almost
always Wi-Fi congestion rather than the line.

---

## Is the Wi-Fi on, and is that the light or the battery?

The **Power** tab answers a different question from the uptime report. That one
is about whose fault an outage was, and it counts a working router behind a
dead fibre as an outage. This one only asks whether the router had power at
all, and treats a fibre fault as a fine evening: the Wi-Fi was up, phones
talked to each other, whatever was already buffered kept playing.

Three signals feed it, and none of them is a wall socket:

1. **Does the router answer?** If it does not, there is no Wi-Fi, whatever the
   reason. This is the only direct observation in the whole feature.
2. **The router's own uptime counter.** It says how long the router has been
   powered, so even after hours of nobody watching, the monitor can come back
   and prove whether the router stayed up through them or restarted. This is
   what makes an unwatched power cut recoverable at all.
3. **Mains-only devices.** Mark an always-on device that has no battery of its
   own — a desktop, a TV, a printer — as a *power witness* on the Devices tab.
   Every witness dropping off the network at once while the router still
   answers is what a mains cut looks like from inside the LAN.

Each stretch is recorded as `mains`, `battery`, `off` or `unknown`, and carries
the sentence that justified it. `/api/power.csv` exports the lot.

### The one setting that decides how much can be known

`POWER_MONITOR_ON_BATTERY` says whether the machine running this monitor is on
the same battery pack as the router.

Left at `0` — the monitor is on the wall socket — the monitor is its own
witness: while it is running, the light is on. The cost is that it dies at the
same instant the light does. Every cut is then reconstructed on the next boot
from the router's uptime, which still separates the two cases that matter:

- *The router never restarted.* The pack carried the Wi-Fi through the whole
  cut, and the log says so with the exact times.
- *The router restarted at 21:04.* Then it had no power at some point, and the
  pack gave out somewhere in the middle. That stretch is recorded as `unknown`,
  because the minute the Wi-Fi actually died was not observed and picking one
  would be a guess wearing a timestamp.

Set it to `1` after moving the monitor onto the same pack as the router — a Pi
Zero or an old phone draws less than the router does — and every transition is
watched live instead. That is the one change that removes the blind spot.

### What the battery figure means

"Pack lasts" only counts holds that ended with the router going dark, because
those are the only ones that measured the pack rather than the length of the
power cut. Until one does, the page shows the longest hold so far and says it
has not been measured. The smallest measured runtime is used rather than the
average: a number you plan an evening around should be one the pack has never
failed to reach.

### Alerts

Going onto the pack, still being on the pack after `POWER_BATTERY_WARN_MIN`,
the pack running flat, and the light coming back. The router simply going dark
is deliberately silent, because that already fires as an outage alert and two
buzzes for one event is how people learn to swipe both away.

---

## Things worth knowing

**Your ONT allows one web session at a time.** Every poll logs in, reads everything
it needs, and logs out again. Without that, the household would find itself locked
out of the router UI. It also means polls are serialised: two collectors never talk
to the ONT at once.

**Per-device bandwidth is not available.** The HG8145V5 exposes total WAN counters,
not per-client ones, so the traffic chart is whole-household. Splitting it by device
would mean putting the Pi inline as the router — a much larger change, and one that
makes the Pi a single point of failure for the whole house. Presence and per-person
device grouping are what this gives you instead.

**Randomised MAC addresses are handled.** iOS and Android rotate a private Wi-Fi
address per network, so the same phone reappears as a new device after a Wi-Fi reset.
Those are recorded but deliberately not alerted on — an alert that cries wolf every
few weeks gets muted, and then it is not there when a real stranger joins.

**Time when the monitor was off is excluded from uptime**, not counted as downtime.
Blaming MTN for your own power cut would make the report useless as evidence, which
is the only thing it is for. Those windows appear in the incident log as
`collector_down`.

**A speed test during a Netflix session measures leftover capacity**, not the line.
Tests are skipped automatically when the line is already busy or already down.

**Baseline your optical power now.** Write down today's Rx figure. A steady −19 dBm
is healthy; −19 sliding to −24 over a few months means a connector or splice is
going, and that trend is the thing MTN cannot argue with.

---

## Layout

```
packages/shared    Types shared by server and PWA
packages/server    Collectors, SQLite storage, analysis, REST + WebSocket API
packages/web       React PWA (uPlot for charts, no router or state library)
deploy/            systemd unit
```

The server serves the built PWA itself, so production is one process on one port.
