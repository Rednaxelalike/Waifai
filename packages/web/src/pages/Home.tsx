import { useState } from 'react';
import {
  formatBytes,
  formatDuration,
  type Device,
  type PowerSummary,
  type ProbeSample,
  type StatusSnapshot,
  type ThroughputPoint,
  type UsageSummary,
} from '@waifai/shared';
import {
  Async,
  Card,
  Delta,
  Figure,
  FigureRow,
  KeyFigure,
  List,
  ListRow,
  Meter,
  SeeAll,
  Stat,
  StatGrid,
  ago,
  localTime,
  type Tone,
} from '../components/ui.tsx';
import { endpoints, humanError, useApi } from '../lib/api.ts';
import type { LiveEvent } from '../lib/live.ts';
import { useActivity, type ActivityItem } from '../lib/activity.ts';
import { triggerHaptic, useToast } from '../components/Toast.tsx';
import { DeviceCarousel } from '../components/DeviceCarousel.tsx';
import { OntPicture } from '../components/DevicePicture.tsx';
import type { TabId } from '../lib/nav.ts';
import {
  AlertTriangleIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  BatteryIcon,
  CheckCircleIcon,
  LineIcon,
  MegaphoneIcon,
  RefreshIcon,
  SpeedometerIcon,
  SpinnerIcon,
} from '../components/icons.tsx';

/**
 * Home, ordered by what it costs to find out late.
 *
 * Not by how often a thing is looked at - that ordering put a status hero
 * saying "Online" at the top of the most-visited screen in the app, which is
 * the same word about ninety-five days in a hundred, and it put Restart, which
 * drops the whole house for ninety seconds, in the top third under a thumb.
 *
 * The order below is: the light, because it decides what you do in the next
 * hour and decays in minutes; then whether the line is usable, which is quiet
 * until it is not; then the month's data, which moves slowly but ends
 * expensively; then who is on the network; then what has happened. One rule
 * bends it, upward and when something is wrong - see `Home` itself.
 */

export function Home({
  status,
  connection,
  recent,
  onNavigate,
}: {
  status: StatusSnapshot | null;
  connection: string;
  recent: LiveEvent[];
  onNavigate: (tab: TabId) => void;
}): React.JSX.Element {
  const power = useApi<PowerSummary>('/power?days=7');
  const devices = useApi<{ devices: Device[] }>('/devices');
  const usage = useApi<UsageSummary & { human: Record<string, string | null> }>('/usage');

  /*
   * Nothing on this screen is live while the socket is shut. Saying so once,
   * loudly, and then dimming every number that came off it is the whole
   * difference between a monitor and a thing that lies quietly: an app that
   * shows a confident "Light is on" during a blackout is one nobody believes
   * about the light again.
   *
   * Connecting only counts if it follows having been connected. On a cold open
   * the socket is always connecting for a moment, and flashing a red "not
   * live" banner during the normal load of every single visit is how a warning
   * stops being read.
   */
  const stale = connection === 'closed' || (connection === 'connecting' && status !== null);

  const broken = status !== null && (status.status === 'down' || status.status === 'degraded');

  return (
    <>
      {status?.activeIncident && (
        <div className="banner banner-bad">
          <MegaphoneIcon size={16} />
          <span>{status.activeIncident.detail}</span>
        </div>
      )}

      {stale && (
        <div className="banner banner-bad">
          <AlertTriangleIcon size={16} />
          <span>
            {connection === 'closed' ? 'Not connected to the monitor.' : 'Reconnecting.'}{' '}
            {status === null
              ? 'Nothing below is live.'
              : `Everything below is as it stood ${ago(status.ts)}.`}
          </span>
        </div>
      )}

      <LineHeader status={status} stale={stale} />

      {/*
        Escalation, rule one. A broken line outranks the light, and it carries
        the power verdict with it, because "is this NEPA or is this MTN" is the
        first thing anyone wants to know and the answer is one word long.
      */}
      {broken && status && <LineDown status={status} power={power.data} onNavigate={onNavigate} />}

      <Async state={power}>
        {(p) => <LightCard power={p} live={status} stale={stale} onNavigate={onNavigate} />}
      </Async>

      {/*
        The budget used to have an escalation of its own - it jumped ahead of
        the throughput card once it was three-quarters spent. That card is gone
        and there is nothing left between the light and this one, so the rule
        now moves it from where it already is. It went with the card.
      */}
      <Async state={usage}>{(u) => <DataCard usage={u} onNavigate={onNavigate} />}</Async>

      <Async state={devices}>
        {(d) => <OnlineDevices devices={d.devices} onNavigate={onNavigate} />}
      </Async>

      <Activity recent={recent} />
    </>
  );
}

/* -- 0. the line ---------------------------------------------------------- */

/*
 * The line's name.
 *
 * A constant rather than config because this app watches one household's one
 * connection - and being the only place the line is named is what keeps that
 * a one-line change if the line ever moves.
 */
const LINE_NAME = 'My Home Router';

/**
 * The masthead: what the line is, what it last measured, and the one button
 * worth pressing from this screen.
 *
 * It sits above the light without breaking the ordering note on `Home`. That
 * note is about cards competing for the top slot, and this is not a card - it
 * is the strip the page opens with, and it delivers no verdict of its own.
 *
 * The two figures are the last speed test, not the traffic on the line right
 * now. They belong to the dial above them - press it and they are replaced -
 * and they answer "how fast is this line".
 *
 * The shape under each one is the other question: sixty minutes of what has
 * actually moved in that direction. It is a second series rather than the
 * history of the figure above it, which is why it is drawn as a shape and
 * given the lane's hue while the figure keeps the strip's ink - the two are
 * not meant to be read as one number and its trend.
 */
function LineHeader({
  status,
  stale,
}: {
  status: StatusSnapshot | null;
  stale: boolean;
}): React.JSX.Element {
  const [busy, setBusy] = useState<string | null>(null);
  const { showToast } = useToast();
  const history = useApi<{ points: ThroughputPoint[] }>('/throughput?hours=1');
  const points = history.data?.points ?? [];
  /*
   * The third shape comes from the probe log rather than the ONT counters,
   * which is the only place an hour of round trips exists. `tier=internet` is
   * the hop the figure above it is about - the router hop would draw a flat
   * line at 1ms and say nothing about the line.
   */
  const pings = useApi<{ points: ProbeSample[] }>('/probes?hours=1&tier=internet');
  const rtt = latencyFloor(pings.data?.points ?? []);
  const ping = latencyNow(rtt);

  const run = async (name: string, fn: () => Promise<unknown>, done: string): Promise<void> => {
    setBusy(name);
    triggerHaptic('light');
    try {
      await fn();
      showToast(done, 'success');
    } catch (err) {
      showToast(humanError(err), 'error');
    } finally {
      setBusy(null);
    }
  };

  const test = status?.lastSpeedtest ?? null;
  const testing = busy === 'speed';

  return (
    <section className={`line-head ${stale ? 'is-stale' : ''}`}>
      <div className="line-head-top">
        <div className="line-id">
          <div className="line-id-row">
            {/*
              The box itself, not a symbol for it: the same HG8145V5 portrait
              the roster draws, at the size the disc used to be. A tinted circle
              around a monoline glyph said "network" twice and named nothing;
              the portrait is the one thing on this screen that says which
              hardware the readings came off.
            */}
            <OntPicture size={40} className="line-mark" />
            <div className="line-id-text">
              <p className="line-name">{LINE_NAME}</p>
              {/* The line's address, which is the nearest thing it has to a number. */}
              <p className="line-sub">{status?.wan?.ipv4 ?? 'No address'}</p>
            </div>
          </div>

          <button
            type="button"
            className="line-switch"
            disabled={busy !== null}
            onClick={() => void run('poll', endpoints.pollNow, 'Router polled')}
          >
            <RefreshIcon size={13} />
            {busy === 'poll' ? 'Checking' : 'Check now'}
          </button>
        </div>

        {/*
          The dial is the speed test and nothing else. The reference this is
          taken from puts a power toggle here, which for this app would be the
          restart - and dropping the house for ninety seconds is exactly the
          action that was deliberately moved off this screen and behind a
          confirm in Settings. See the note on the actions that used to sit at
          the bottom of this page.
        */}
        <button
          type="button"
          className="dial"
          disabled={busy !== null}
          onClick={() =>
            void run('speed', endpoints.runSpeedtest, 'Speed test running — about a minute')
          }
        >
          <span className="dial-ring">
            {testing ? <SpinnerIcon size={26} /> : <SpeedometerIcon size={26} />}
          </span>
          <span className="dial-label">{testing ? 'Testing' : 'Speed test'}</span>
        </button>
      </div>

      {/*
        `data-dir` is here for the shape below each pair and nothing else - it
        sets `--lane`, which only the sparkline reads. See the note on
        `.line-figure-label` for why the arrow and the word stay in the strip's
        faint ink rather than taking the hue with it.

        Three columns, not two: latency is the half of "how good is this line"
        that the two rates cannot answer. A line can hand you 25 Mbps and still
        be unusable for a call, and this is the number that says so.
      */}
      <div className="line-figures">
        <span className="line-figure" data-dir="down">
          <span className="line-figure-label">
            <ArrowDownIcon size={12} />
            Download
          </span>
          <Figure>{test ? `${test.downMbps.toFixed(1)} Mbps` : '—'}</Figure>
          <Sparkline id="spark-down" values={points.map((p) => p.downBps)} />
        </span>
        <span className="line-figure" data-dir="up">
          <span className="line-figure-label">
            <ArrowUpIcon size={12} />
            Upload
          </span>
          <Figure>{test ? `${test.upMbps.toFixed(1)} Mbps` : '—'}</Figure>
          <Sparkline id="spark-up" values={points.map((p) => p.upBps)} />
        </span>
        {/*
          The odd one out, and deliberately: figure and shape are both the
          probe log, where the two beside it pair a speed test with the ONT's
          traffic counters.

          It is not from the test because there is no ping in the test to take.
          `SpeedtestSample.pingMs` is nullable and the http-fallback source
          this line actually runs on leaves it null on every row, so a column
          fed from it would be a permanent dash under a full shape.

          It would not be worth preferring even where a source does fill it in.
          The two rates are a capacity question and a five-hour-old answer is
          still roughly true; latency is what somebody checks before starting a
          call, and a five-hour-old round trip does not answer that. Hence the
          footer below: it dates the test, which is what the two Mbps figures
          came off, and this column is not one of them.
        */}
        <span className="line-figure" data-dir="ping">
          <span className="line-figure-label">
            <LineIcon size={12} />
            Latency
          </span>
          <Figure>{ping !== null ? `${Math.round(ping)} ms` : '—'}</Figure>
          <Sparkline id="spark-ping" values={rtt} />
        </span>
      </div>

      {/*
        A speed with no age on it is the one figure on this screen that would
        be read as current. These are hours old on a quiet day.

        "None on record" is a claim about the database, and with the socket
        shut there is no database to make it about - so with nothing live to
        say it from, this says nothing. The banner at the top of the page has
        already explained why the two figures above are dashes.
      */}
      {(test !== null || status !== null) && (
        <p className="line-foot">
          {test ? `Tested ${ago(test.ts)}.` : 'No speed test on record yet.'}
        </p>
      )}
    </section>
  );
}

/**
 * One round trip per probe cycle, oldest first.
 *
 * Two internet hosts are pinged each cycle and both are written under the same
 * timestamp, so the rows arrive in pairs. Drawn as they come, the shape would
 * zigzag between two servers that are simply different distances away rather
 * than showing the line changing. The floor of each cycle is the honest
 * measure of the path - the same reduction the latency chart on Data makes.
 *
 * A lost packet has no round trip to draw, so it is dropped rather than
 * counted as zero. Loss is a different reading and this shape does not carry
 * it; a hole in a 180-point line an inch wide would not have been visible
 * anyway.
 */
function latencyFloor(samples: ProbeSample[]): number[] {
  const best = new Map<number, number>();
  for (const s of samples) {
    if (s.rttMs === null) continue;
    const seen = best.get(s.ts);
    if (seen === undefined || s.rttMs < seen) best.set(s.ts, s.rttMs);
  }
  return [...best.entries()].sort((a, b) => a[0] - b[0]).map(([, ms]) => ms);
}

/**
 * What a round trip costs right now, in one number.
 *
 * The median of the last five minutes rather than the newest cycle. One
 * unlucky ping is worth nothing on its own, and a figure that changes every
 * twenty seconds is one nobody can read - while fifteen cycles is still short
 * enough that a line going bad shows up here inside a minute.
 */
function latencyNow(floors: number[]): number | null {
  const recent = floors.slice(-15);
  if (recent.length === 0) return null;
  const sorted = [...recent].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}

/**
 * Sixty minutes of one series, as a filled shape.
 *
 * Inline rather than through the chart component: this needs no axes, no
 * cursor and no legend, and rendering a full chart twice in the masthead of
 * the most-visited screen in the app is not worth what one costs.
 */
function Sparkline({ id, values }: { id: string; values: number[] }): React.JSX.Element | null {
  if (values.length < 2) return null;
  const top = Math.max(...values, 1);
  const step = 100 / (values.length - 1);
  const line = values.map((v, i) => `${i * step},${28 - (v / top) * 26}`).join(' ');

  return (
    <svg className="spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
      {/*
        One gradient per lane, named by the lane. An SVG paint server is
        document-scoped, so a shared id would mean the first lane's definition
        painted both - invisible while the two lanes are the same colour, and
        wrong the moment they are not. `--lane` still resolves per lane because
        the gradient sits inside that lane's own subtree.

        `preserveAspectRatio="none"` stretches the viewBox, which is why the
        stops are vertical: a diagonal one would shear with the lane width.
      */}
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--lane, var(--accent))" stopOpacity="0.28" />
          <stop offset="100%" stopColor="var(--lane, var(--accent))" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <polygon points={`0,28 ${line} 100,28`} className="spark-fill" fill={`url(#${id})`} />
      <polyline points={line} className="spark-line" />
    </svg>
  );
}

/* -- 1. the light --------------------------------------------------------- */

/**
 * Confidence, in two words.
 *
 * "going by a clear pattern" is a clause you have to read to the end of to
 * learn one thing: how far to trust the time above it. Sat beside the label as
 * a chip it is read at a glance, and the sentence it came out of is gone.
 */
function hedge(confidence: string | undefined): string {
  if (confidence === 'high') return 'clear pattern';
  if (confidence === 'medium') return 'last few cuts';
  return 'rough guess';
}

/** Below this much pack, the number stops being a fact and becomes a warning. */
const LOW_PACK_SEC = 1800;

/**
 * The one card that is always first.
 *
 * It answers both halves at once - what the power is doing now, and what it is
 * about to do - because they are one thought. Knowing there is light is only
 * half of "should I charge this now".
 *
 * Four lines at most, and each a different kind of thing: the state, the
 * numbers, what is coming, the evidence. The first pass said the state three
 * times over - a tag, a headline repeating the tag after a dash, then a
 * sentence of prose repeating both again before reaching its point - and the
 * number that actually decides the next hour queued behind all of it.
 */
function LightCard({
  power,
  live,
  stale,
  onNavigate,
}: {
  power: PowerSummary;
  live: StatusSnapshot | null;
  stale: boolean;
  onNavigate: (tab: TabId) => void;
}): React.JSX.Element {
  /* The socket knows sooner than the fetch does, so it wins where they differ. */
  const state = live?.power.state ?? power.state;
  const since = live?.power.since ?? power.since;
  const because = live?.power.because ?? power.because;

  const held = since === null ? null : Math.round((Date.now() - since) / 1000);
  const onMains = state === 'mains';
  const restore = power.prediction?.expectedRestoreTs ?? null;

  const runtime = live?.power.batteryRuntimeSec ?? power.batteryRuntimeSec;
  const packLeft = state === 'battery' && runtime !== null && held !== null ? runtime - held : null;

  const tone: Tone =
    state === 'mains' ? 'good' : state === 'battery' ? 'warn' : state === 'off' ? 'bad' : 'neutral';

  /* The tag has already said which state this is; the headline says what it means. */
  const title =
    state === 'mains'
      ? 'Light is on'
      : state === 'battery'
        ? 'Light is off'
        : state === 'off'
          ? 'No power'
          : 'Power state unclear';

  /*
   * The numbers the next hour gets planned in, each standing on its own label.
   *
   * These were one middot-joined sentence - "For 3h 12m · 4h 20m of pack left"
   * - which was already better than the paragraph it replaced, but it still
   * had to be read left to right before either figure could be found, because
   * nothing in it looked different from anything else in it. As a strip, the
   * digits are large and the words that qualify them are small, so the pack
   * figure is located by position rather than by parsing.
   *
   * None of them carries a tone. The card's state is already on the beacon,
   * and a comfortable pack painted amber because the light happens to be off
   * is the same fact told twice; a nearly-flat one is not a fact any more, and
   * it is the warning below rather than a figure up here.
   */
  const figures: { label: string; value: string }[] = [];
  if (held !== null) {
    figures.push({ value: formatDuration(held), label: onMains ? 'on mains' : 'off for' });
  }
  if (packLeft !== null && packLeft > LOW_PACK_SEC) {
    figures.push({ value: formatDuration(packLeft), label: 'pack left' });
  }
  if (onMains && power.patterns?.averageMainsHoursPerDay != null) {
    figures.push({
      value: `${power.patterns.averageMainsHoursPerDay} h`,
      label: 'light a day this week',
    });
  }

  return (
    <section className={`hero ${stale ? 'is-stale' : ''}`} data-tone={tone}>
      <span className="hero-tag">
        <span className="beacon" />
        {onMains ? 'On mains' : state === 'battery' ? 'On battery' : state === 'off' ? 'Dark' : 'Unknown'}
      </span>
      <h1 className="hero-headline">{title}</h1>
      {figures.length > 0 && (
        <FigureRow>
          {figures.map((f) => (
            <KeyFigure key={f.label} label={f.label} value={f.value} />
          ))}
        </FigureRow>
      )}

      {/* What is coming, which is the half a state readout on its own leaves out. */}
      {!onMains && restore !== null && (
        <div className="restore">
          <div className="restore-head">
            <span>
              <BatteryIcon size={15} /> Expected back
            </span>
            <span className="restore-hedge">{hedge(power.prediction?.confidence)}</span>
          </div>
          <span className="restore-time">{localTime(restore)}</span>
          <span className="restore-left">
            {restore > Date.now() ? (
              `in ${formatDuration(Math.round((restore - Date.now()) / 1000))}`
            ) : (
              /*
               * The estimate has come and gone. Counting down to "0s to go"
               * against a time already in the past is the app insisting on a
               * guess it has been proven wrong about.
               */
              <>Overdue — not back yet</>
            )}
          </span>
        </div>
      )}

      {packLeft !== null && packLeft <= LOW_PACK_SEC && (
        <p className="notice notice-bad">
          {packLeft > 0 ? (
            <>
              Only <strong>{formatDuration(packLeft)}</strong> of pack left.
            </>
          ) : (
            <>Past the {formatDuration(runtime ?? 0)} this pack usually manages.</>
          )}
        </p>
      )}

      {/* The evidence, last and quietest: it explains the verdict, it is not the verdict. */}
      <p className="hero-foot">{because}</p>

      <div className="hero-actions">
        <SeeAll onClick={() => onNavigate('light')}>Pattern and history</SeeAll>
      </div>
    </section>
  );
}

/* -- 2. the line ---------------------------------------------------------- */

/**
 * The line, when it is not fine.
 *
 * There is no counterpart for the good case any more. "Online" was a row at
 * the top of the screen roughly ninety-five days in a hundred, which is a
 * long time to spend teaching people that the top of the screen never says
 * anything - and the top of the screen is the one place a real problem has to
 * be seen. The numbers it carried all live on Data, a tap away.
 *
 * So the line appears only when it has something to report, and when it does
 * it takes the whole width, plus whose fault it is.
 */
function LineDown({
  status,
  power,
  onNavigate,
}: {
  status: StatusSnapshot;
  power: PowerSummary | null;
  onNavigate: (tab: TabId) => void;
}): React.JSX.Element {
  const down = status.status === 'down';
  const onMains = (power?.state ?? status.power.state) === 'mains';

  /*
   * The line that saves a phone call. If the router is sitting on mains and
   * the internet is still gone, the fault is not in this house - and that is
   * exactly the sentence to open a support ticket with.
   */
  const blame = onMains
    ? 'The router has power, so this is the line rather than the light.'
    : 'The light is off, so this is very likely the power rather than the line.';

  return (
    <section className="hero" data-tone={down ? 'bad' : 'warn'}>
      <span className="hero-tag">
        <span className="beacon" />
        {down ? 'Down' : 'Degraded'}
      </span>
      <h1 className="hero-headline">{status.headline}</h1>
      <p className="hero-sub">{blame}</p>
      <p className="hero-foot">Checked {localTime(status.ts)}.</p>
      <div className="hero-actions">
        <SeeAll onClick={() => onNavigate('light')}>See it on the timeline</SeeAll>
      </div>
    </section>
  );
}

/* -- 3. the month's data -------------------------------------------------- */

function DataCard({
  usage,
  onNavigate,
}: {
  usage: UsageSummary & { human: Record<string, string | null> };
  onNavigate: (tab: TabId) => void;
}): React.JSX.Element {
  const cap = usage.capBytes;
  const used = usage.monthToDateBytes;
  const fraction = cap ? used / cap : null;
  const today = usage.days[usage.days.length - 1];
  const todayBytes = today ? today.downBytes + today.upBytes : 0;

  const tone: Tone =
    fraction === null ? 'accent' : fraction > 0.9 ? 'bad' : fraction > 0.75 ? 'warn' : 'accent';

  /*
   * Days left in the month against days the allowance will actually last. A
   * bar at 78% is a fact; "four days short" is the same fact in the units the
   * decision is made in.
   */
  const now = new Date();
  const daysLeft =
    new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate() + 1;
  const perDay = usage.days.length
    ? usage.days.reduce((a, d) => a + d.downBytes + d.upBytes, 0) / usage.days.length
    : 0;

  /*
   * Today against the usual day.
   *
   * A figure with nothing to measure it by is the thing every one of these
   * cards was missing: "4.1 GB today" is only a large number if you happen to
   * remember what a normal day costs. This is the one comparison the card
   * already had the arithmetic for, so it is the one that gets drawn - and
   * more data off the allowance is bad news, which is what the polarity is
   * for. The last bucket is today's and is still filling, so it is only worth
   * comparing once there is enough of a history to average against.
   */
  const todayVsUsual =
    usage.days.length >= 7 && perDay > 0 ? ((todayBytes - perDay) / perDay) * 100 : null;
  const lasts = cap !== null && perDay > 0 ? Math.floor(Math.max(0, cap - used) / perDay) : null;
  const short = lasts !== null && lasts < daysLeft ? daysLeft - lasts : null;

  return (
    <Card
      title="Data this month"
      action={<SeeAll onClick={() => onNavigate('data')}>Breakdown</SeeAll>}
    >
      <div className="usage-summary">
        <span className={`usage-used tone-${tone}`}>
          <Figure>{formatBytes(used)}</Figure>
        </span>
        <span className="usage-of">{cap ? `of ${formatBytes(cap)}` : 'no cap on this plan'}</span>
      </div>

      {fraction !== null && <Meter fraction={fraction} tone={tone} />}

      {short !== null && (
        <p className="notice notice-warn">
          At this rate the allowance runs out <strong>{short} {short === 1 ? 'day' : 'days'}</strong>{' '}
          before the month does.
        </p>
      )}

      {/*
        An uncapped plan has no allowance to run out, so "Left —" and a count
        of days it will last are two tiles spent saying nothing. What is worth
        knowing there is the rate instead.
      */}
      <StatGrid>
        <Stat
          label="Today"
          value={formatBytes(todayBytes)}
          delta={todayVsUsual === null ? undefined : <Delta pct={todayVsUsual} polarity="up-bad" />}
          hint={todayVsUsual === null ? undefined : `usually ${formatBytes(perDay)}`}
        />
        {cap === null ? (
          <>
            <Stat label="Daily average" value={formatBytes(perDay)} />
            <Stat
              label="Projected month end"
              value={usage.human['projected'] ?? formatBytes(usage.projectedMonthBytes)}
            />
          </>
        ) : (
          <>
            <Stat label="Left" value={formatBytes(Math.max(0, cap - used))} tone={tone} />
            <Stat
              label="Days left"
              value={daysLeft}
              hint={lasts === null ? undefined : `data lasts ${lasts}`}
            />
          </>
        )}
      </StatGrid>
    </Card>
  );
}

/* -- 4. who is on the network --------------------------------------------- */

function OnlineDevices({
  devices,
  onNavigate,
}: {
  devices: Device[];
  onNavigate: (tab: TabId) => void;
}): React.JSX.Element {
  const online = devices.filter((d) => d.online);

  if (online.length === 0) {
    return (
      <Card title="Devices">
        <p className="muted">Nothing is connected to the Wi-Fi right now.</p>
      </Card>
    );
  }

  /*
   * Deliberately not in a Card. A shelf inside a card is cut off by the card's
   * own edge, and a row that stops short of the screen reads as clipped rather
   * than as scrollable. Sitting straight on the page, the last card runs off
   * the side of the phone, which is the whole affordance.
   */
  return (
    <section className="shelf-section">
      <header className="shelf-head">
        <h2>{online.length === 1 ? '1 device online' : `${online.length} devices online`}</h2>
        <SeeAll onClick={() => onNavigate('devices')}>All {devices.length}</SeeAll>
      </header>
      <DeviceCarousel devices={online} onSelect={() => onNavigate('devices')} />
    </section>
  );
}

/* -- 5. what has happened ------------------------------------------------- */

function Activity({ recent }: { recent: LiveEvent[] }): React.JSX.Element {
  const { items, loading } = useActivity(recent);

  return (
    <Card title="Recent activity">
      {items.length === 0 ? (
        <p className="muted">
          {loading ? 'Looking back over the last few days…' : 'Nothing has happened in days. Good.'}
        </p>
      ) : (
        <List>
          {items.map((e) => (
            <FeedRow key={e.id} item={e} />
          ))}
        </List>
      )}
    </Card>
  );
}

/*
 * The activity row is the same object as a row in the fault list on Light and
 * the app list in every one of the reference apps: a well, a line, and the
 * measurement pushed to the right edge where the eye can run down it. It was
 * its own three-column grid before, which is how the app ended up with two
 * list layouts that differed by two pixels of gap.
 */
function FeedRow({ item }: { item: ActivityItem }): React.JSX.Element {
  return (
    <ListRow
      tone={item.tone}
      icon={item.tone === 'good' ? <CheckCircleIcon size={16} /> : <AlertTriangleIcon size={16} />}
      title={item.text}
      valueSub={localTime(item.ts)}
    />
  );
}
