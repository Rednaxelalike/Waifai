import { useState } from 'react';
import {
  formatDuration,
  type Incident,
  type PowerPatternStats,
  type PowerState,
  type PowerSummary,
  type UptimeReport,
} from '@waifai/shared';
import {
  Async,
  Badge,
  Button,
  Card,
  DayGrid,
  Hero,
  List,
  ListRow,
  Segmented,
  Stat,
  StatGrid,
  localTime,
  type DayCell,
  type Tone,
} from '../components/ui.tsx';
import { PageHeader } from '../components/PageHeader.tsx';
import { PowerTimeline } from '../components/PowerTimeline.tsx';
import { endpoints, useApi } from '../lib/api.ts';
import { sequential, SEQUENTIAL_ENDS } from '../lib/palette.ts';
import { useResolvedTheme } from '../lib/theme.ts';
import { useToast } from '../components/Toast.tsx';
import { incidentMeta as meta } from '../lib/incidents.ts';
import {
  AlertTriangleIcon,
  BatteryIcon,
  EyeOffIcon,
  GlobeIcon,
  LineIcon,
  PowerIcon,
  RouterIcon,
  ServerIcon,
  SpeedometerIcon,
} from '../components/icons.tsx';

/**
 * The light, and everything that has ever taken the Wi-Fi away.
 *
 * Power and History used to be two tabs. They were never two questions: a
 * fibre fault and a NEPA cut both arrive as "the internet has stopped", and
 * telling them apart was left to the reader flipping between screens with a
 * timestamp held in their head. The timeline near the top does that
 * correlation instead, and everything below it is the long form of the same
 * period - what powered the router, and what broke while it was powered.
 */

const STATE: Record<PowerState, { title: string; tone: Tone }> = {
  mains: { title: 'Light is on', tone: 'good' },
  battery: { title: 'On the battery pack', tone: 'warn' },
  off: { title: 'No power', tone: 'bad' },
  unknown: { title: 'Not sure', tone: 'neutral' },
};


export function Light(): React.JSX.Element {
  const [days, setDays] = useState(7);
  const power = useApi<PowerSummary>(`/power?days=${days}`, [days]);
  const uptime = useApi<UptimeReport>(`/uptime?days=${days}`, [days]);

  return (
    <>
      <PageHeader
        title="Light"
        action={
          <Segmented
            label="Period"
            value={days}
            onChange={setDays}
            options={[
              { value: 1, label: '24h' },
              { value: 7, label: '7 days' },
              { value: 30, label: '30 days' },
            ]}
          />
        }
      />

      <Async state={power}>
        {(report) => (
          <>
            <RightNow report={report} />

            <Card title="What happened">
              <PowerTimeline
                from={report.window.from}
                to={report.window.to}
                spans={report.spans}
                incidents={uptime.data?.incidents ?? []}
              />
            </Card>

            {days >= 7 && <DayByDay report={report} days={days} />}

            <Totals report={report} days={days} />
            <Patterns report={report} />
          </>
        )}
      </Async>

      <Async state={uptime}>
        {(report) => (
          <>
            <Reliability report={report} days={days} />
            <Breakdown report={report} />
            <Outages incidents={report.incidents} onChange={uptime.reload} />
          </>
        )}
      </Async>
    </>
  );
}

/* -- current state -------------------------------------------------------- */

/**
 * Confidence, in two words.
 *
 * A `medium confidence` chip is a machine describing its own uncertainty, and
 * "going by the last few cuts" is a clause you read to the end of to learn one
 * thing: how far to trust the time above it. Beside the label, it is glanced.
 */
function hedge(confidence: string | undefined): string {
  if (confidence === 'high') return 'clear pattern';
  if (confidence === 'medium') return 'last few cuts';
  return 'rough guess';
}

/** Below this much pack, the number stops being a fact and becomes a warning. */
const LOW_PACK_SEC = 1800;

/** The next hour of the day at which cuts have historically tended to start. */
function nextTypicalCut(patterns: PowerPatternStats | null | undefined): number | null {
  const hours = patterns?.peakOutageHours;
  if (!hours?.length) return null;
  const now = new Date();
  const hour = now.getHours();
  const sorted = [...hours].sort((a, b) => a - b);
  const ahead = sorted.find((h) => h > hour) ?? sorted[0];
  if (ahead === undefined) return null;
  const when = new Date(now);
  when.setHours(ahead, 0, 0, 0);
  // Every peak hour today has already passed, so the next one is tomorrow's.
  if (ahead <= hour) when.setDate(when.getDate() + 1);
  return when.getTime();
}

/**
 * The state, the numbers, what is coming, and the evidence - in that order.
 *
 * Same shape as the home card deliberately: this is the page that card links
 * to, and arriving at a differently-worded version of the thing you just
 * tapped reads as a different reading rather than a longer look at the same
 * one. What this page adds is the basis line under the estimate.
 */
function RightNow({ report }: { report: PowerSummary }): React.JSX.Element {
  const m = STATE[report.state];
  const held = report.since === null ? null : Math.round((Date.now() - report.since) / 1000);
  const prediction = report.prediction;
  const onMains = report.state === 'mains';

  /*
   * How much pack is left, which is the single most actionable number in the
   * app while the light is off. It is the usual runtime minus how long this
   * hold has already run - an estimate, and labelled as one, but the
   * alternative was showing the typical runtime alone and leaving the reader
   * to do the subtraction during a blackout.
   */
  const packLeft =
    report.state === 'battery' && report.batteryRuntimeSec !== null && held !== null
      ? report.batteryRuntimeSec - held
      : null;

  const nextCut = onMains ? nextTypicalCut(report.patterns) : null;

  /* One middot-separated line of numbers. A nearly-flat pack is not a fact any
     more, it is the warning below, so it drops out of here at that point. */
  const facts: string[] = [];
  if (held !== null) facts.push(`For ${formatDuration(held)}`);
  if (packLeft !== null && packLeft > LOW_PACK_SEC) {
    facts.push(`${formatDuration(packLeft)} of pack left`);
  }

  return (
    <section className="hero" data-tone={m.tone}>
      <span className="hero-tag">
        <span className="beacon" />
        {report.state === 'off' ? 'No Wi-Fi' : 'Wi-Fi on'}
      </span>
      <h1 className="hero-headline">{m.title}</h1>
      {facts.length > 0 && <p className="hero-sub">{facts.join(' · ')}</p>}

      {/*
        Both halves of the answer, always. "There is light" and "and it usually
        goes at about seven" are one thought, and splitting them across a card
        and a page was making the reader assemble it.
      */}
      {onMains && nextCut !== null && (
        <div className="restore">
          <div className="restore-head">
            <span>
              <PowerIcon size={15} /> Cuts usually start
            </span>
          </div>
          <span className="restore-time">{localTime(nextCut)}</span>
          <span className="restore-left">
            in {formatDuration(Math.max(0, Math.round((nextCut - Date.now()) / 1000)))}
          </span>
        </div>
      )}

      {!onMains && prediction?.expectedRestoreTs != null && (
        <div className="restore">
          <div className="restore-head">
            <span>
              <BatteryIcon size={15} /> Expected back
            </span>
            <span className="restore-hedge">{hedge(prediction.confidence)}</span>
          </div>
          <span className="restore-time">{localTime(prediction.expectedRestoreTs)}</span>
          <span className="restore-left">
            {prediction.expectedRestoreTs > Date.now() ? (
              `in ${formatDuration(Math.round((prediction.expectedRestoreTs - Date.now()) / 1000))}`
            ) : (
              /* Counting down to "0s to go" against a time already past is the
                 app insisting on a guess it has been proven wrong about. */
              <>Overdue — not back yet</>
            )}
          </span>
          {prediction.basis && <p className="restore-basis">{prediction.basis}</p>}
        </div>
      )}

      {packLeft !== null && packLeft <= LOW_PACK_SEC && (
        <p className="notice notice-bad">
          {packLeft > 0 ? (
            <>
              Only <strong>{formatDuration(packLeft)}</strong> of pack left.
            </>
          ) : (
            <>
              Past the {formatDuration(report.batteryRuntimeSec ?? 0)} this pack usually manages - it
              could go at any point.
            </>
          )}
        </p>
      )}

      {/* The evidence, last and quietest: it explains the verdict, it is not it. */}
      <p className="hero-foot">{report.because}</p>
    </section>
  );
}

/* -- totals --------------------------------------------------------------- */

function Totals({ report, days }: { report: PowerSummary; days: number }): React.JSX.Element {
  const wifiUp = report.totals.mains + report.totals.battery;
  const observed = wifiUp + report.totals.off;
  const wifiPct = observed > 0 ? (wifiUp / observed) * 100 : 0;
  const mainsPct = observed > 0 ? (report.totals.mains / observed) * 100 : 0;

  const total = Object.values(report.totals).reduce((a, v) => a + v, 0) || 1;
  const order: PowerState[] = ['mains', 'battery', 'off', 'unknown'];

  return (
    <Card title={days === 1 ? 'Last 24 hours' : `Last ${days} days`}>
      <Hero
        value={observed === 0 ? '—' : wifiPct.toFixed(1)}
        unit={observed === 0 ? undefined : '%'}
        tone={wifiPct >= 95 ? 'good' : wifiPct >= 80 ? 'warn' : 'bad'}
        caption={`Wi-Fi was up this share of the period · ${mainsPct.toFixed(0)}% of it on mains`}
      />

      {/* Where the period actually went. Stacked, with a gap between segments. */}
      <div className="share-bar" role="img" aria-label="Share of the period on each power source">
        {order.map((state) => {
          const pct = (report.totals[state] / total) * 100;
          if (pct <= 0) return null;
          return (
            <span key={state} className={`share-seg share-${state}`} style={{ width: `${pct}%` }} />
          );
        })}
      </div>
      <ul className="share-legend">
        {order.map((state) =>
          report.totals[state] > 0 ? (
            <li key={state}>
              <span className={`share-key share-${state}`} aria-hidden="true" />
              <span>
                {state === 'off'
                  ? 'No power'
                  : state === 'unknown'
                    ? 'Not observed'
                    : STATE[state].title}
              </span>
              <span className="muted">{formatDuration(report.totals[state])}</span>
            </li>
          ) : null,
        )}
      </ul>

      <StatGrid>
        <Stat
          label="On mains"
          value={formatDuration(report.totals.mains)}
          tone="good"
          hint={`${mainsPct.toFixed(0)}% of period`}
        />
        <Stat
          label="On battery"
          value={formatDuration(report.totals.battery)}
          tone={report.totals.battery > 0 ? 'warn' : 'neutral'}
          hint="Wi-Fi stayed up"
        />
        <Stat
          label="No power"
          value={formatDuration(report.totals.off)}
          tone={report.totals.off > 0 ? 'bad' : 'good'}
          hint={`${report.mainsCuts} ${report.mainsCuts === 1 ? 'cut' : 'cuts'}`}
        />
        <Stat
          label="Battery lasts"
          value={
            report.batteryRuntimeSec === null
              ? 'Not measured'
              : formatDuration(report.batteryRuntimeSec)
          }
          hint={
            report.longestBatteryHoldSec === null
              ? 'never run flat yet'
              : `longest hold ${formatDuration(report.longestBatteryHoldSec)}`
          }
        />
      </StatGrid>
    </Card>
  );
}

/* -- day by day ----------------------------------------------------------- */

const DAY_MS = 86_400_000;

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * The period as one cell a day.
 *
 * The heatmap further down answers "when do cuts start" and the timeline above
 * answers "what happened this afternoon". Neither answers the question you
 * actually arrive at this screen with after a bad week, which is whether the
 * bad days are clustered or spread - and that is a question about sequence, so
 * this runs oldest to newest and today wears a ring rather than a colour.
 *
 * A cell is coloured by the worst thing that happened that day and shaded by
 * how much of the day it took, which keeps a twenty-minute cut and a whole
 * dark day from looking identical without spending a second colour on the
 * difference. Days with nothing recorded are outlines: this monitor is off
 * whenever the machine it runs on is, and an unwatched day that renders as a
 * pale good day is the one failure mode that would make the grid worth less
 * than nothing.
 */
function DayByDay({ report, days }: { report: PowerSummary; days: number }): React.JSX.Element {
  const now = Date.now();
  const to = Math.min(report.window.to, now);

  /* Seconds per state per local day. Spans are clipped to the window first,
     then walked across midnight boundaries, because a span that starts at
     22:00 and ends at 02:00 belongs to two days. */
  const buckets = new Map<number, Record<PowerState, number>>();
  const bucket = (key: number): Record<PowerState, number> => {
    let b = buckets.get(key);
    if (b === undefined) {
      b = { mains: 0, battery: 0, off: 0, unknown: 0 };
      buckets.set(key, b);
    }
    return b;
  };

  for (const span of report.spans) {
    const from = Math.max(span.start, report.window.from);
    const end = Math.min(span.end ?? now, to);
    if (end <= from) continue;

    let cursor = from;
    while (cursor < end) {
      const dayStart = startOfDay(cursor);
      const nextDay = dayStart + DAY_MS;
      const chunkEnd = Math.min(end, nextDay);
      bucket(dayStart)[span.state] += (chunkEnd - cursor) / 1000;
      cursor = chunkEnd;
    }
  }

  const today = startOfDay(now);
  const cells: DayCell[] = [];
  let clean = 0;
  let touched = 0;

  for (let i = days - 1; i >= 0; i--) {
    const dayStart = today - i * DAY_MS;
    const b = buckets.get(dayStart);
    const date = new Date(dayStart).toLocaleDateString(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
    const observed = b === undefined ? 0 : b.mains + b.battery + b.off;

    if (observed === 0) {
      cells.push({ key: String(dayStart), label: `${date} — not watched`, tone: 'none' });
      continue;
    }

    const bad = (b as Record<PowerState, number>).off;
    const warn = (b as Record<PowerState, number>).battery;

    if (bad > 0) {
      cells.push({
        key: String(dayStart),
        label: `${date} — ${formatDuration(Math.round(bad))} with no power`,
        tone: 'bad',
      });
    } else if (warn > 0) {
      cells.push({
        key: String(dayStart),
        label: `${date} — ${formatDuration(Math.round(warn))} on the pack`,
        tone: 'warn',
      });
      touched += 1;
    } else {
      cells.push({
        key: String(dayStart),
        label: `${date} — light on all day`,
        tone: 'good',
      });
      clean += 1;
    }
    if (bad > 0) touched += 1;
  }

  cells[cells.length - 1] = { ...(cells[cells.length - 1] as DayCell), today: true };

  const unwatched = cells.filter((c) => c.tone === 'none').length;

  return (
    <Card title={`Day by day, last ${days} days`}>
      <DayGrid
        cells={cells}
        label={`Power, one cell per day over the last ${days} days`}
        caption={
          <>
            {clean} clear · {touched} with a cut
            {unwatched > 0 ? ` · ${unwatched} not watched` : ''}
          </>
        }
      />
    </Card>
  );
}

/* -- patterns ------------------------------------------------------------- */

function Patterns({ report }: { report: PowerSummary }): React.JSX.Element | null {
  // Hooks first, always: this component used to call useState after an early
  // return, which broke the rules of hooks the moment the data arrived.
  const [picked, setPicked] = useState<{ day: number; hour: number; pct: number | null } | null>(
    null,
  );
  const theme = useResolvedTheme();

  const patterns = report.patterns;
  if (!patterns?.weeklyHeatmap?.length) return null;

  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const ends = SEQUENTIAL_ENDS[theme];

  return (
    <Card title="When the light is usually on">
      <StatGrid>
        <Stat
          label="Typical cut"
          value={
            patterns.medianOutageSec ? formatDuration(patterns.medianOutageSec) : 'Not enough data'
          }
          hint={patterns.totalOutagesAnalyzed ? `across ${patterns.totalOutagesAnalyzed} cuts` : undefined}
        />
        <Stat
          label="Light per day"
          value={patterns.averageMainsHoursPerDay ? `${patterns.averageMainsHoursPerDay} hrs` : '—'}
          tone={
            patterns.averageMainsHoursPerDay && patterns.averageMainsHoursPerDay >= 18
              ? 'good'
              : patterns.averageMainsHoursPerDay && patterns.averageMainsHoursPerDay >= 12
                ? 'warn'
                : 'bad'
          }
          hint="average"
        />
        <Stat
          label="Cuts usually start"
          value={
            patterns.peakOutageHours.length
              ? patterns.peakOutageHours.map((h) => `${String(h).padStart(2, '0')}:00`).join(', ')
              : 'No pattern'
          }
        />
        <Stat
          label="Longest run"
          value={
            patterns.longestMainsStreakSec ? formatDuration(patterns.longestMainsStreakSec) : '—'
          }
          tone="good"
          hint="unbroken mains"
        />
      </StatGrid>

      <div className="heatmap">
        <div className="heatmap-hours" aria-hidden="true">
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h}>{h % 6 === 0 ? String(h).padStart(2, '0') : ''}</span>
          ))}
        </div>
        {patterns.weeklyHeatmap.map((row, d) => (
          <div key={d} className="heatmap-row">
            <span className="heatmap-day">{days[d]}</span>
            <div className="heatmap-cells">
              {row.map((pct, h) => (
                <button
                  key={h}
                  type="button"
                  className={`heatmap-cell ${pct === null ? 'no-data' : ''}`}
                  {...(pct === null ? {} : { style: { background: sequential(pct / 100, theme) } })}
                  aria-label={
                    pct === null
                      ? `${days[d]} ${String(h).padStart(2, '0')}:00, not recorded`
                      : `${days[d]} ${String(h).padStart(2, '0')}:00, ${pct}% chance of light`
                  }
                  onMouseEnter={() => setPicked({ day: d, hour: h, pct })}
                  onFocus={() => setPicked({ day: d, hour: h, pct })}
                  onClick={() => setPicked({ day: d, hour: h, pct })}
                />
              ))}
            </div>
          </div>
        ))}

        <div className="heatmap-foot">
          <span className="heatmap-scale">
            <span className="muted">Never</span>
            <span
              className="heatmap-ramp"
              style={{ background: `linear-gradient(90deg, ${ends.low}, ${ends.high})` }}
            />
            <span className="muted">Always</span>
            <span className="heatmap-scale-gap">
              <span className="heatmap-key-empty" aria-hidden="true" />
              Not recorded
            </span>
          </span>
          {picked && (
            <span className="heatmap-readout">
              {days[picked.day]} {String(picked.hour).padStart(2, '0')}:00 —{' '}
              {picked.pct === null ? 'not recorded' : `${picked.pct}% chance of light`}
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}

/* -- reliability of the line itself --------------------------------------- */

function Reliability({ report, days }: { report: UptimeReport; days: number }): React.JSX.Element {
  const ispSeconds = Object.entries(report.byKind)
    .filter(([k]) => meta(k).blame === 'ISP')
    .reduce((a, [, v]) => a + v.downtimeSec, 0);

  return (
    <Card title={days === 1 ? 'Line, last 24 hours' : `Line, last ${days} days`}>
      <Hero
        value={report.uptimePct.toFixed(2)}
        unit="%"
        tone={report.uptimePct >= 99.5 ? 'good' : report.uptimePct >= 98 ? 'warn' : 'bad'}
        caption="of the measured period the line was usable"
      />

      <StatGrid>
        <Stat
          label="Total downtime"
          value={formatDuration(report.totalDowntimeSec)}
          tone={report.totalDowntimeSec > 0 ? 'warn' : 'good'}
        />
        <Stat
          label="Outages"
          value={report.incidentCount}
          tone={report.incidentCount > 0 ? 'warn' : 'good'}
        />
        <Stat
          label="Down to the ISP"
          value={formatDuration(ispSeconds)}
          tone={ispSeconds > 0 ? 'bad' : 'good'}
          hint="fibre and routing faults"
        />
      </StatGrid>
    </Card>
  );
}

function Breakdown({ report }: { report: UptimeReport }): React.JSX.Element | null {
  const kinds = Object.entries(report.byKind).sort((a, b) => b[1].downtimeSec - a[1].downtimeSec);
  if (kinds.length === 0) return null;

  const total = kinds.reduce((a, [, v]) => a + v.downtimeSec, 0);

  return (
    <Card title="What went wrong">
      {/*
        Sorted rows, the fault on the left and the time it cost on the right.
        There used to be a proportional bar under each title as well, which was
        a third telling of a thing the order and the duration had both already
        said - and it is the one every reference app leaves out. What replaces
        it is the share, which is the only part the bar carried that the
        duration does not.
      */}
      <List>
        {kinds.map(([kind, v]) => {
          const m = meta(kind);
          return (
            <ListRow
              key={kind}
              icon={kindIcon(kind)}
              tone={m.tone}
              title={m.title}
              sub={`${v.count} ${v.count === 1 ? 'time' : 'times'} · ${m.blame}`}
              value={formatDuration(v.downtimeSec)}
              valueSub={total > 0 ? `${Math.round((v.downtimeSec / total) * 100)}% of it` : undefined}
            />
          );
        })}
      </List>
    </Card>
  );
}

/**
 * A glyph per fault kind.
 *
 * The list is scannable before it is read only if the wells differ, and the
 * tone alone cannot do it - two of these kinds are amber and two are red. The
 * mapping is literal on purpose: the fibre, the route out, the box in the
 * hallway, the name server.
 */
function kindIcon(kind: string): React.JSX.Element {
  switch (kind) {
    case 'pon_down':
      return <LineIcon size={17} />;
    case 'wan_down':
      return <GlobeIcon size={17} />;
    case 'ont_unreachable':
      return <RouterIcon size={17} />;
    case 'dns_failure':
      return <ServerIcon size={17} />;
    case 'degraded':
      return <SpeedometerIcon size={17} />;
    case 'collector_down':
      return <EyeOffIcon size={17} />;
    default:
      return <AlertTriangleIcon size={17} />;
  }
}

function Outages({
  incidents,
  onChange,
}: {
  incidents: Incident[];
  onChange: () => void;
}): React.JSX.Element {
  const ordered = [...incidents].sort((a, b) => b.start - a.start);

  return (
    <Card title="Every outage">
      {ordered.length === 0 ? (
        <p className="muted">No outages recorded in this period.</p>
      ) : (
        <ol className="timeline">
          {ordered.map((inc) => (
            <IncidentRow key={inc.id} incident={inc} onChange={onChange} />
          ))}
        </ol>
      )}
    </Card>
  );
}

function IncidentRow({
  incident,
  onChange,
}: {
  incident: Incident;
  onChange: () => void;
}): React.JSX.Element {
  const m = meta(incident.kind);
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(incident.note ?? '');
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      await endpoints.annotate(incident.id, note.trim());
      setEditing(false);
      showToast('Note saved', 'success');
      onChange();
    } catch {
      showToast('Could not save the note', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <li className={`timeline-row ${open ? 'open' : ''}`}>
      <span className={`timeline-dot tone-${m.tone}`} aria-hidden="true" />
      <div className="timeline-body">
        <div className="timeline-head">
          <span className="timeline-title">{m.title}</span>
          <Badge tone={incident.end === null ? 'bad' : m.tone}>
            {incident.end === null ? 'Ongoing' : formatDuration(incident.durationSec ?? 0)}
          </Badge>
        </div>
        <span className="timeline-when">
          {localTime(incident.start)}
          {incident.end !== null && ` → ${localTime(incident.end)}`} · {m.blame}
        </span>
        {/* Tap to unclamp; several kinds share a long boilerplate explanation. */}
        <button
          type="button"
          className="timeline-detail"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {incident.detail}
        </button>

        {incident.note !== null && !editing && <p className="timeline-note">{incident.note}</p>}

        {editing ? (
          <div className="timeline-note-edit">
            <textarea
              className="input"
              rows={3}
              maxLength={2000}
              value={note}
              placeholder="What did the ISP say? Ticket number, what fixed it…"
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="device-edit-actions">
              <Button size="sm" variant="primary" busy={saving} onClick={() => void save()}>
                Save note
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <button type="button" className="link" onClick={() => setEditing(true)}>
            {incident.note === null ? 'Add a note' : 'Edit note'}
          </button>
        )}
      </div>
    </li>
  );
}
