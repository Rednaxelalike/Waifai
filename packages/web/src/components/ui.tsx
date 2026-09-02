import { useEffect, useRef, type ReactNode } from 'react';
import { triggerHaptic } from './Toast.tsx';
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  CheckIcon,
  ChevronRightIcon,
  SearchIcon,
  SpinnerIcon,
  TrendingDownIcon,
  TrendingUpIcon,
  XIcon,
} from './icons.tsx';

export type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'accent';

/* -- containers ----------------------------------------------------------- */

export function Card({
  title,
  action,
  children,
  className = '',
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <section className={`card ${className}`.trim()}>
      {(title ?? action) && (
        <header className="card-head">
          {title && <h2>{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function StatGrid({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="stat-grid">{children}</div>;
}

/* -- values --------------------------------------------------------------- */

/**
 * The workhorse readout: a label, a number, and optionally one line saying what
 * the number means. Deliberately without an icon - a grid of four tiles each
 * wearing its own coloured badge is noise, and the label already says it.
 */
export function Stat({
  label,
  value,
  hint,
  delta,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  /** A `<Delta>`, on the label's line rather than the value's. Only where a real comparison exists. */
  delta?: ReactNode;
  tone?: Tone;
}): React.JSX.Element {
  return (
    <div className="stat">
      <span className="stat-head">
        <span className="stat-label">{label}</span>
        {delta}
      </span>
      <span className={`stat-value tone-${tone}`}>
        {/*
          A measurement gets the figure treatment; anything else - a Badge, a
          word - passes straight through, because Figure would render
          "Not measured" entirely in the quiet unit face.
        */}
        {typeof value === 'string' || typeof value === 'number' ? <Figure>{value}</Figure> : value}
      </span>
      {hint && <span className="stat-hint">{hint}</span>}
    </div>
  );
}

/** The one big number a view leads with. At most one per screen. */
export function Hero({
  value,
  unit,
  caption,
  tone = 'neutral',
}: {
  value: ReactNode;
  unit?: string;
  caption?: ReactNode;
  tone?: Tone;
}): React.JSX.Element {
  return (
    <div className="hero-figure">
      <span className={`hero-value tone-${tone}`}>
        {typeof value === 'string' || typeof value === 'number' ? (
          <Figure size="xl" unit={unit}>
            {value}
          </Figure>
        ) : (
          value
        )}
      </span>
      {caption && <span className="hero-caption">{caption}</span>}
    </div>
  );
}

/* -- figures --------------------------------------------------------------- */

/**
 * One measurement, drawn as a measurement.
 *
 * A formatted reading is three kinds of thing wearing one face: "212.4 GB" is
 * a magnitude, a precision and a unit, and setting all of it in one size and
 * one weight is what makes a number look typed rather than reported. Split,
 * the eye lands on "212" - the part any decision gets made on - and the ".4"
 * and the "GB" stay legible without competing for it.
 *
 * It takes the already-formatted string rather than a number and a unit,
 * because this app's formatters choose the unit themselves and every caller
 * would otherwise have to unpick "3h 12m" by hand. The scanner below does that
 * once: runs of digits are the figure, a fractional tail is quieter, and
 * everything else - units, separators, the h and m of a duration - is the
 * quiet face. A string with no digits in it at all ("No link", "Not measured")
 * is a sentence rather than a reading, and is left alone at full size.
 */
export function Figure({
  children,
  unit,
  size = 'md',
}: {
  children: string | number;
  /** Appended in the quiet face, for callers whose formatter omits it. */
  unit?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}): React.JSX.Element {
  const text = String(children);
  const parts = scanFigure(text);

  if (parts === null) return <span className={`fig fig-${size} is-words`}>{text}</span>;

  return (
    <span className={`fig fig-${size}`}>
      {parts.map((part, i) => (
        <span key={i} className={`fig-${part.kind}`}>
          {part.text}
        </span>
      ))}
      {unit !== undefined && <span className="fig-u"> {unit}</span>}
    </span>
  );
}

type FigurePart = { text: string; kind: 'n' | 'frac' | 'u' };

/** Null when there is no number in here at all, which means it is prose. */
function scanFigure(text: string): FigurePart[] | null {
  const parts: FigurePart[] = [];
  /*
   * A sign belongs to the digits only when it is immediately in front of them,
   * so "-24.6 dBm" keeps its minus at full size while a lone em-dash standing
   * in for a missing reading stays quiet.
   */
  const re = /(-?\d[\d,]*)(\.\d+)?/g;
  let cursor = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    if (m.index > cursor) parts.push({ text: text.slice(cursor, m.index), kind: 'u' });
    parts.push({ text: m[1] as string, kind: 'n' });
    if (m[2] !== undefined) parts.push({ text: m[2], kind: 'frac' });
    cursor = m.index + m[0].length;
  }

  if (parts.length === 0) return null;
  if (cursor < text.length) parts.push({ text: text.slice(cursor), kind: 'u' });
  return parts;
}

/**
 * The strip of headline numbers under a heading, with no card around it.
 *
 * Two or three readings side by side, each a figure over its own small label -
 * the shape a phone bill or a wallet leads with. It exists because the thing
 * it replaces is a middot-joined sentence, and "For 3h 12m · 4h 20m of pack
 * left" is three facts with no visual difference between the words and the
 * digits, so it has to be read left to right before it can be used at all.
 * Stacked, each figure is found by position instead of by reading.
 */
export function FigureRow({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="figure-row">{children}</div>;
}

export function KeyFigure({
  label,
  value,
  unit,
  tone = 'neutral',
  delta,
}: {
  label: string;
  value: string | number;
  unit?: string;
  tone?: Tone;
  delta?: ReactNode;
}): React.JSX.Element {
  return (
    <div className="key-figure">
      <span className={`key-figure-value tone-${tone}`}>
        <Figure size="lg" unit={unit}>
          {value}
        </Figure>
        {delta}
      </span>
      <span className="key-figure-label">{label}</span>
    </div>
  );
}

/**
 * Change against a comparable earlier period.
 *
 * The one thing a single reading cannot say is which way it is going, so this
 * is not decoration on a number - it is a second number the layout has no
 * other way to carry. It is only rendered where there is a real earlier figure
 * to divide by; nothing here invents a baseline.
 *
 * `polarity` exists because up is not good everywhere. More megabits is good
 * news and more gigabytes off the allowance is not, and colouring both green
 * because both arrows point the same way is the reflex that makes an interface
 * stop being worth reading.
 */
export function Delta({
  pct,
  polarity = 'up-good',
}: {
  /** Signed percentage change. The caller decides what is worth comparing. */
  pct: number;
  polarity?: 'up-good' | 'up-bad' | 'none';
}): React.JSX.Element | null {
  if (!Number.isFinite(pct)) return null;

  const rounded = Math.round(pct);
  /* Under half a percent there is no story, and a badge reading 0% is a badge
     spent saying nothing. */
  if (rounded === 0) return null;

  const up = rounded > 0;
  const good = up ? polarity === 'up-good' : polarity === 'up-bad';
  const tone = polarity === 'none' ? 'neutral' : good ? 'good' : 'bad';

  return (
    <span className={`delta tone-${tone}`}>
      {up ? <TrendingUpIcon size={12} /> : <TrendingDownIcon size={12} />}
      {up ? '+' : '−'}
      {Math.abs(rounded)}%
    </span>
  );
}

/* -- day grid -------------------------------------------------------------- */

export type DayCell = {
  /** Stable key; `label` is what a pointer or a screen reader gets. */
  key: string;
  label: string;
  tone: Tone | 'none';
  today?: boolean;
};

/**
 * The last few weeks, one cell a day, in order.
 *
 * The weekday heatmap on this page answers "when do cuts start". This answers
 * something the app could not answer at all - "how many recent days were
 * clean, and is the bad run recent or old" - and sequence is the whole point,
 * so the cells run oldest to newest and today wears a ring rather than a
 * colour of its own.
 *
 * A cell carries one fact - the worst thing that happened that day - at full
 * strength. An earlier pass shaded the fill by how much of the day the fault
 * took, and it had to go: opacity blends toward whatever is behind, so the
 * same shade read as "less" on a light card and as "worse" on a dark one. How
 * long a cut ran is a question the timeline above answers properly.
 *
 * A day with nothing recorded is an outline, never a pale fill: a monitor that
 * was switched off must not be able to look like a day that went well.
 */
export function DayGrid({
  cells,
  caption,
  label,
}: {
  cells: DayCell[];
  caption?: ReactNode;
  label: string;
}): React.JSX.Element {
  /*
   * Ten to a row, unless there are fewer than ten - a week rendered into a
   * ten-column track would leave three empty columns and read as a month with
   * most of it missing.
   */
  const columns = Math.min(cells.length, 10);

  return (
    <div className="day-grid-wrap">
      <div
        className="day-grid"
        role="img"
        aria-label={label}
        style={{ '--cols': columns } as React.CSSProperties}
      >
        {cells.map((c) => (
          <span
            key={c.key}
            className={`day-cell tone-${c.tone}${c.today === true ? ' is-today' : ''}`}
            title={c.label}
          />
        ))}
      </div>
      {caption !== undefined && <p className="day-grid-caption">{caption}</p>}
    </div>
  );
}

/* -- list rows ------------------------------------------------------------- */

/**
 * A row in a ranked list: what it is on the left, how much of it on the right.
 *
 * This replaces a pattern that had grown three ways of saying one thing - a
 * title, a proportional bar under it, and the duration beside it. Sorted rows
 * already carry the ranking and the number already carries the size, so the
 * bar was the third telling of it. What survives is the icon well, because
 * that is the part that makes a list scannable without reading any of it.
 */
export function ListRow({
  icon,
  tone = 'neutral',
  title,
  sub,
  value,
  valueSub,
  onClick,
}: {
  icon?: ReactNode;
  tone?: Tone;
  title: ReactNode;
  sub?: ReactNode;
  value?: ReactNode;
  valueSub?: ReactNode;
  onClick?: () => void;
}): React.JSX.Element {
  const body = (
    <>
      {icon !== undefined && <span className={`list-icon tone-${tone}`}>{icon}</span>}
      <span className="list-text">
        <span className="list-title">{title}</span>
        {sub !== undefined && <span className="list-sub">{sub}</span>}
      </span>
      {(value !== undefined || valueSub !== undefined) && (
        <span className="list-value">
          {value !== undefined && (
            <span className="list-value-main">
              {typeof value === 'string' || typeof value === 'number' ? (
                <Figure size="sm">{value}</Figure>
              ) : (
                value
              )}
            </span>
          )}
          {valueSub !== undefined && <span className="list-value-sub">{valueSub}</span>}
        </span>
      )}
      {onClick !== undefined && <ChevronRightIcon size={16} className="list-chevron" />}
    </>
  );

  if (onClick === undefined) return <li className="list-row">{body}</li>;

  return (
    <li>
      <button
        type="button"
        className="list-row row-tap"
        onClick={() => {
          triggerHaptic('light');
          onClick();
        }}
      >
        {body}
      </button>
    </li>
  );
}

export function List({ children }: { children: ReactNode }): React.JSX.Element {
  return <ul className="list">{children}</ul>;
}

/**
 * The quiet way out of a section.
 *
 * A ghost Button was doing this job - a pill with a box around it that, sat in
 * a heading beside an h2, reads as the second most important thing in the
 * section. Every one of the reference apps makes this a plain run of tinted
 * text and a chevron, which is enough: it is a way out, not an action.
 */
export function SeeAll({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="see-all"
      onClick={() => {
        triggerHaptic('light');
        onClick();
      }}
    >
      {children}
      <ChevronRightIcon size={15} />
    </button>
  );
}

/**
 * The tag from the Tempo sheet, wearing Discord's colours.
 *
 * Three parts, and the third is the one this app was missing: a wash, a label
 * in the ink of the same hue, and a hairline in between the two. Every tag in
 * the Figma file carries a `tag-*-border` a step stronger than its `tag-*-bg`,
 * and the reason shows up on this app's own cards - a 10%-alpha wash sitting
 * on `--surface-sunken` is within a couple of values of the card behind it, so
 * without the hairline the tag stops having an edge and reads as coloured text.
 */
export function Badge({
  tone = 'neutral',
  dot = false,
  icon,
  children,
}: {
  tone?: Tone;
  /** A state light at the head. Mutually exclusive with `icon` in practice. */
  dot?: boolean;
  icon?: ReactNode;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <span className={`badge tone-${tone}`}>
      {dot && <span className="badge-dot" />}
      {icon}
      {children}
    </span>
  );
}

/**
 * Linear meter.
 *
 * Replaces the pair of semicircular gauges this page used to carry. An arc
 * costs a third of a card in height to show one fraction that a bar shows in
 * eight pixels, and two of them on one screen read as decoration.
 */
export function Meter({
  fraction,
  tone = 'accent',
  marker,
  markerLabel,
}: {
  fraction: number;
  tone?: Tone;
  /** 0..1 position of a target tick, e.g. the contracted plan speed. */
  marker?: number;
  markerLabel?: string;
}): React.JSX.Element {
  const pct = Math.min(100, Math.max(0, fraction * 100));
  return (
    <div
      className="meter"
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={`meter-fill tone-${tone}`} style={{ width: `${pct}%` }} />
      {marker !== undefined && marker > 0 && marker <= 1 && (
        <span
          className="meter-marker"
          style={{ left: `${marker * 100}%` }}
          title={markerLabel}
          aria-label={markerLabel}
        />
      )}
    </div>
  );
}

/* -- controls ------------------------------------------------------------- */

export function Button({
  onClick,
  children,
  variant = 'default',
  size = 'md',
  disabled,
  busy,
  icon,
}: {
  onClick: () => void;
  children: ReactNode;
  variant?: 'default' | 'primary' | 'inverted' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  disabled?: boolean;
  busy?: boolean;
  icon?: ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`btn btn-${variant} btn-${size}`}
      disabled={disabled === true || busy === true}
      onClick={() => {
        triggerHaptic(variant === 'danger' ? 'warning' : 'light');
        onClick();
      }}
    >
      {busy === true ? <SpinnerIcon size={size === 'sm' ? 14 : 16} /> : icon}
      <span>{children}</span>
    </button>
  );
}

/** Range switcher. One control, used everywhere a view has time windows. */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}): React.JSX.Element {
  return (
    <div className="segmented" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          className={`segmented-btn ${o.value === value ? 'active' : ''}`}
          onClick={() => {
            triggerHaptic('light');
            onChange(o.value);
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: ReactNode;
}): React.JSX.Element {
  return (
    <label className="switch">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => {
          triggerHaptic('medium');
          onChange(e.target.checked);
        }}
      />
      <span className="switch-track">
        <span className="switch-thumb" />
      </span>
      {label && <span className="switch-label">{label}</span>}
    </label>
  );
}

/* -- selection ------------------------------------------------------------- */

/**
 * Filter chip.
 *
 * The Tempo sheet keeps a segmented control and a chip row as two different
 * things, and the split is worth honouring: a segmented control answers
 * "which one of these", so the ranges keep it, while a chip row answers
 * "which of these" and has room for a count.
 *
 * The count is the whole reason this exists on Devices. "Online" and the
 * number of devices that are online were two readings in two places - a
 * filter at the top and a roster you had to finish scrolling to total - and
 * putting the number inside the control you would press to see it turns
 * picking a filter into reading the answer.
 */
export function Chip({
  children,
  selected = false,
  count,
  icon,
  onClick,
  onRemove,
  removeLabel,
  disabled,
}: {
  children: ReactNode;
  selected?: boolean;
  /** Drawn at the tail. Zero is shown, not hidden - it is a fact about the set. */
  count?: number;
  icon?: ReactNode;
  onClick?: () => void;
  /** Turns the chip into a dismissible one: a second, smaller hit target. */
  onRemove?: () => void;
  removeLabel?: string;
  disabled?: boolean;
}): React.JSX.Element {
  const body = (
    <>
      {icon}
      <span className="chip-text">{children}</span>
      {count !== undefined && <span className="chip-count">{count}</span>}
    </>
  );

  // A remove button inside a chip button would be a button inside a button,
  // which is invalid and which Safari flattens into one hit target. When a
  // chip can be dismissed the shell stops being a button and the two halves
  // become siblings.
  if (onRemove) {
    return (
      <span className={`chip chip-removable${selected ? ' is-on' : ''}`}>
        <button
          type="button"
          className="chip-main"
          disabled={disabled}
          aria-pressed={onClick ? selected : undefined}
          onClick={() => {
            if (!onClick) return;
            triggerHaptic('light');
            onClick();
          }}
        >
          {body}
        </button>
        <button
          type="button"
          className="chip-remove"
          disabled={disabled}
          aria-label={removeLabel ?? 'Remove'}
          onClick={() => {
            triggerHaptic('light');
            onRemove();
          }}
        >
          <XIcon size={13} />
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      className={`chip${selected ? ' is-on' : ''}`}
      disabled={disabled}
      aria-pressed={selected}
      onClick={() => {
        triggerHaptic('light');
        onClick?.();
      }}
    >
      {body}
    </button>
  );
}

/** A row of chips that wraps rather than scrolls. */
export function ChipGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className="chip-group" role="group" aria-label={label}>
      {children}
    </div>
  );
}

/**
 * Checkbox.
 *
 * Not a smaller switch. The switch in this app commits the moment it moves -
 * it writes a setting - and it says so with a glyph on the thumb. A checkbox
 * is for several things held at once where nothing is written, which in Waifai
 * means choosing which lines a chart draws.
 *
 * `swatch` paints the box in a series colour when it is on, so the legend is
 * the control rather than a caption sitting next to one.
 */
export function Checkbox({
  checked,
  onChange,
  label,
  hint,
  swatch,
  indeterminate = false,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  /** CSS colour for the filled box - used by the chart legend. */
  swatch?: string;
  indeterminate?: boolean;
  disabled?: boolean;
}): React.JSX.Element {
  const ref = useRef<HTMLInputElement>(null);

  // `indeterminate` is a property, not an attribute - React cannot set it
  // through JSX, so it has to be written to the node after every render.
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate && !checked;
  }, [indeterminate, checked]);

  return (
    <label className={`checkbox${disabled === true ? ' is-disabled' : ''}`}>
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => {
          triggerHaptic('light');
          onChange(e.target.checked);
        }}
      />
      <span
        className="checkbox-box"
        style={swatch !== undefined ? ({ '--swatch': swatch } as React.CSSProperties) : undefined}
      >
        <CheckIcon size={13} />
        <span className="checkbox-dash" />
      </span>
      <span className="checkbox-text">
        <span className="checkbox-label">{label}</span>
        {hint !== undefined && <span className="checkbox-hint">{hint}</span>}
      </span>
    </label>
  );
}

/* -- fields ---------------------------------------------------------------- */

/**
 * The line under a control that says what it will do, or what went wrong.
 *
 * This was three ad-hoc rules before - `.setting-hint`, `.field > span` and a
 * bare `.muted` - and the error case did not exist at all, so a control that
 * refused what it was given had nowhere to say so. One component, three tones,
 * and the error and success tones carry a glyph, because a red sentence is not
 * a signal to anyone reading it in greyscale.
 */
export function Hint({
  tone = 'neutral',
  children,
  id,
}: {
  tone?: 'neutral' | 'good' | 'bad';
  children: ReactNode;
  id?: string;
}): React.JSX.Element {
  return (
    <p className={`hint hint-${tone}`} id={id}>
      {tone === 'bad' && <AlertTriangleIcon size={14} />}
      {tone === 'good' && <CheckCircleIcon size={14} />}
      <span>{children}</span>
    </p>
  );
}

/**
 * Search field.
 *
 * A bare input was doing this job, which left two things off. The glyph, so
 * the field is recognisable as search before it is read - it sits directly
 * above a chip row that is also about narrowing the list, and the two need
 * telling apart at a glance. And a clear button, because the platform's own
 * appears only in WebKit and only on a pointer, so on the phone this app is
 * actually used on there was no way back to the full list except to select the
 * text and delete it.
 */
export function SearchField({
  value,
  onChange,
  placeholder,
  label,
  describedBy,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label: string;
  describedBy?: string;
}): React.JSX.Element {
  return (
    <div className={`search${value === '' ? '' : ' has-value'}`}>
      <SearchIcon size={17} className="search-glyph" />
      <input
        // The type is what gets a phone keyboard a Search key and an Escape
        // that empties the field; only WebKit's own cross is suppressed, in
        // styles.css, because this draws its own on every browser.
        type="search"
        className="search-input"
        value={value}
        placeholder={placeholder}
        aria-label={label}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
      />
      {value !== '' && (
        <button
          type="button"
          className="search-clear"
          aria-label="Clear search"
          onClick={() => {
            triggerHaptic('light');
            onChange('');
          }}
        >
          <XIcon size={15} />
        </button>
      )}
    </div>
  );
}

/* -- async ---------------------------------------------------------------- */

export function Async<T>({
  state,
  children,
  empty,
}: {
  state: { data: T | null; error: string | null; loading: boolean; stale: boolean };
  children: (data: T) => ReactNode;
  empty?: ReactNode;
}): React.JSX.Element {
  if (state.data === null) {
    if (state.loading) {
      return (
        <div className="async-pending">
          <SpinnerIcon size={20} />
          <span>Loading</span>
        </div>
      );
    }
    if (state.error !== null) {
      return (
        <p className="notice notice-bad">{state.error}</p>
      );
    }
    return <>{empty ?? <p className="muted">Nothing recorded yet.</p>}</>;
  }
  return (
    <>
      {state.stale && <p className="notice notice-stale">Last known reading — the monitor is unreachable.</p>}
      {children(state.data)}
    </>
  );
}

/* -- time ----------------------------------------------------------------- */

export function ago(ts: number): string {
  const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.round(sec / 60)} min ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)} hr ago`;
  return `${Math.round(sec / 86400)} d ago`;
}

/** Clock time only - for anything that happened today. */
export function clockTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/**
 * The shortest honest answer, for places a line cannot wrap - a shelf card is
 * 164px wide and `localTime` spills onto a second line there. Today gives the
 * clock; anything older gives the date and drops the hour, which is the half
 * you stop caring about once it is not today.
 */
export function shortTime(ts: number): string {
  const sameDay = new Date(ts).toDateString() === new Date().toDateString();
  if (sameDay) return clockTime(ts);
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function localTime(ts: number): string {
  const sameDay = new Date(ts).toDateString() === new Date().toDateString();
  if (sameDay) return clockTime(ts);
  return new Date(ts).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
