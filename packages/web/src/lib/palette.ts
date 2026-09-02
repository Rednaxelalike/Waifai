import type { ResolvedTheme } from './theme.ts';

/**
 * Chart colours.
 *
 * Four categorical slots, assigned in this fixed order and never cycled. The
 * order is the accessibility mechanism, not a preference: it was chosen because
 * it is the ordering that clears colour-blind separation on every adjacent pair
 * in both light and dark, which the obvious orderings do not.
 *
 * Status hues (green / amber / red) are deliberately absent. They are reserved
 * for state - "the light is on", "the line is degraded" - so a series can never
 * impersonate a verdict.
 */

export type SeriesSlot = 0 | 1 | 2 | 3;

const SERIES: Record<ResolvedTheme, [string, string, string, string]> = {
  light: ['#2A78D6', '#1BAF7A', '#4A3AA7', '#E87BA4'],
  dark: ['#3987E5', '#199E70', '#9085E9', '#D55181'],
};

export function seriesColor(theme: ResolvedTheme, slot: number): string {
  return SERIES[theme][(slot % 4) as SeriesSlot];
}

/**
 * Down and up, which are not categories.
 *
 * The one pair outside `SERIES`, and the one place the rule above is bent on
 * purpose. Download and upload are the only two series in the app that recur
 * on three different screens and always mean the same two things, so they are
 * worth a fixed identity rather than the next two slots off the ramp - and off
 * that ramp they came out as two blues, which on a phone-sized sparkline is
 * one blue.
 *
 * It is safe here for the same reason the switch is allowed to be green:
 * nothing is left resting on the colour. Every place these are used - the home
 * lanes, the traffic chart, the speed chart - carries an arrow or a legend
 * reading "Download" and "Upload" beside the line.
 *
 * Green is the download. Not arbitrary: the down figure is the one people
 * read as "is the internet working", and a healthy one painted red is an alarm
 * about nothing. The pair is also separated by lightness, not only by hue,
 * which is what keeps it legible to the ~8% of men who cannot tell a green
 * from a red at all.
 *
 * Keep in step with `--lane-down` / `--lane-up` in styles.css, which is where
 * the CSS-drawn sparklines read the same two values from.
 */
const DIRECTIONAL: Record<ResolvedTheme, { down: string; up: string }> = {
  light: { down: '#12996A', up: '#C4384F' },
  dark: { down: '#3BC489', up: '#E8606E' },
};

export function directionColor(theme: ResolvedTheme, direction: 'down' | 'up'): string {
  return DIRECTIONAL[theme][direction];
}

/** Sequential blue ramp, light to dark. Used for magnitude, never for identity. */
const SEQUENTIAL = [
  '#CDE2FB',
  '#9EC5F4',
  '#6DA7EC',
  '#3987E5',
  '#2A78D6',
  '#256ABF',
  '#1C5CAB',
  '#184F95',
  '#0D366B',
] as const;

/**
 * Map 0..1 onto the sequential ramp.
 *
 * In dark mode the ramp is walked from the dark end so that "more" still means
 * "further from the surface" rather than "brighter", which is what keeps a
 * heatmap readable when the page behind it is nearly black.
 */
export function sequential(fraction: number, theme: ResolvedTheme): string {
  const f = Math.min(1, Math.max(0, fraction));
  const last = SEQUENTIAL.length - 1;
  const i = Math.round(theme === 'dark' ? (1 - f) * last : f * last);
  return SEQUENTIAL[Math.min(last, Math.max(0, i))] ?? SEQUENTIAL[0];
}

export const SEQUENTIAL_ENDS = {
  light: { low: SEQUENTIAL[0], high: SEQUENTIAL[SEQUENTIAL.length - 1] },
  dark: { low: SEQUENTIAL[SEQUENTIAL.length - 1], high: SEQUENTIAL[0] },
} as const;
