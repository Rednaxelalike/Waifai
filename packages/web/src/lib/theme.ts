import { useEffect, useState } from 'react';

/**
 * Theme.
 *
 * Three settings, two outcomes: `system` follows the OS, `light` and `dark`
 * pin it. Light is the default rather than `system`: the OS setting is a
 * phone-wide preference, and following it handed a dark dashboard to readers
 * who never asked this app for one. `system` is still one tap away.
 *
 * The resolved value is stamped on `<html data-theme>` so CSS can override the
 * media query in both directions, and it is applied before React mounts (see
 * index.html) so the app never flashes the wrong ground colour.
 */

export type ThemeChoice = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'waifai:theme';

export function readChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    // Private mode, or storage blocked. The default is the right fallback.
  }
  return 'light';
}

function systemTheme(): ResolvedTheme {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

export function resolve(choice: ThemeChoice): ResolvedTheme {
  return choice === 'system' ? systemTheme() : choice;
}

/** The colour the browser paints behind the app - status bar, overscroll. */
/* Matches the app header, which is what the status bar sits against. */
const GROUND: Record<ResolvedTheme, string> = { light: '#FFFFFF', dark: '#2B2D31' };

export function applyTheme(choice: ThemeChoice): ResolvedTheme {
  const resolved = resolve(choice);
  const root = document.documentElement;
  root.dataset['theme'] = resolved;
  root.style.colorScheme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', GROUND[resolved]);
  return resolved;
}

export function useTheme(): {
  choice: ThemeChoice;
  theme: ResolvedTheme;
  setChoice: (c: ThemeChoice) => void;
  cycle: () => void;
} {
  const [choice, setChoiceState] = useState<ThemeChoice>(readChoice);
  const [theme, setTheme] = useState<ResolvedTheme>(() => resolve(readChoice()));

  useEffect(() => {
    setTheme(applyTheme(choice));
    try {
      localStorage.setItem(STORAGE_KEY, choice);
    } catch {
      // Nothing to do; the choice just will not survive a reload.
    }
    if (choice !== 'system' || typeof matchMedia !== 'function') return;

    // Only while following the system does the OS get to change our mind.
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = (): void => setTheme(applyTheme('system'));
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [choice]);

  return {
    choice,
    theme,
    setChoice: setChoiceState,
    cycle: () => setChoiceState((c) => (c === 'system' ? 'light' : c === 'light' ? 'dark' : 'system')),
  };
}

/**
 * Read-only view of the active theme.
 *
 * `useTheme` owns the setting - it writes storage, stamps the document and
 * updates the status bar colour. Anything that merely needs to *know* the
 * theme (charts picking a palette, the heatmap picking a ramp) uses this
 * instead, so a page with three charts does not run three copies of that.
 */
export function useResolvedTheme(): ResolvedTheme {
  const [theme, setTheme] = useState<ResolvedTheme>(
    () => (document.documentElement.dataset['theme'] as ResolvedTheme | undefined) ?? resolve(readChoice()),
  );

  useEffect(() => {
    const root = document.documentElement;
    const read = (): void => setTheme(root.dataset['theme'] === 'dark' ? 'dark' : 'light');
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  return theme;
}
