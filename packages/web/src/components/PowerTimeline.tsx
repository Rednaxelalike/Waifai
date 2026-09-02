import { useMemo, useState } from 'react';
import { formatDuration, type Incident, type PowerSpan, type PowerState } from '@waifai/shared';
import { localTime } from './ui.tsx';
import { incidentMeta } from '../lib/incidents.ts';

/**
 * The light and the internet, drawn on one axis.
 *
 * This is the whole reason Power and History stopped being two screens. After
 * every outage the question is the same - "was that NEPA, or was that MTN?" -
 * and answering it used to mean holding a timestamp in your head while you
 * changed tabs. Stacked on a shared axis the answer is a glance: a red bar on
 * the lower track with mains underneath it is the ISP's fault and worth a
 * complaint, the same red bar sitting over a black stretch is just the light
 * being off and worth nothing.
 *
 * Deliberately not a charting library. Two rows of blocks against a linear
 * time scale is `left: %` and `width: %`, and every charting option costs more
 * bytes than the entire page it would sit on.
 */

const POWER_LABEL: Record<PowerState, string> = {
  mains: 'Light on',
  battery: 'On the battery pack',
  off: 'No power',
  unknown: 'Not observed',
};

interface Block {
  key: string;
  left: number;
  width: number;
  className: string;
  title: string;
  when: string;
  detail: string;
}

export function PowerTimeline({
  from,
  to,
  spans,
  incidents,
}: {
  from: number;
  to: number;
  spans: PowerSpan[];
  incidents: Incident[];
}): React.JSX.Element {
  const [picked, setPicked] = useState<Block | null>(null);
  const width = Math.max(1, to - from);

  const place = (start: number, end: number | null): { left: number; width: number } | null => {
    const a = Math.max(from, start);
    const b = Math.min(to, end ?? Date.now());
    if (b <= a) return null;
    return { left: ((a - from) / width) * 100, width: ((b - a) / width) * 100 };
  };

  const power = useMemo(
    () =>
      spans.flatMap((s): Block[] => {
        const box = place(s.start, s.end);
        if (!box) return [];
        return [
          {
            key: `p${s.id}`,
            ...box,
            className: `tl-block tl-${s.state}`,
            title: POWER_LABEL[s.state],
            when: `${localTime(s.start)}${s.end === null ? ' → now' : ''}`,
            detail:
              (s.durationSec === null ? 'Still going.' : `${formatDuration(s.durationSec)}.`) +
              (s.source === 'reconstructed' ? ' Worked out afterwards from the router clock.' : ''),
          },
        ];
      }),
    // Recomputing on every render would rebuild this on each hover.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [spans, from, to],
  );

  const outages = useMemo(
    () =>
      incidents.flatMap((inc): Block[] => {
        const box = place(inc.start, inc.end);
        if (!box) return [];
        return [
          {
            key: `i${inc.id}`,
            ...box,
            className: `tl-block tl-outage sev-${inc.severity}`,
            title: incidentMeta(inc.kind).title,
            when: `${localTime(inc.start)}${inc.end === null ? ' → now' : ''}`,
            detail: inc.detail,
          },
        ];
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [incidents, from, to],
  );

  /* Four evenly spaced marks. More than that and the labels collide on a phone. */
  const ticks = useMemo(() => {
    const span = to - from;
    const dayScale = span > 36 * 3_600_000;
    return Array.from({ length: 4 }, (_, i) => {
      const ts = from + (span * (i + 1)) / 5;
      return {
        left: ((i + 1) / 5) * 100,
        label: dayScale
          ? new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
          : new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
      };
    });
  }, [from, to]);

  return (
    <div className="timeline-strip">
      <Track
        label="Light"
        blocks={power}
        ticks={ticks}
        picked={picked}
        onPick={setPicked}
        emptyClass="tl-unknown"
      />
      <Track
        label="Internet"
        blocks={outages}
        ticks={ticks}
        picked={picked}
        onPick={setPicked}
        emptyClass="tl-up"
      />

      <div className="timeline-scale" aria-hidden="true">
        {ticks.map((t) => (
          <span key={t.left} style={{ left: `${t.left}%` }}>
            {t.label}
          </span>
        ))}
      </div>

      <div className="timeline-axis" aria-hidden="true">
        <span>{localTime(from)}</span>
        <span>now</span>
      </div>

      {/*
        One readout under both tracks rather than a tooltip per block: a
        tooltip on a phone is a thing under your thumb, and the answer here is
        two lines long.
      */}
      <p className="timeline-readout" aria-live="polite">
        {picked === null ? (
          <span className="muted">Tap a band to see what it was.</span>
        ) : (
          <>
            <strong>{picked.title}</strong> · {picked.when} · {picked.detail}
          </>
        )}
      </p>
    </div>
  );
}

function Track({
  label,
  blocks,
  ticks,
  picked,
  onPick,
  emptyClass,
}: {
  label: string;
  blocks: Block[];
  ticks: { left: number; label: string }[];
  picked: Block | null;
  onPick: (b: Block) => void;
  emptyClass: string;
}): React.JSX.Element {
  return (
    <div className="timeline-track">
      <span className="timeline-track-label">{label}</span>
      <div className={`timeline-lane ${emptyClass}`}>
        {ticks.map((t) => (
          <span key={t.left} className="timeline-tick" style={{ left: `${t.left}%` }} aria-hidden="true" />
        ))}
        {blocks.map((b) => (
          <button
            key={b.key}
            type="button"
            className={`${b.className} ${picked?.key === b.key ? 'picked' : ''}`}
            style={{ left: `${b.left}%`, width: `${Math.max(0.6, b.width)}%` }}
            aria-label={`${b.title}, ${b.when}`}
            onClick={() => onPick(b)}
            onMouseEnter={() => onPick(b)}
            onFocus={() => onPick(b)}
          />
        ))}
      </div>
    </div>
  );
}
