import { useMemo, useState, type ReactNode } from 'react';
import {
  formatBps,
  formatBytes,
  type OpticalSample,
  type ProbeSample,
  type SpeedtestSample,
  type ThroughputPoint,
  type UsageSummary,
} from '@waifai/shared';
import {
  Async,
  Badge,
  Button,
  Card,
  Delta,
  Hero,
  Meter,
  Segmented,
  Stat,
  StatGrid,
  ago,
} from '../components/ui.tsx';
import { PageHeader } from '../components/PageHeader.tsx';
import { SubscriptionCard } from '../components/Subscription.tsx';
import { TimeChart, type ChartSeries } from '../components/TimeChart.tsx';
import { DailyBars } from '../components/DailyBars.tsx';
import { endpoints, humanError, useApi, type HourlyOptical } from '../lib/api.ts';
import { cycleLabel, cycleProgress, formatDay } from '../lib/cycle.ts';
import { directionColor, seriesColor } from '../lib/palette.ts';
import { useResolvedTheme } from '../lib/theme.ts';
import { useToast } from '../components/Toast.tsx';
import { SpeedometerIcon } from '../components/icons.tsx';

/**
 * Everything about the pipe: what it has carried, how fast it goes, and - at
 * the bottom - the readings that say why when it does not.
 *
 * Line used to be a screen of its own, reachable only from a button on this
 * one. That made the optical readings the app's best evidence in an argument
 * with the ISP, filed somewhere nobody would find them. They are diagnostics,
 * so they sit at the bottom rather than at the top, but they sit on the same
 * screen as the complaint they support.
 */

/** Where a GPON link actually lives. Below -27 dBm most ONTs lose sync. */
const SYNC_FLOOR = -27;
const HEALTHY_TOP = -8;

export function Data(): React.JSX.Element {
  return (
    <>
      <PageHeader title="Data" />
      <SubscriptionCard />
      <Consumption />
      <Traffic />
      <Speed />
      <Diagnostics />
    </>
  );
}

/* -- how much of the plan is gone ----------------------------------------- */

function Consumption(): React.JSX.Element {
  const usage = useApi<UsageSummary & { human: Record<string, string | null> }>('/usage');

  /*
   * The heading is read off the state rather than from inside `Async`, so the
   * card keeps its frame while the numbers load. Nothing is claimed before it
   * is known: until the summary arrives there is no window to name, and the
   * title stands alone exactly as it did.
   *
   * "September · day 3 of 30" is the whole answer to two questions the card
   * used to leave open - which month, and how far into it - and the second is
   * what decides whether the projection below is worth anything. A rate read
   * off three days is a guess; off twenty-seven it is nearly the bill.
   */
  const period = usage.data;
  const progress = period && cycleProgress(period);

  return (
    <Card
      title="This billing month"
      meta={
        period && progress && `${cycleLabel(period)} · day ${progress.day} of ${progress.of}`
      }
    >
      <Async state={usage}>
        {(data) => {
          const cap = data.capBytes;
          const fraction = cap ? data.monthToDateBytes / cap : null;
          const days = data.days.slice(-31);
          const dailyAverage = days.length
            ? days.reduce((a, d) => a + d.downBytes + d.upBytes, 0) / days.length
            : 0;

          /*
           * This week against last week.
           *
           * The month-to-date figure above only ever climbs, so on its own it
           * cannot say whether the household is spending faster or slower than
           * it was - which is the thing that decides whether the projection at
           * the bottom of this card is worth believing. Both windows have to
           * be complete before this is drawn: six days against seven is not a
           * fall in consumption, it is a missing day, and a badge that cannot
           * tell those apart is worse than no badge.
           */
          const total = (list: typeof days): number =>
            list.reduce((a, d) => a + d.downBytes + d.upBytes, 0);
          const thisWeek = days.slice(-7);
          const lastWeek = days.slice(-14, -7);
          const weekOnWeek =
            thisWeek.length === 7 && lastWeek.length === 7 && total(lastWeek) > 0
              ? ((total(thisWeek) - total(lastWeek)) / total(lastWeek)) * 100
              : null;

          const tone =
            fraction === null ? 'accent' : fraction > 0.9 ? 'bad' : fraction > 0.75 ? 'warn' : 'accent';

          return (
            <>
              <Hero
                value={formatBytes(data.monthToDateBytes)}
                tone={tone}
                caption={
                  cap
                    ? `of ${formatBytes(cap)} used`
                    : `used since ${formatDay(data.cycleStart)} — this plan has no cap`
                }
              />

              {fraction !== null && (
                <>
                  <Meter fraction={fraction} tone={tone} />
                  <div className="scale-ends">
                    <span>{Math.round(fraction * 100)}% used</span>
                    <span>{formatBytes(Math.max(0, (cap ?? 0) - data.monthToDateBytes))} left</span>
                  </div>
                </>
              )}

              <StatGrid>
                {/*
                  "Month end" is a date, so it says which one. The tile was
                  asking to be trusted about the one thing it would not name.
                */}
                <Stat
                  label="Projected month end"
                  value={data.human['projected'] ?? formatBytes(data.projectedMonthBytes)}
                  tone={cap !== null && data.projectedMonthBytes > cap ? 'bad' : 'neutral'}
                  hint={
                    cap !== null && data.projectedMonthBytes > cap
                      ? `over the cap by ${formatDay(data.cycleEnd)}`
                      : `at this rate, by ${formatDay(data.cycleEnd)}`
                  }
                />
                <Stat
                  label="Daily average"
                  value={formatBytes(dailyAverage)}
                  hint={`over ${days.length} recorded ${days.length === 1 ? 'day' : 'days'}`}
                />
                <Stat
                  label="Last 7 days"
                  value={formatBytes(total(thisWeek))}
                  delta={weekOnWeek === null ? undefined : <Delta pct={weekOnWeek} polarity="up-bad" />}
                  hint={weekOnWeek === null ? 'no week to compare yet' : 'against the week before'}
                />
              </StatGrid>

              {days.length > 0 ? (
                <DailyBars days={days} />
              ) : (
                <p className="muted">The daily breakdown fills in as the router is polled.</p>
              )}
            </>
          );
        }}
      </Async>
    </Card>
  );
}

/* -- live traffic --------------------------------------------------------- */

function Traffic(): React.JSX.Element {
  const theme = useResolvedTheme();
  const [hours, setHours] = useState(6);
  const throughput = useApi<{ points: ThroughputPoint[] }>(`/throughput?hours=${hours}`, [hours]);

  return (
    <Card
      title="Traffic"
      action={
        <Segmented
          label="Period"
          value={hours}
          onChange={setHours}
          options={[
            { value: 6, label: '6h' },
            { value: 24, label: '24h' },
            { value: 72, label: '3d' },
          ]}
        />
      }
    >
      <Async state={throughput}>
        {(data) => {
          const peakDown = data.points.length ? Math.max(...data.points.map((p) => p.downBps)) : 0;
          const peakUp = data.points.length ? Math.max(...data.points.map((p) => p.upBps)) : 0;

          return (
            <>
              <TimeChart
                timestamps={data.points.map((p) => p.ts)}
                series={[
                  {
                    label: 'Download',
                    values: data.points.map((p) => p.downBps),
                    color: directionColor(theme, 'down'),
                    area: true,
                  },
                  {
                    label: 'Upload',
                    values: data.points.map((p) => p.upBps),
                    color: directionColor(theme, 'up'),
                  },
                ]}
                height={200}
                format={(v) => formatBps(v)}
                emptyMessage="No traffic recorded in this window."
              />
              {data.points.length > 0 && (
                <StatGrid>
                  <Stat label="Peak download" value={formatBps(peakDown)} tone="accent" />
                  <Stat label="Peak upload" value={formatBps(peakUp)} tone="accent" />
                </StatGrid>
              )}
            </>
          );
        }}
      </Async>
    </Card>
  );
}

/* -- speed tests ---------------------------------------------------------- */

function Speed(): React.JSX.Element {
  const theme = useResolvedTheme();
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const { showToast } = useToast();
  const speed = useApi<{ plan: { downMbps: number; upMbps: number }; points: SpeedtestSample[] }>(
    `/speedtests?days=${days}`,
    [days],
  );

  /*
   * The button lives here rather than on the home screen. Running a test is
   * not something done in passing - it is done because the line feels slow and
   * you want a number to point at - and the number it produces is on this card.
   */
  const run = async (): Promise<void> => {
    setBusy(true);
    try {
      await endpoints.runSpeedtest();
      showToast('Speed test running — about a minute', 'info');
    } catch (err) {
      showToast(humanError(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Speed tests"
      action={
        <Button
          size="sm"
          variant="ghost"
          busy={busy}
          icon={<SpeedometerIcon size={14} />}
          onClick={() => void run()}
        >
          Run one
        </Button>
      }
    >
      <Segmented
        label="Period"
        value={days}
        onChange={setDays}
        options={[
          { value: 7, label: '7d' },
          { value: 30, label: '30d' },
          { value: 90, label: '90d' },
        ]}
      />

      <Async state={speed}>
        {(data) => {
          const latest = data.points[data.points.length - 1];
          const average = data.points.length
            ? data.points.reduce((a, p) => a + p.downMbps, 0) / data.points.length
            : null;
          const plan = data.plan.downMbps;
          const share = average !== null && plan > 0 ? average / plan : null;

          return (
            <>
              <StatGrid>
                {/*
                  The delta is the whole reason a single speed test is worth
                  looking at: 38 Mbps means nothing until it is set against
                  what this line normally manages. Two results is not an
                  average, so it waits for a handful.
                */}
                <Stat
                  label="Latest"
                  value={latest ? `${latest.downMbps} Mbps` : '—'}
                  tone="accent"
                  delta={
                    latest && average !== null && data.points.length >= 5 && average > 0 ? (
                      <Delta pct={((latest.downMbps - average) / average) * 100} />
                    ) : undefined
                  }
                  hint={latest ? `${latest.upMbps} up · ${ago(latest.ts)}` : 'none run yet'}
                />
                <Stat
                  label="Average download"
                  value={average === null ? '—' : `${average.toFixed(1)} Mbps`}
                />
                {plan > 0 && (
                  <Stat
                    label="Against the plan"
                    value={
                      share === null ? (
                        '—'
                      ) : (
                        <Badge tone={share > 0.8 ? 'good' : share > 0.5 ? 'warn' : 'bad'} dot>
                          {Math.round(share * 100)}%
                        </Badge>
                      )
                    }
                    hint={`sold as ${plan} Mbps`}
                  />
                )}
              </StatGrid>

              <TimeChart
                timestamps={data.points.map((p) => p.ts)}
                series={[
                  {
                    label: 'Download',
                    values: data.points.map((p) => p.downMbps),
                    color: directionColor(theme, 'down'),
                    area: true,
                  },
                  {
                    label: 'Upload',
                    values: data.points.map((p) => p.upMbps),
                    color: directionColor(theme, 'up'),
                  },
                ]}
                height={190}
                format={(v) => `${Math.round(v)} Mbps`}
                {...(plan > 0 ? { threshold: { value: plan, label: `Plan · ${plan} Mbps` } } : {})}
                emptyMessage="No speed tests yet. Run one with the button above."
              />

              {plan === 0 && (
                <p className="muted">No plan speed on record to measure these against.</p>
              )}
            </>
          );
        }}
      </Async>
    </Card>
  );
}

/* -- diagnostics ---------------------------------------------------------- */

const RANGES = [
  { value: 6, label: '6h' },
  { value: 24, label: '24h' },
  { value: 24 * 7, label: '7d' },
  { value: 24 * 30, label: '30d' },
];

function Diagnostics(): React.JSX.Element {
  const [hours, setHours] = useState(24);

  return (
    /*
      One surface for the section. The period switcher sets the window for both
      readings under it, so it has to sit inside the box it governs; floating
      above two separate cards it belonged to neither of them.
    */
    <Card
      title="Diagnostics"
      action={<Segmented label="Period" value={hours} onChange={setHours} options={RANGES} />}
    >
      <p className="card-note">
        The evidence half of the screen. These are the readings to quote at a support desk, because
        they say whether a bad hour was the fibre, the route out, or something inside the flat.
      </p>
      <Optical hours={hours} />
      <Latency hours={hours} />
    </Card>
  );
}

/**
 * A named reading inside a card. Diagnostics holds two of them, and they are
 * told apart by a rule and a heading rather than by a second box: a stroked
 * panel inside a panel is the nesting the card exists to avoid.
 */
function Block({ title, children }: { title: string; children: ReactNode }): React.JSX.Element {
  return (
    <section className="block">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Optical({ hours }: { hours: number }): React.JSX.Element {
  const theme = useResolvedTheme();
  const optical = useApi<{ resolution: 'raw' | 'hourly'; points: OpticalSample[] | HourlyOptical[] }>(
    `/optical?hours=${hours}`,
    [hours],
  );

  return (
    <Async state={optical}>
      {(data) => {
        const ts = data.points.map((p) => ('ts' in p ? p.ts : p.hour));
        const rx = data.points.map((p) => ('ts' in p ? p.rxPower : p.rx));
        const valid = rx.filter((v): v is number => v !== null && Number.isFinite(v));

        // `at(-1)` on an empty array is undefined, which is what made every
        // read of this value a type error before.
        const latest = valid.length > 0 ? (valid[valid.length - 1] as number) : null;
        const low = valid.length > 0 ? Math.min(...valid) : null;
        const high = valid.length > 0 ? Math.max(...valid) : null;

        const tone =
          latest === null ? 'neutral' : latest >= -25 ? 'good' : latest >= -27 ? 'warn' : 'bad';
        const verdict =
          latest === null
            ? 'No optical reading'
            : latest >= -25
              ? 'Healthy signal'
              : latest >= -27
                ? 'Weak but in sync'
                : 'Below the sync threshold';

        const series: ChartSeries[] = [
          { label: 'Received power', values: rx, color: seriesColor(theme, 0), area: true },
        ];

        if (data.resolution === 'hourly') {
          const h = data.points as HourlyOptical[];
          series.push(
            {
              label: 'Hourly low',
              values: h.map((p) => p.rxMin),
              color: seriesColor(theme, 0),
              subdued: true,
            },
            {
              label: 'Hourly high',
              values: h.map((p) => p.rxMax),
              color: seriesColor(theme, 0),
              subdued: true,
            },
          );
        }

        return (
          <Block title="Fibre signal">
            <Hero
              value={latest === null ? 'No link' : latest.toFixed(1)}
              unit={latest === null ? undefined : 'dBm'}
              tone={tone}
              caption={verdict}
            />

            {/* Where this reading sits between losing sync and a perfect line. */}
            <Meter
              fraction={latest === null ? 0 : (latest - SYNC_FLOOR) / (HEALTHY_TOP - SYNC_FLOOR)}
              tone={tone === 'neutral' ? 'accent' : tone}
            />
            <div className="scale-ends">
              <span>{SYNC_FLOOR} dBm · loses sync</span>
              <span>{HEALTHY_TOP} dBm · ideal</span>
            </div>

            <TimeChart
              timestamps={ts}
              series={series}
              height={200}
              format={(v) => `${v.toFixed(1)} dBm`}
              threshold={{ value: SYNC_FLOOR, label: 'Sync threshold' }}
              emptyMessage="No optical readings for this period."
            />

            <StatGrid>
              <Stat label="Best" value={high === null ? '—' : `${high.toFixed(1)} dBm`} />
              <Stat label="Worst" value={low === null ? '—' : `${low.toFixed(1)} dBm`} />
              <Stat label="Readings" value={valid.length} />
            </StatGrid>
          </Block>
        );
      }}
    </Async>
  );
}

const TIERS = [
  { tier: 'ont', label: 'Router' },
  { tier: 'gateway', label: 'ISP gateway' },
  { tier: 'local_ng', label: 'Nigeria' },
  { tier: 'internet', label: 'Global' },
] as const;

function Latency({ hours }: { hours: number }): React.JSX.Element {
  const theme = useResolvedTheme();
  const probes = useApi<{ points: ProbeSample[] }>(`/probes?hours=${hours}`, [hours]);
  const points = probes.data?.points;

  const { timestamps, series } = useMemo(() => {
    const list = points ?? [];
    const stamps = [...new Set(list.map((p) => p.ts))].sort((a, b) => a - b);
    const index = new Map(stamps.map((t, i) => [t, i]));

    const present = TIERS.filter((t) => list.some((p) => p.tier === t.tier));
    const built = present.map((t, slot): ChartSeries => {
      const values: (number | null)[] = new Array(stamps.length).fill(null);
      for (const p of list) {
        if (p.tier !== t.tier || p.rttMs === null) continue;
        const i = index.get(p.ts);
        if (i === undefined) continue;
        const existing = values[i];
        // Best of the burst: the floor is the honest measure of the path.
        if (existing === null || existing === undefined || p.rttMs < existing) values[i] = p.rttMs;
      }
      return { label: t.label, values, color: seriesColor(theme, slot), area: slot === 0 };
    });

    return { timestamps: stamps, series: built };
    // `points` is the fetched array; it only changes when new data arrives.
  }, [points, theme]);

  const summary = useMemo(() => {
    const list = (points ?? []).filter((p) => p.tier === 'internet');
    if (list.length === 0) return null;
    return {
      loss: list.reduce((a, p) => a + p.loss, 0) / list.length,
      jitter: Math.max(0, ...list.map((p) => p.jitterMs ?? 0)),
      samples: list.length,
    };
  }, [points]);

  return (
    <Block title="Round trip by hop">
      <Async state={probes}>
        {() => (
          <>
            <TimeChart
              timestamps={timestamps}
              series={series}
              height={210}
              format={(v) => `${Math.round(v)} ms`}
              emptyMessage="No checks recorded for this period."
            />
            <p className="muted">
              A fast router hop next to a slow global hop puts the delay on the ISP, not on the
              house.
            </p>
            {summary && (
              <StatGrid>
                <Stat
                  label="Packet loss"
                  value={`${(summary.loss * 100).toFixed(1)}%`}
                  tone={summary.loss > 0.05 ? 'bad' : summary.loss > 0.01 ? 'warn' : 'good'}
                />
                <Stat
                  label="Worst jitter"
                  value={`${Math.round(summary.jitter)} ms`}
                  tone={summary.jitter > 50 ? 'warn' : 'good'}
                  hint="calls and games"
                />
                <Stat label="Checks" value={summary.samples} />
              </StatGrid>
            )}
          </>
        )}
      </Async>
    </Block>
  );
}
