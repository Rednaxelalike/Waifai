import type { SVGProps } from 'react';

/**
 * Icon set.
 *
 * One geometry for everything: a 24px grid, 1.7px strokes, round caps and
 * joins, no fills except where a shape is meant to read as solid. Mixing icon
 * families is the fastest way to make an interface look assembled rather than
 * designed, so every glyph in the app comes from this file.
 */

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Glyph({ size = 20, children, ...props }: IconProps): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

/* -- navigation ----------------------------------------------------------- */

export const HomeIcon = (p: IconProps): React.JSX.Element => (
  <Glyph {...p}>
    <path d="M3.5 10.4 12 3.8l8.5 6.6V19a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
    <path d="M9.5 21v-6.2a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V21" />
  </Glyph>
);

export const PowerIcon = (p: IconProps): React.JSX.Element => (
  <Glyph {...p}>
    <path d="M13.2 2.8 5.6 12.6a.6.6 0 0 0 .47.97h4.4a.6.6 0 0 1 .59.71l-1.26 6.5a.3.3 0 0 0 .53.24l7.6-9.8a.6.6 0 0 0-.47-.97h-4.4a.6.6 0 0 1-.59-.71l1.26-6.5a.3.3 0 0 0-.53-.24Z" />
  </Glyph>
);

export const DevicesIcon = (p: IconProps): React.JSX.Element => (
  <Glyph {...p}>
    <rect x="2.5" y="4.5" width="12" height="9" rx="1.6" />
    <path d="M6 17.5h5" />
    <rect x="16.5" y="9.5" width="5" height="11" rx="1.6" />
    <path d="M18.6 18.2h.8" />
  </Glyph>
);

export const UsageIcon = (p: IconProps): React.JSX.Element => (
  <Glyph {...p}>
    <path d="M4 19V5" />
    <path d="M4 15.5l4.6-4.4a1 1 0 0 1 1.36-.03l2.5 2.2a1 1 0 0 0 1.37-.05L20 7" />
    <path d="M20 11.2V7h-4.2" />
  </Glyph>
);

export const HistoryIcon = (p: IconProps): React.JSX.Element => (
  <Glyph {...p}>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
    <path d="M3.2 4.4v4.2h4.2" />
    <path d="M12 7.8V12l2.8 1.7" />
  </Glyph>
);

export const LineIcon = (p: IconProps): React.JSX.Element => (
  <Glyph {...p}>
    <path d="M2.5 12h3l2.2-6.4a.5.5 0 0 1 .95.03L12 19.2a.5.5 0 0 0 .96.03L15.4 12h6.1" />
  </Glyph>
);

/* -- domain --------------------------------------------------------------- */

export const WifiIcon = (p: IconProps): React.JSX.Element => (
  <Glyph {...p}>
    <path d="M2.6 8.9a14 14 0 0 1 18.8 0" />
    <path d="M5.9 12.5a9.2 9.2 0 0 1 12.2 0" />
    <path d="M9.2 16.1a4.4 4.4 0 0 1 5.6 0" />
    <circle cx="12" cy="19.4" r=".9" fill="currentColor" stroke="none" />
  </Glyph>
);

export const EthernetIcon = (p: IconProps): React.JSX.Element => (
  <Glyph {...p}>
    <rect x="3" y="9.4" width="18" height="8.6" rx="2" />
    <path d="M8.8 9.4V6.2h6.4v3.2" />
  </Glyph>
);

export const RouterIcon = (p: IconProps): React.JSX.Element => (
  <Glyph {...p}>
    <rect x="2.5" y="13" width="19" height="7.5" rx="2.2" />
    <path d="M6.2 16.8h.01M9.4 16.8h.01" />
    <path d="M12 13V9.6" />
    <path d="M8.6 6.9a4.8 4.8 0 0 1 6.8 0" />
    <path d="M6 4.2a8.6 8.6 0 0 1 12 0" />
  </Glyph>
);

export const SpeedometerIcon = (p: IconProps): React.JSX.Element => (
  <Glyph {...p}>
    <path d="M3.4 17.4a9.6 9.6 0 1 1 17.2 0" />
    <path d="m14.6 9.9-2.1 3.5a1.6 1.6 0 1 0 2.1-3.5Z" />
  </Glyph>
);

export const BatteryIcon = (p: IconProps): React.JSX.Element => (
  <Glyph {...p}>
    <rect x="2.5" y="7.5" width="16" height="9" rx="2.4" />
    <path d="M21.4 11v2" />
    <path d="m11.3 9.6-2.2 3.1h2.9l-1.9 2.9" />
  </Glyph>
);

export const ServerIcon = (p: IconProps): React.JSX.Element => (
  <Glyph {...p}>
    <rect x="3" y="3.5" width="18" height="7" rx="2.2" />
    <rect x="3" y="13.5" width="18" height="7" rx="2.2" />
    <path d="M6.6 7h.01M6.6 17h.01" />
  </Glyph>
);

export const GlobeIcon = (p: IconProps): React.JSX.Element => (
  <Glyph {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3.3 9.5h17.4M3.3 14.5h17.4" />
    <path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18Z" />
  </Glyph>
);

export const ArrowDownIcon = (p: IconProps): React.JSX.Element => (
  <Glyph {...p}>
    <path d="M12 4.5v15" />
    <path d="m6.5 14 5.5 5.5L17.5 14" />
  </Glyph>
);

export const ArrowUpIcon = (p: IconProps): React.JSX.Element => (
  <Glyph {...p}>
    <path d="M12 19.5v-15" />
    <path d="m6.5 10 5.5-5.5L17.5 10" />
  </Glyph>
);

/* -- state ---------------------------------------------------------------- */

export const ShieldCheckIcon = (p: IconProps): React.JSX.Element => (
  <Glyph {...p}>
    <path d="M12 2.9 4.8 5.5v6c0 4.6 3.2 7.7 7.2 9.6 4-1.9 7.2-5 7.2-9.6v-6z" />
    <path d="m9.2 11.9 2 2 3.6-3.9" />
  </Glyph>
);

export const AlertTriangleIcon = (p: IconProps): React.JSX.Element => (
  <Glyph {...p}>
    <path d="M10.3 4.2 2.9 17.1A2 2 0 0 0 4.6 20h14.8a2 2 0 0 0 1.7-2.9L13.7 4.2a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9.6v4" />
    <path d="M12 16.7h.01" />
  </Glyph>
);

export const InfoIcon = (p: IconProps): React.JSX.Element => (
  <Glyph {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11.2v4.6" />
    <path d="M12 8.2h.01" />
  </Glyph>
);

export const CheckIcon = (p: IconProps): React.JSX.Element => (
  <Glyph strokeWidth="2.1" {...p}>
    <path d="m5 12.6 4.6 4.6L19 7.4" />
  </Glyph>
);

export const CheckCircleIcon = (p: IconProps): React.JSX.Element => (
  <Glyph {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="m8.4 12.2 2.4 2.4 4.8-5" />
  </Glyph>
);

export const XIcon = (p: IconProps): React.JSX.Element => (
  <Glyph {...p}>
    <path d="M6.4 6.4l11.2 11.2M17.6 6.4 6.4 17.6" />
  </Glyph>
);

export const SparkleIcon = (p: IconProps): React.JSX.Element => (
  <Glyph {...p}>
    <path d="M12 3.2 13.5 9a3 3 0 0 0 2.1 2.1l5.8 1.5-5.8 1.5A3 3 0 0 0 13.5 16L12 21.8 10.5 16a3 3 0 0 0-2.1-2.1L2.6 12.4l5.8-1.5A3 3 0 0 0 10.5 9z" />
  </Glyph>
);

export const TrendingUpIcon = (p: IconProps): React.JSX.Element => (
  <Glyph {...p}>
    <path d="M3 17.5 9.4 11l3.6 3.4L21 6.5" />
    <path d="M15.6 6.5H21v5.3" />
  </Glyph>
);

export const TrendingDownIcon = (p: IconProps): React.JSX.Element => (
  <Glyph {...p}>
    <path d="M3 6.5 9.4 13l3.6-3.4L21 17.5" />
    <path d="M15.6 17.5H21v-5.3" />
  </Glyph>
);

export const MegaphoneIcon = (p: IconProps): React.JSX.Element => (
  <Glyph {...p}>
    <path d="M4 10.4v3.2a2 2 0 0 0 1.5 1.94l12.2 3.1a1 1 0 0 0 1.25-.97V6.33a1 1 0 0 0-1.25-.97L5.5 8.46A2 2 0 0 0 4 10.4Z" />
    <path d="M7.8 16v2.6a2.4 2.4 0 0 0 4.7.65" />
  </Glyph>
);

/*
 * The month grid, for the one part of this app that deals in dates somebody
 * typed rather than samples something recorded. The two ticks above the box
 * are what stop it reading as a plain window at 16px.
 */
export const CalendarIcon = (p: IconProps): React.JSX.Element => (
  <Glyph {...p}>
    <rect x="3.4" y="5.2" width="17.2" height="15.4" rx="2.2" />
    <path d="M3.4 9.9h17.2" />
    <path d="M8.2 3.4v3.4" />
    <path d="M15.8 3.4v3.4" />
  </Glyph>
);

/* -- controls ------------------------------------------------------------- */

export const RefreshIcon = (p: IconProps): React.JSX.Element => (
  <Glyph {...p}>
    <path d="M20.2 12a8.2 8.2 0 1 1-2.4-5.8" />
    <path d="M20.7 4.2v4.4h-4.4" />
  </Glyph>
);

export const CopyIcon = (p: IconProps): React.JSX.Element => (
  <Glyph {...p}>
    <rect x="9" y="9" width="12" height="12" rx="2.6" />
    <path d="M5.4 15H4.6A1.6 1.6 0 0 1 3 13.4V4.6A1.6 1.6 0 0 1 4.6 3h8.8A1.6 1.6 0 0 1 15 4.6v.8" />
  </Glyph>
);

export const ShareIcon = (p: IconProps): React.JSX.Element => (
  <Glyph {...p}>
    <path d="M12 15.4V3.6" />
    <path d="m8.2 7.2 3.8-3.6 3.8 3.6" />
    <path d="M6 11.4h-.4A1.6 1.6 0 0 0 4 13v6.4A1.6 1.6 0 0 0 5.6 21h12.8a1.6 1.6 0 0 0 1.6-1.6V13a1.6 1.6 0 0 0-1.6-1.6H18" />
  </Glyph>
);

export const DownloadIcon = (p: IconProps): React.JSX.Element => (
  <Glyph {...p}>
    <path d="M12 3.6v11.8" />
    <path d="m8.2 11.8 3.8 3.6 3.8-3.6" />
    <path d="M4 16.6v2.8A1.6 1.6 0 0 0 5.6 21h12.8a1.6 1.6 0 0 0 1.6-1.6v-2.8" />
  </Glyph>
);

export const EyeIcon = (p: IconProps): React.JSX.Element => (
  <Glyph {...p}>
    <path d="M2.5 12S6.4 5.6 12 5.6 21.5 12 21.5 12 17.6 18.4 12 18.4 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="2.9" />
  </Glyph>
);

export const EyeOffIcon = (p: IconProps): React.JSX.Element => (
  <Glyph {...p}>
    <path d="M9.9 5.9A8.7 8.7 0 0 1 12 5.6c5.6 0 9.5 6.4 9.5 6.4a17 17 0 0 1-2.6 3.3" />
    <path d="M6.3 7.5A17 17 0 0 0 2.5 12S6.4 18.4 12 18.4a8.8 8.8 0 0 0 3.5-.7" />
    <path d="M10 10a2.9 2.9 0 0 0 4 4" />
    <path d="m4 4 16 16" />
  </Glyph>
);

export const EditIcon = (p: IconProps): React.JSX.Element => (
  <Glyph {...p}>
    <path d="M12.6 5.4H5.4a1.8 1.8 0 0 0-1.8 1.8v11.4a1.8 1.8 0 0 0 1.8 1.8h11.4a1.8 1.8 0 0 0 1.8-1.8v-7.2" />
    <path d="M17 3.6a2.05 2.05 0 0 1 2.9 2.9L12.4 14l-3.5.7.7-3.5z" />
  </Glyph>
);

/** Vertical overflow dots. Solid, because at 15px three rings read as noise. */
export const MoreIcon = (p: IconProps): React.JSX.Element => (
  <Glyph {...p} stroke="none" fill="currentColor">
    <circle cx="12" cy="5" r="1.9" />
    <circle cx="12" cy="12" r="1.9" />
    <circle cx="12" cy="19" r="1.9" />
  </Glyph>
);

export const SearchIcon = (p: IconProps): React.JSX.Element => (
  <Glyph {...p}>
    <circle cx="10.8" cy="10.8" r="6.3" />
    <path d="m15.4 15.4 4.1 4.1" />
  </Glyph>
);

export const ChevronRightIcon = (p: IconProps): React.JSX.Element => (
  <Glyph {...p}>
    <path d="m9.5 5.5 6.4 6.5-6.4 6.5" />
  </Glyph>
);

export const ChevronDownIcon = (p: IconProps): React.JSX.Element => (
  <Glyph {...p}>
    <path d="m5.5 9.5 6.5 6.4 6.5-6.4" />
  </Glyph>
);

export const SunIcon = (p: IconProps): React.JSX.Element => (
  <Glyph {...p}>
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 2.4v2.2M12 19.4v2.2M4.2 12H2M22 12h-2.2M6.5 6.5 4.9 4.9M19.1 19.1l-1.6-1.6M17.5 6.5l1.6-1.6M4.9 19.1l1.6-1.6" />
  </Glyph>
);

export const MoonIcon = (p: IconProps): React.JSX.Element => (
  <Glyph {...p}>
    <path d="M20.4 13.9A8.6 8.6 0 0 1 10.1 3.6a8.8 8.8 0 1 0 10.3 10.3Z" />
  </Glyph>
);

export function SpinnerIcon({ size = 20, ...props }: IconProps): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className="spin"
      aria-hidden="true"
      {...props}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.2" opacity="0.18" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

/* -- brand ---------------------------------------------------------------- */

/**
 * The app mark: a Wi-Fi glyph drawn as three lit glass tubes and a bead.
 *
 * The modelling is one radial gradient per band, centred on the arcs' own
 * centre. Every point of an arc sits at the same distance from that centre, so
 * a radial gradient there runs *across* the tube rather than down the page -
 * which is what makes one gradient shade a whole sweep like a cross-section:
 * deep red at both edges, a lit filament down the middle. A vertical gradient
 * over the top then supplies the one thing a cross-section cannot know, which
 * way is up. Under it all sits a blurred copy for the bloom, and over it a thin
 * one for the filament itself.
 *
 * `id` namespaces the gradients and filters so more than one mark can share a
 * page. The same geometry is written out in public/icon.svg and in the
 * constants at the top of tools/make-icons.mjs; change it in all three.
 */
export function WaifaiBrandMark({
  size = 36,
  id = 'wf',
  ...props
}: SVGProps<SVGSVGElement> & { size?: number; id?: string }): React.JSX.Element {
  const a1 = `${id}-a1`;
  const a2 = `${id}-a2`;
  const a3 = `${id}-a3`;
  const dot = `${id}-dot`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      role="img"
      aria-label="Waifai"
      {...props}
    >
      <defs>
        <radialGradient id={`${id}-t1`} cx="32" cy="39.6" r="9.8" gradientUnits="userSpaceOnUse">
          <stop offset="0.429" stopColor="#B22405" />
          <stop offset="0.537" stopColor="#E85C05" />
          <stop offset="0.629" stopColor="#FF9410" />
          <stop offset="0.686" stopColor="#FFD558" />
          <stop offset="0.714" stopColor="#FFF6CE" />
          <stop offset="0.743" stopColor="#FFD055" />
          <stop offset="0.811" stopColor="#FF8C0C" />
          <stop offset="0.909" stopColor="#E04A04" />
          <stop offset="1" stopColor="#A81F04" />
        </radialGradient>
        <radialGradient id={`${id}-t2`} cx="32" cy="39.6" r="19.8" gradientUnits="userSpaceOnUse">
          <stop offset="0.667" stopColor="#B22405" />
          <stop offset="0.73" stopColor="#E85C05" />
          <stop offset="0.783" stopColor="#FF9410" />
          <stop offset="0.817" stopColor="#FFD558" />
          <stop offset="0.833" stopColor="#FFF6CE" />
          <stop offset="0.85" stopColor="#FFD055" />
          <stop offset="0.89" stopColor="#FF8C0C" />
          <stop offset="0.947" stopColor="#E04A04" />
          <stop offset="1" stopColor="#A81F04" />
        </radialGradient>
        <radialGradient id={`${id}-t3`} cx="32" cy="39.6" r="31" gradientUnits="userSpaceOnUse">
          <stop offset="0.748" stopColor="#B22405" />
          <stop offset="0.796" stopColor="#E85C05" />
          <stop offset="0.836" stopColor="#FF9410" />
          <stop offset="0.862" stopColor="#FFD558" />
          <stop offset="0.874" stopColor="#FFF6CE" />
          <stop offset="0.887" stopColor="#FFD055" />
          <stop offset="0.917" stopColor="#FF8C0C" />
          <stop offset="0.96" stopColor="#E04A04" />
          <stop offset="1" stopColor="#A81F04" />
        </radialGradient>
        <radialGradient id={`${id}-tdot`} cx="30.4" cy="48.3" r="7.6" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFFDF0" />
          <stop offset="0.26" stopColor="#FFDD62" />
          <stop offset="0.55" stopColor="#FF9412" />
          <stop offset="0.82" stopColor="#EF5605" />
          <stop offset="1" stopColor="#A81F04" />
        </radialGradient>
        <linearGradient id={`${id}-sheen`} x1="32" y1="8.65" x2="32" y2="55.4" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFFFFF" stopOpacity="0.34" />
          <stop offset="0.34" stopColor="#FFFFFF" stopOpacity="0.06" />
          <stop offset="0.55" stopColor="#FFFFFF" stopOpacity="0" />
          <stop offset="0.76" stopColor="#8A1A00" stopOpacity="0.12" />
          <stop offset="1" stopColor="#6B1200" stopOpacity="0.34" />
        </linearGradient>
        <filter id={`${id}-glow`} x="-25%" y="-25%" width="150%" height="150%">
          <feGaussianBlur stdDeviation="2" />
        </filter>
        <filter id={`${id}-core`} x="-25%" y="-25%" width="150%" height="150%">
          <feGaussianBlur stdDeviation="0.7" />
        </filter>
        <path id={a1} d="M25.343 41.763A7 7 0 1 1 38.657 41.763" />
        <path id={a2} d="M16.308 44.699A16.5 16.5 0 1 1 47.692 44.699" />
        <path id={a3} d="M6.226 47.974A27.1 27.1 0 1 1 57.774 47.974" />
        <circle id={dot} cx="32" cy="50.1" r="5.2" />
      </defs>

      <g fill="none" strokeLinecap="round">
        {/* The bloom, so the mark lights what it sits on */}
        <g filter={`url(#${id}-glow)`} opacity="0.32" stroke="#FF7A06">
          <use href={`#${a3}`} strokeWidth="7.8" />
          <use href={`#${a2}`} strokeWidth="6.6" />
          <use href={`#${a1}`} strokeWidth="5.6" />
          <use href={`#${dot}`} fill="#FF7A06" stroke="none" />
        </g>

        {/* The tubes themselves, back band first */}
        <use href={`#${a3}`} strokeWidth="7.8" stroke={`url(#${id}-t3)`} />
        <use href={`#${a2}`} strokeWidth="6.6" stroke={`url(#${id}-t2)`} />
        <use href={`#${a1}`} strokeWidth="5.6" stroke={`url(#${id}-t1)`} />
        <use href={`#${dot}`} fill={`url(#${id}-tdot)`} stroke="none" />

        {/* Which way is up */}
        <g stroke={`url(#${id}-sheen)`}>
          <use href={`#${a3}`} strokeWidth="7.8" />
          <use href={`#${a2}`} strokeWidth="6.6" />
          <use href={`#${a1}`} strokeWidth="5.6" />
          <use href={`#${dot}`} fill={`url(#${id}-sheen)`} stroke="none" />
        </g>

        {/* The filament, and the bead's highlight */}
        <g filter={`url(#${id}-core)`} stroke="#FFFBE6" opacity="0.8">
          <use href={`#${a3}`} strokeWidth="1.25" />
          <use href={`#${a2}`} strokeWidth="1.05" />
          <use href={`#${a1}`} strokeWidth="0.9" />
        </g>
        <circle cx="30.3" cy="48.1" r="1.45" fill="#FFFEF6" />
      </g>
    </svg>
  );
}
