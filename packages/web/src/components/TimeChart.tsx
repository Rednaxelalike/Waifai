import { useEffect, useMemo, useRef, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { Checkbox } from './ui.tsx';

export interface ChartSeries {
  label: string;
  values: (number | null)[];
  color: string;
  /** Draw a gradient wash under the line. Only meaningful on the first series. */
  area?: boolean;
  dash?: number[];
  /** Thin, dimmed line - used for the min/max envelope around a mean. */
  subdued?: boolean;
}

interface Props {
  timestamps: number[];
  series: ChartSeries[];
  height?: number;
  format?: (v: number) => string;
  threshold?: { value: number; label: string };
  emptyMessage?: string;
  /** Label the highest and lowest reading on the plot. On by default. */
  markExtremes?: boolean;
}

/** Colours are read from CSS so the chart and the page can never drift apart. */
function chrome(host: HTMLElement): {
  grid: string;
  axis: string;
  ink: string;
  surface: string;
  danger: string;
} {
  const s = getComputedStyle(host);
  const get = (n: string, fallback: string): string => s.getPropertyValue(n).trim() || fallback;
  return {
    grid: get('--chart-grid', '#E3E5E8'),
    axis: get('--ink-muted', '#5C5E66'),
    ink: get('--ink-2', '#4E5058'),
    surface: get('--surface', '#FFFFFF'),
    danger: get('--bad', '#DA373C'),
  };
}

const FONT_STACK = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

/** uPlot scales `axes[].font` by the device pixel ratio; hook-drawn text is ours. */
const AXIS_FONT = `500 11px ${FONT_STACK}`;

function ratio(): number {
  return typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
}

function canvasFont(): string {
  return `500 ${Math.round(11 * ratio())}px ${FONT_STACK}`;
}

/**
 * Time series chart.
 *
 * Built on uPlot because a Pi serving phones over Wi-Fi cannot afford a
 * 300 kB charting library, but everything visible here is ours: uPlot's own
 * legend and tooltip are switched off in favour of a crosshair readout that
 * shows every series at the hovered instant.
 *
 * Two details matter for it to feel solid rather than twitchy. The plot is
 * rebuilt only when its *structure* changes - series identity, height, theme -
 * and merely re-fed when the numbers change, so a poll arriving does not throw
 * away the reader's cursor. And the tooltip is written straight to the DOM
 * instead of through React state, so moving a finger across the chart does not
 * re-render the page underneath it.
 */
export function TimeChart({
  timestamps,
  series,
  height = 200,
  format = (v) => String(Math.round(v * 100) / 100),
  threshold,
  emptyMessage = 'Nothing recorded for this period yet.',
  markExtremes = true,
}: Props): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<uPlot | null>(null);
  const [theme, setTheme] = useState<string>(
    () => document.documentElement.dataset['theme'] ?? 'light',
  );

  /*
   * Which lines are switched off, held by label.
   *
   * Held by label rather than by index because the parent rebuilds the series
   * array on every poll, and an index would move under a device that dropped
   * out of the set between two renders.
   */
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());

  // Latest props, readable from inside uPlot hooks without making them deps.
  const latest = useRef({ timestamps, series, format, threshold });
  latest.current = { timestamps, series, format, threshold };

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setTheme(root.dataset['theme'] ?? 'light'));
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  /** Identity of the plot, as opposed to its contents. */
  const shape = useMemo(
    () => series.map((s) => `${s.label}~${s.color}~${s.area ? 'a' : ''}${s.subdued ? 's' : ''}`).join('|'),
    [series],
  );

  /** Cheap content signature - enough to notice new data without hashing it. */
  const dataKey = useMemo(() => {
    const first = timestamps[0] ?? 0;
    const last = timestamps[timestamps.length - 1] ?? 0;
    const tail = series.map((s) => s.values[s.values.length - 1] ?? 'n').join(',');
    return `${timestamps.length}:${first}:${last}:${tail}`;
  }, [timestamps, series]);

  /*
   * One point is not a time series - there is nothing to draw a line between,
   * and uPlot answers a zero-width x range with a multi-year axis. The value
   * itself is always shown as a stat beside the chart, so nothing is lost.
   */
  const isEmpty = timestamps.length < 2;

  useEffect(() => {
    const host = hostRef.current;
    if (!host || isEmpty) return;

    const c = chrome(host);
    const spec = latest.current.series;

    const tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.setAttribute('aria-hidden', 'true');
    host.appendChild(tip);

    /*
     * Axis badges.
     *
     * Borrowed wholesale from a trading chart, because that is the one place
     * this problem has been solved properly: the crosshair alone tells you
     * *where* you are but not *what* the value is, so each arm ends in a badge
     * that covers the axis label it is sitting on. Reading a chart stops
     * needing a second glance at the gridline.
     */
    const yBadge = document.createElement('div');
    yBadge.className = 'chart-axis-badge chart-axis-badge-y';
    yBadge.setAttribute('aria-hidden', 'true');
    host.appendChild(yBadge);

    const xBadge = document.createElement('div');
    xBadge.className = 'chart-axis-badge chart-axis-badge-x';
    xBadge.setAttribute('aria-hidden', 'true');
    host.appendChild(xBadge);

    const opts: uPlot.Options = {
      width: host.clientWidth || 320,
      height,
      padding: [16, 10, 0, 0],
      legend: { show: false },
      cursor: {
        drag: { x: false, y: false },
        // Fat enough to catch a fingertip, which the default is not.
        points: { size: 9, width: 2, stroke: () => c.surface },
        focus: { prox: 24 },
      },
      scales: {
        x: {
          time: true,
          /*
           * With one sample the min and max collapse and uPlot falls back to a
           * multi-year span, so a single speed test drew an axis labelled
           * 2027-2029. Give a degenerate range an hour on either side instead.
           */
          range: (_u, min, max) =>
            min === max ? [min - 1800, max + 1800] : [min, max],
        },
      },
      axes: [
        {
          stroke: c.axis,
          font: AXIS_FONT,
          size: 28,
          // Vertical rules add ink without adding information on a time axis.
          grid: { show: false },
          ticks: { show: false },
        },
        {
          stroke: c.axis,
          font: AXIS_FONT,
          /*
           * Measured rather than guessed. A fixed gutter clipped "150.0 Mbps"
           * down to ".0 Mbps", and the width that fits depends on the unit,
           * the value range and the device pixel ratio.
           */
          size: (u, values) => {
            const { ctx } = u;
            ctx.save();
            ctx.font = canvasFont();
            let widest = 0;
            for (const v of values ?? []) widest = Math.max(widest, ctx.measureText(String(v)).width);
            ctx.restore();
            return Math.ceil(widest / ratio()) + 14;
          },
          grid: { stroke: c.grid, width: 1 },
          ticks: { show: false },
          /*
           * Drop repeats.
           *
           * uPlot chooses tick positions from the data range, not from the
           * precision the formatter prints at, so a line that only moves
           * across 0.2 dBm produced an axis reading -12.6, -12.6, -12.6,
           * -12.6. Collapsing consecutive duplicates to null leaves the
           * gridline but drops the label, which is the honest thing to show:
           * those rows really are the same number.
           */
          values: (_u, splits) => {
            let previous: string | null = null;
            return splits.map((v) => {
              const text = latest.current.format(v);
              if (text === previous) return null;
              previous = text;
              return text;
            });
          },
        },
      ],
      series: [
        {},
        ...spec.map((s): uPlot.Series => {
          const width = s.subdued ? 1 : 2;
          return {
            label: s.label,
            stroke: s.color,
            width,
            ...(s.dash ? { dash: s.dash } : {}),
            ...(s.subdued ? { alpha: 0.45 } : {}),
            spanGaps: false,
            points: { show: false },
            ...(s.area
              ? {
                  fill: (u: uPlot) => {
                    const g = u.ctx.createLinearGradient(
                      0,
                      u.bbox.top,
                      0,
                      u.bbox.top + u.bbox.height,
                    );
                    g.addColorStop(0, `${s.color}2E`);
                    g.addColorStop(1, `${s.color}00`);
                    return g;
                  },
                }
              : {}),
          };
        }),
      ],
      hooks: {
        draw: [
          /*
           * The last-value tag.
           *
           * A dashed rule at the most recent reading, ending in a filled tag
           * over the axis. On a line that has wandered, "where is it *now*"
           * is the first question asked and the hardest to answer by eye, so
           * it is answered before anyone has to hover.
           */
          (u) => {
            const spec = latest.current.series;
            const lead = spec.find((s) => s.subdued !== true) ?? spec[0];
            if (!lead) return;

            let value: number | null = null;
            for (let i = lead.values.length - 1; i >= 0; i--) {
              const v = lead.values[i];
              if (v !== null && v !== undefined && Number.isFinite(v)) {
                value = v;
                break;
              }
            }
            if (value === null) return;

            const y = u.valToPos(value, 'y', true);
            if (!Number.isFinite(y) || y < u.bbox.top || y > u.bbox.top + u.bbox.height) return;

            const { ctx } = u;
            const dpr = ratio();
            const text = latest.current.format(value);

            ctx.save();
            ctx.font = canvasFont();

            ctx.strokeStyle = lead.color;
            ctx.globalAlpha = 0.5;
            ctx.setLineDash([3 * dpr, 3 * dpr]);
            ctx.lineWidth = dpr;
            ctx.beginPath();
            ctx.moveTo(u.bbox.left, y);
            ctx.lineTo(u.bbox.left + u.bbox.width, y);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.globalAlpha = 1;

            const padX = 5 * dpr;
            const w = ctx.measureText(text).width + padX * 2;
            const h = 15 * dpr;
            const x = u.bbox.left + u.bbox.width - w;
            const top = Math.min(
              u.bbox.top + u.bbox.height - h,
              Math.max(u.bbox.top, y - h / 2),
            );

            ctx.fillStyle = lead.color;
            ctx.beginPath();
            if (typeof ctx.roundRect === 'function') ctx.roundRect(x, top, w, h, 3 * dpr);
            else ctx.rect(x, top, w, h);
            ctx.fill();

            ctx.fillStyle = '#FFFFFF';
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'left';
            ctx.fillText(text, x + padX, top + h / 2);
            ctx.restore();
          },
          /*
           * High and low markers.
           *
           * The extremes are the two points a reader looks for and the two a
           * line chart hides best, because finding them means scanning the
           * whole trace. Labelling them in place turns "how bad did it get?"
           * into something answered at a glance - and it is the one thing a
           * summary stat beside the chart cannot do, since it cannot say
           * *when* it happened.
           */
          (u) => {
            const spec = latest.current.series;
            const lead = spec.find((s) => s.subdued !== true) ?? spec[0];
            if (!lead || !markExtremes) return;

            let hiI = -1;
            let loI = -1;
            for (let i = 0; i < lead.values.length; i++) {
              const v = lead.values[i];
              if (v === null || v === undefined || !Number.isFinite(v)) continue;
              if (hiI === -1 || v > (lead.values[hiI] as number)) hiI = i;
              if (loI === -1 || v < (lead.values[loI] as number)) loI = i;
            }
            // A flat line has no meaningful high and low to point at.
            if (hiI === -1 || loI === -1 || hiI === loI) return;

            const { ctx } = u;
            const dpr = ratio();
            ctx.save();
            ctx.font = canvasFont();
            ctx.textBaseline = 'middle';

            for (const [idx, side] of [
              [hiI, 'high'],
              [loI, 'low'],
            ] as const) {
              const value = lead.values[idx] as number;
              const x = u.valToPos(u.data[0]?.[idx] as number, 'x', true);
              const y = u.valToPos(value, 'y', true);
              if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

              const text = latest.current.format(value);
              const w = ctx.measureText(text).width;
              const gap = 7 * dpr;
              // Flip the label inboard when the point is near an edge.
              const toLeft = x + gap + w > u.bbox.left + u.bbox.width;
              const tx = toLeft ? x - gap - w : x + gap;
              /*
               * Both labels sit above their point rather than beside it. Level
               * with the point, the low one landed in the same row as the
               * bottom axis label and the two ran together - "0 bps 102.7
               * Kbps" reads as one number. Clamped so neither escapes the plot.
               */
              const lift = side === 'high' ? 11 * dpr : 12 * dpr;
              const ty = Math.min(
                u.bbox.top + u.bbox.height - 7 * dpr,
                Math.max(u.bbox.top + 7 * dpr, y - lift),
              );

              ctx.fillStyle = c.surface;
              ctx.beginPath();
              ctx.arc(x, y, 3.5 * dpr, 0, Math.PI * 2);
              ctx.fill();
              ctx.strokeStyle = lead.color;
              ctx.lineWidth = 2 * dpr;
              ctx.stroke();

              ctx.fillStyle = c.ink;
              ctx.textAlign = 'left';
              ctx.fillText(text, tx, ty);
            }
            ctx.restore();
          },
          (u) => {
            const t = latest.current.threshold;
            if (!t) return;
            const y = u.valToPos(t.value, 'y', true);
            if (!Number.isFinite(y)) return;
            const { ctx } = u;
            ctx.save();
            ctx.strokeStyle = c.danger;
            ctx.globalAlpha = 0.7;
            ctx.setLineDash([4, 4]);
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(u.bbox.left, y);
            ctx.lineTo(u.bbox.left + u.bbox.width, y);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.globalAlpha = 1;
            ctx.fillStyle = c.axis;
            ctx.font = canvasFont();
            ctx.textBaseline = 'bottom';
            ctx.fillText(t.label, u.bbox.left + 6, y - 5);
            ctx.restore();
          },
        ],
        setCursor: [
          (u) => {
            const idx = u.cursor.idx;
            const left = u.cursor.left ?? -1;
            const top = u.cursor.top ?? -1;
            if (idx === null || idx === undefined || left < 0) {
              tip.classList.remove('is-on');
              yBadge.classList.remove('is-on');
              xBadge.classList.remove('is-on');
              return;
            }

            // Value under the pointer, read off the y scale rather than the data,
            // so the badge tracks the crosshair and not the nearest sample.
            if (top >= 0) {
              const atCursor = u.posToVal(top, 'y');
              if (Number.isFinite(atCursor)) {
                yBadge.textContent = latest.current.format(atCursor);
                yBadge.style.top = `${top}px`;
                yBadge.classList.add('is-on');
              }
            }

            const stamp = latest.current.timestamps[idx];
            if (stamp !== undefined) {
              xBadge.textContent = new Date(stamp).toLocaleTimeString(undefined, {
                hour: '2-digit',
                minute: '2-digit',
              });
              xBadge.style.left = `${left}px`;
              xBadge.classList.add('is-on');
            }
            const { timestamps: ts, series: sx, format: fmt } = latest.current;
            const when = ts[idx];
            const rows = sx
              .map((s, i) => {
                // A hidden line is not on the plot, so it is not in the card
                // either - a readout listing a series you cannot see is the
                // fastest way to make someone doubt the chart.
                if (u.series[i + 1]?.show === false) return '';
                const v = s.values[idx];
                if (v === null || v === undefined || !Number.isFinite(v)) return '';
                return `<div class="chart-tip-row"><span class="chart-tip-key" style="background:${s.color}"></span><span class="chart-tip-name">${s.label}</span><span class="chart-tip-val">${fmt(v)}</span></div>`;
              })
              .join('');
            if (!rows) {
              tip.classList.remove('is-on');
              return;
            }
            tip.innerHTML = `<div class="chart-tip-when">${
              when === undefined ? '' : new Date(when).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
            }</div>${rows}`;
            tip.classList.add('is-on');

            // Keep the card inside the plot rather than letting it clip.
            const w = tip.offsetWidth;
            const max = host.clientWidth - w - 6;
            tip.style.left = `${Math.max(6, Math.min(max, left - w / 2))}px`;
          },
        ],
      },
    };

    const data: uPlot.AlignedData = [
      latest.current.timestamps.map((t) => t / 1000),
      ...spec.map((s) => s.values),
    ] as uPlot.AlignedData;

    const plot = new uPlot(opts, data, host);
    plotRef.current = plot;

    const ro = new ResizeObserver(() => {
      const w = host.clientWidth;
      if (w > 0) plot.setSize({ width: w, height });
    });
    ro.observe(host);

    return () => {
      ro.disconnect();
      plot.destroy();
      tip.remove();
      yBadge.remove();
      xBadge.remove();
      plotRef.current = null;
    };
    // Structure only. Data changes are handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape, height, theme, isEmpty, markExtremes]);

  /*
   * uPlot toggles a series in place and redraws itself, so this deliberately
   * does not go through `shape` - putting visibility in the structure key
   * would tear the whole plot down and build it again to hide one line.
   * `shape` is a dependency only so the state is re-applied after a rebuild
   * that happened for some other reason.
   */
  useEffect(() => {
    const plot = plotRef.current;
    if (!plot || isEmpty) return;
    series.forEach((s, i) => {
      const show = !hidden.has(s.label);
      if (plot.series[i + 1]?.show !== show) plot.setSeries(i + 1, { show });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidden, shape, isEmpty]);

  useEffect(() => {
    const plot = plotRef.current;
    if (!plot || isEmpty) return;
    plot.setData([
      timestamps.map((t) => t / 1000),
      ...series.map((s) => s.values),
    ] as uPlot.AlignedData);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey, isEmpty]);

  if (isEmpty) {
    return (
      <div className="chart-empty" style={{ minHeight: height }}>
        <span>{timestamps.length === 1 ? 'Only one reading so far — a trend needs two.' : emptyMessage}</span>
      </div>
    );
  }

  return (
    <figure className="chart-figure">
      <div className="chart" ref={hostRef} />
      {series.length > 1 && (
        /*
         * The legend was a caption naming the colours. It is now the control
         * that owns them, which costs nothing in height and answers the one
         * question a two-line chart always raises: the download line is an
         * order of magnitude above the upload, so the upload is a flat line
         * along the axis until you take the download away.
         *
         * The last visible line cannot be switched off. An empty plot with a
         * full legend looks like the chart broke.
         */
        <figcaption className="chart-legend">
          {series.map((s) => {
            const on = !hidden.has(s.label);
            return (
              <span
                key={s.label}
                className={`chart-legend-item${s.subdued === true ? ' subdued' : ''}`}
              >
                <Checkbox
                  checked={on}
                  swatch={s.color}
                  label={s.label}
                  disabled={on && series.length - hidden.size === 1}
                  onChange={() =>
                    setHidden((prev) => {
                      const next = new Set(prev);
                      if (next.has(s.label)) next.delete(s.label);
                      else next.add(s.label);
                      return next;
                    })
                  }
                />
              </span>
            );
          })}
        </figcaption>
      )}
    </figure>
  );
}
