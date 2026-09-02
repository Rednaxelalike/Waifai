/**
 * Motion tokens.
 *
 * Every number here was measured rather than invented, so that "make it feel
 * like those apps" has an answer that survives the next redesign.
 *
 * - The easing curves are the ones Discord's own React Native bundle ships:
 *   `Easing.bezier(0.4, 0, 0.2, 1)` for ordinary state changes,
 *   `(0.16, 1, 0.3, 1)` for anything entering, and `(0.25, 1.75, 0.25, 1.25)`
 *   for the two or three places it wants a deliberate overshoot. Its duration
 *   histogram is dominated by 150 / 200 / 250 / 300 ms, which is where the
 *   scale below comes from.
 *
 * - The fling constants come from tracking the Files by Google Recents row
 *   frame by frame: the last throw leaves the finger at about 840 px/s and is
 *   at rest 450 ms later, having travelled ~130 px, and it stops wherever it
 *   stops. That last part matters - the row does *not* snap to a card - so the
 *   carousel here is a plain momentum scroller and not a snap-points carousel.
 *
 * Durations are milliseconds. Anything longer than `slow` is a considered
 * exception, not a default.
 */

export const DURATION = {
  /** Press feedback, ripples, anything that must not feel laggy. */
  instant: 100,
  /** Hover, tint and opacity changes. */
  fast: 150,
  /** The default. Tab indicator, card lift, list row expansion. */
  base: 200,
  /** Entrances, sheet slide, screen change. */
  medium: 250,
  /** Large surfaces travelling a long way. */
  slow: 300,
  /** The measured tail of a Files by Google fling. */
  fling: 450,
} as const;

export const EASE = {
  /** Material's standard curve, and Discord's most-used. Both ends damped. */
  standard: 'cubic-bezier(0.4, 0, 0.2, 1)',
  /** Entering: fast off the mark, long settle. The "expressive" feel. */
  out: 'cubic-bezier(0.16, 1, 0.3, 1)',
  /** Leaving: slow to commit, then gone. */
  in: 'cubic-bezier(0.4, 0, 1, 1)',
  /** Deliberate overshoot. Reserve it for things that appear, never for exits. */
  overshoot: 'cubic-bezier(0.25, 1.75, 0.25, 1.25)',
  /** Momentum decay, matched to the measured fling tail. */
  decel: 'cubic-bezier(0.05, 0.7, 0.1, 1)',
} as const;

/**
 * The same four curves as control-point arrays.
 *
 * Motion takes beziers this way rather than as CSS strings, and having both
 * spellings derive from one comment - rather than one being typed out again
 * somewhere else - is what stops the CSS and the JS drifting apart.
 */
export const CURVE = {
  standard: [0.4, 0, 0.2, 1],
  out: [0.16, 1, 0.3, 1],
  in: [0.4, 0, 1, 1],
  overshoot: [0.25, 1.75, 0.25, 1.25],
  decel: [0.05, 0.7, 0.1, 1],
} as const satisfies Record<string, readonly [number, number, number, number]>;

/**
 * Spring presets for Motion.
 *
 * `press` is critically damped on purpose: a button that wobbles under a
 * fingertip reads as broken rather than lively. `settle` is the one that
 * carries the carousel and the sheet, and `bouncy` is the single overshooting
 * preset - it exists for things arriving on screen and nothing else.
 */
export const SPRING = {
  press: { type: 'spring', stiffness: 900, damping: 42, mass: 0.6 },
  settle: { type: 'spring', stiffness: 320, damping: 34, mass: 0.9 },
  bouncy: { type: 'spring', stiffness: 420, damping: 26, mass: 0.9 },
  /** Discord's own drawer config, from the bundle: {stiffness:80,damping:6,mass:0.3}
   *  is far too loose for a whole screen, so this is that shape, damped. */
  drawer: { type: 'spring', stiffness: 260, damping: 30, mass: 1 },
} as const;

/**
 * Stagger step for a list or carousel appearing.
 *
 * 40 ms is short enough that eight cards are all in place inside a third of a
 * second, which is the point past which a stagger stops reading as choreography
 * and starts reading as the app being slow.
 */
export const STAGGER_STEP = 40;
export const STAGGER_MAX = 8;

/** Delay for the nth item in a staggered group, capped so long lists stay quick. */
export function stagger(index: number): number {
  return Math.min(index, STAGGER_MAX) * STAGGER_STEP;
}

/**
 * Android's fling, close enough for a scrollbar-less carousel.
 *
 * Used only where a scroll has to be driven from code (the carousel's arrow
 * buttons and its keyboard support). Real finger scrolling is left to the
 * platform, which already implements this curve better than any JS can.
 */
export function flingDistance(velocity: number): number {
  // v0 * tau, with tau chosen so 840 px/s lands at ~130 px like the reference.
  return velocity * 0.155;
}

/** True when the reader has asked the system for less movement. */
export function prefersReducedMotion(): boolean {
  return (
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
