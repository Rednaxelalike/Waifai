import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AnimatePresence,
  motion,
  useDragControls,
  useReducedMotion,
  type PanInfo,
} from 'motion/react';
import { Home } from './pages/Home.tsx';
import { Light } from './pages/Light.tsx';
import { Devices } from './pages/Devices.tsx';
import { Data } from './pages/Data.tsx';
import { useLive } from './lib/live.ts';
import { refreshAll } from './lib/api.ts';
import { useTheme } from './lib/theme.ts';
import { PRIMARY_TABS, TAB_LABELS, TAB_TITLES, tabFromHash, type TabId } from './lib/nav.ts';
import { ToastProvider, triggerHaptic } from './components/Toast.tsx';
import { Settings } from './components/Settings.tsx';
import { SPRING, DURATION, CURVE } from './lib/motion.ts';
import {
  WaifaiBrandMark,
  HomeIcon,
  PowerIcon,
  DevicesIcon,
  UsageIcon,
  RefreshIcon,
  MoreIcon,
} from './components/icons.tsx';

const TAB_ICONS: Record<TabId, (p: { size?: number }) => React.JSX.Element> = {
  home: HomeIcon,
  light: PowerIcon,
  devices: DevicesIcon,
  data: UsageIcon,
};

/**
 * Elements that own the horizontal axis for themselves.
 *
 * The swipe-between-tabs gesture has to yield to these or the device shelf
 * becomes unscrollable and dragging a crosshair across a chart throws you onto
 * the next screen. Checked on pointer-down, which is the last moment before
 * the drag would begin.
 */
const HSCROLL = '.shelf-rail, .chart, .heatmap-scroll, .segmented, .timeline-lane, input, textarea';

/** How far, or how fast, a swipe has to be before it changes screen. */
const SWIPE_DISTANCE = 64;
const SWIPE_VELOCITY = 380;
/** How much more sideways than vertical the travel must be to count at all. */
const SWIPE_INTENT = 1.5;

export function App(): React.JSX.Element {
  const [tab, setTab] = useState<TabId>(tabFromHash);
  const [refreshing, setRefreshing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [direction, setDirection] = useState(0);
  const live = useLive();
  // Mounted here purely so the stored choice is applied on boot; the control
  // itself now lives in the settings sheet.
  useTheme();
  const reduced = useReducedMotion() === true;
  const previous = useRef<TabId>(tab);
  const dragControls = useDragControls();

  useEffect(() => {
    const onHash = (): void => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    document.title = TAB_TITLES[tab];
  }, [tab]);

  /* Which way the new screen should come in from. */
  const go = useCallback((id: TabId): void => {
    const order = PRIMARY_TABS;
    const from = order.indexOf(previous.current);
    const to = order.indexOf(id);
    setDirection(from === -1 || to === -1 || from === to ? 0 : to > from ? 1 : -1);
    previous.current = id;

    triggerHaptic('light');
    location.hash = id;
    setTab(id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  /** Step one tab along the bar. Used by the swipe gesture. */
  const step = useCallback(
    (delta: number): void => {
      const order = PRIMARY_TABS;
      const here = order.indexOf(tab);
      const next = order[here + delta];
      if (here === -1 || next === undefined) return;
      go(next);
    },
    [tab, go],
  );

  const onDragEnd = useCallback(
    (_e: unknown, info: PanInfo): void => {
      const { offset, velocity } = info;
      /*
       * Horizontal intent has to be clear, not merely larger.
       *
       * Simply comparing the two axes was not enough: a thumb travelling up
       * the page drifts sideways, and a scroll that happened to drift one
       * pixel further across than down threw the reader onto the next screen.
       * Requiring the sideways travel to beat the vertical by half again is
       * what native pagers do, and it makes an accidental change of screen
       * while reading essentially impossible.
       */
      if (Math.abs(offset.x) < Math.abs(offset.y) * SWIPE_INTENT) return;
      const far = Math.abs(offset.x) > SWIPE_DISTANCE;
      const fast = Math.abs(velocity.x) > SWIPE_VELOCITY;
      if (!far && !fast) return;
      step(offset.x < 0 ? 1 : -1);
    },
    [step],
  );

  /*
   * Re-fetch rather than reload. A full reload on a PWA tears down the app and
   * restarts the service worker to replace three small JSON payloads, and it
   * throws away the live socket that was already going to tell us about
   * anything that changed.
   */
  const refresh = (): void => {
    triggerHaptic('medium');
    setRefreshing(true);
    refreshAll();
    window.setTimeout(() => setRefreshing(false), 700);
  };

  const state =
    live.connection !== 'open'
      ? { tone: 'neutral', label: live.connection === 'closed' ? 'Offline' : 'Connecting' }
      : live.status?.status === 'up'
        ? { tone: 'good', label: 'Live' }
        : live.status?.status === 'degraded'
          ? { tone: 'warn', label: 'Degraded' }
          : live.status?.status === 'down'
            ? { tone: 'bad', label: 'Down' }
            : { tone: 'neutral', label: 'Live' };

  /*
   * The tab bar carries two ambient warnings, and only two. The home dot means
   * the line is not well; the light dot means the router is not on mains. They
   * are the two states worth seeing from any screen without going to look.
   */
  const powerState = live.status?.power.state;
  const dotFor = (id: TabId): 'warn' | 'bad' | null => {
    if (id === 'home' && live.status && live.status.status !== 'up') {
      return live.status.status === 'down' ? 'bad' : 'warn';
    }
    if (id === 'light' && (powerState === 'battery' || powerState === 'off')) {
      return powerState === 'off' ? 'bad' : 'warn';
    }
    return null;
  };

  const enter = reduced ? { opacity: 0 } : { opacity: 0, x: direction * 26 };
  const exit = reduced ? { opacity: 0 } : { opacity: 0, x: direction * -26 };

  return (
    <ToastProvider>
      <div className="app">
        <header className="app-header">
          <button type="button" className="brand" onClick={() => go('home')}>
            <WaifaiBrandMark size={30} />
            <span className="brand-name">Waifai</span>
          </button>

          <div className="header-tools">
            <span className={`status-tag tone-${state.tone}`}>
              <span className="beacon" />
              {state.label}
            </span>
            <button
              type="button"
              className={`icon-btn ${refreshing ? 'spin' : ''}`}
              onClick={refresh}
              aria-label="Refresh"
            >
              <RefreshIcon size={17} />
            </button>
            {/*
              Theme, the monitor's own health and the restart button all live
              behind this one. None of them is a thing you come to the app to
              do, and each of them used to be occupying space that a reading
              could have had.
            */}
            <button
              type="button"
              className="icon-btn"
              onClick={() => setSettingsOpen(true)}
              aria-label="Settings"
            >
              <MoreIcon size={17} />
            </button>
          </div>
        </header>

        {/*
          Swipe between screens, the way the chat apps do it. The gesture is
          switched off at pointer-down whenever the finger lands on something
          that owns the horizontal axis itself - see HSCROLL.
        */}
        <motion.main
          className="content"
          drag={reduced ? false : 'x'}
          /*
           * The gesture is started by hand rather than by Motion's own
           * listener. Deciding with React state was wrong: the state update is
           * asynchronous, so Motion had already claimed the pointer by the time
           * the "not on the carousel" flag arrived, and the shelf could not be
           * scrolled. Starting it here is synchronous, so the check actually
           * holds.
           */
          dragListener={false}
          dragControls={dragControls}
          dragDirectionLock
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.16}
          dragMomentum={false}
          onDragEnd={onDragEnd}
          onPointerDown={(e: React.PointerEvent) => {
            if (reduced) return;
            const el = e.target as Element | null;
            if (el?.closest(HSCROLL) != null) return;
            dragControls.start(e);
          }}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={tab}
              className="screen"
              initial={enter}
              animate={{ opacity: 1, x: 0 }}
              exit={exit}
              transition={{ duration: DURATION.base / 1000, ease: [...CURVE.standard] }}
            >
              {tab === 'home' && (
                <Home
                  status={live.status}
                  connection={live.connection}
                  recent={live.recent}
                  onNavigate={go}
                />
              )}
              {tab === 'light' && <Light />}
              {tab === 'devices' && <Devices />}
              {tab === 'data' && <Data />}
            </motion.div>
          </AnimatePresence>
        </motion.main>

        <nav className="tabbar" aria-label="Sections">
          {PRIMARY_TABS.map((id) => {
            const Icon = TAB_ICONS[id];
            const active = tab === id;
            const dot = dotFor(id);
            return (
              <button
                key={id}
                type="button"
                className={`tab ${active ? 'active' : ''}`}
                aria-current={active ? 'page' : undefined}
                onClick={() => go(id)}
              >
                {/*
                  One pill, moved between tabs by Motion rather than four pills
                  cross-fading. `layoutId` is what makes it travel.
                */}
                {active && (
                  <motion.span
                    layoutId="tab-pill"
                    className="tab-pill"
                    transition={reduced ? { duration: 0 } : SPRING.settle}
                  />
                )}
                <span className="tab-icon">
                  <Icon size={21} />
                </span>
                <span>{TAB_LABELS[id]}</span>
                {dot && <span className={`tab-dot tone-${dot}`} />}
              </button>
            );
          })}
        </nav>

        <Settings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      </div>
    </ToastProvider>
  );
}
