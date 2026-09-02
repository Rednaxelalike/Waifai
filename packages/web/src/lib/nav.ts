/**
 * Routing, such as it is.
 *
 * The app is a handful of screens behind a tab bar, so the hash is the whole
 * router. Keeping the id list here rather than in App.tsx means pages can take
 * a typed `onNavigate` without importing the shell they live in.
 *
 * Four tabs, down from six. The two that went were not features being cut but
 * halves of an answer being rejoined: "Power" and "History" were both asking
 * what took the internet away, and the reader was doing the correlation by
 * hand; "Data" and "Line" were both about the pipe. What is left is one tab
 * per question a person actually arrives with.
 */

export const TAB_IDS = ['home', 'light', 'devices', 'data'] as const;

export type TabId = (typeof TAB_IDS)[number];

/** Every tab gets a slot in the bar. Settings is a sheet, not a screen. */
export const PRIMARY_TABS: TabId[] = ['home', 'light', 'devices', 'data'];

/**
 * `light` rather than `power`, because that is the word actually used for the
 * thing being watched. "Is there light?" is the question; "power state" is a
 * description of the database column.
 */
export const TAB_LABELS: Record<TabId, string> = {
  home: 'Home',
  light: 'Light',
  devices: 'Devices',
  data: 'Data',
};

export const TAB_TITLES: Record<TabId, string> = {
  home: 'Waifai',
  light: 'Light · Waifai',
  devices: 'Devices · Waifai',
  data: 'Data · Waifai',
};

/**
 * Old hashes still land somewhere sensible.
 *
 * This app gets added to a home screen and shared as a link on a phone, so a
 * bookmark to `#history` outlives the refactor that removed it.
 */
const ALIASES: Record<string, TabId> = {
  power: 'light',
  history: 'light',
  usage: 'data',
  line: 'data',
};

export function tabFromHash(): TabId {
  const hash = location.hash.replace(/^#/, '');
  if ((TAB_IDS as readonly string[]).includes(hash)) return hash as TabId;
  return ALIASES[hash] ?? 'home';
}
