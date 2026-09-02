import { useState } from 'react';
import { formatBytes, type UsageBucket } from '@waifai/shared';
import { Figure } from './ui.tsx';

/**
 * Daily data volume.
 *
 * A column per day, capped in thickness and separated by a gap in the surface
 * colour rather than by a stroke. Only the busiest day gets a direct label -
 * a number over every column is the thing that makes a chart unreadable.
 */
export function DailyBars({ days }: { days: UsageBucket[] }): React.JSX.Element | null {
  const [picked, setPicked] = useState<number | null>(null);
  if (days.length === 0) return null;

  const totals = days.map((d) => d.downBytes + d.upBytes);
  const peak = Math.max(...totals, 1);
  const peakIndex = totals.indexOf(peak);
  const active = picked ?? peakIndex;
  const shown = days[active];

  return (
    <div className="bars">
      <div className="bars-readout">
        {shown && (
          <>
            <span className="bars-readout-value">
              <Figure>{formatBytes(totals[active] ?? 0)}</Figure>
            </span>
            <span className="bars-readout-day">
              {new Date(`${shown.day}T12:00:00`).toLocaleDateString(undefined, {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
              })}
              {active === peakIndex && picked === null ? ' · busiest day' : ''}
            </span>
          </>
        )}
      </div>

      <div className="bars-plot" onMouseLeave={() => setPicked(null)}>
        {days.map((d, i) => {
          const total = totals[i] ?? 0;
          return (
            <button
              key={d.day}
              type="button"
              className={`bars-col ${i === active ? 'active' : ''}`}
              aria-label={`${d.day}: ${formatBytes(total)}`}
              onMouseEnter={() => setPicked(i)}
              onFocus={() => setPicked(i)}
              onClick={() => setPicked(i)}
            >
              <span className="bars-bar" style={{ height: `${Math.max(2, (total / peak) * 100)}%` }} />
            </button>
          );
        })}
      </div>

      <div className="bars-axis">
        <span>{label(days[0])}</span>
        <span>{label(days[days.length - 1])}</span>
      </div>
    </div>
  );
}

function label(bucket: UsageBucket | undefined): string {
  if (!bucket) return '';
  return new Date(`${bucket.day}T12:00:00`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });
}
