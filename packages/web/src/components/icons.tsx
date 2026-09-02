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
 * The app mark: a squircle tile with a lit signal arc.
 *
 * Drawn with real depth - a graded base, a specular sweep across the top and a
 * hairline inner bevel - because a flat glyph sitting next to home-screen icons
 * is the thing that reads as unfinished. `id` namespaces the gradients so more
 * than one mark can share a page.
 */
export function WaifaiBrandMark({
  size = 36,
  id = 'wf',
  ...props
}: SVGProps<SVGSVGElement> & { size?: number; id?: string }): React.JSX.Element {
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
        <linearGradient id={`${id}-base`} x1="32" y1="2" x2="32" y2="62" gradientUnits="userSpaceOnUse">
          <stop stopColor="#4A90EE" />
          <stop offset="0.5" stopColor="#2A6FD0" />
          <stop offset="1" stopColor="#153B78" />
        </linearGradient>
        <linearGradient id={`${id}-gloss`} x1="32" y1="3" x2="32" y2="33" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFFFFF" stopOpacity="0.4" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}-arc`} x1="14" y1="20" x2="50" y2="46" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#D8E9FF" />
        </linearGradient>
        <radialGradient
          id={`${id}-bloom`}
          cx="0"
          cy="0"
          r="1"
          gradientUnits="userSpaceOnUse"
          gradientTransform="translate(32 44.4) rotate(90) scale(16)"
        >
          <stop stopColor="#FFFFFF" stopOpacity="0.5" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Squircle body */}
      <path
        d="M32 2c12.2 0 18.3 0 22.4 3.6C58 9.7 62 15.8 62 32s-4 22.3-7.6 26.4C50.3 62 44.2 62 32 62s-18.3 0-22.4-3.6C6 54.3 2 48.2 2 32S6 9.7 9.6 5.6C13.7 2 19.8 2 32 2Z"
        fill={`url(#${id}-base)`}
      />
      {/* Specular sweep across the top third */}
      <path
        d="M32 2c12.2 0 18.3 0 22.4 3.6C57.4 9 61 13.9 61.8 25.5 52 31 42.3 33.6 32 33.6S12 31 2.2 25.5C3 13.9 6.6 9 9.6 5.6 13.7 2 19.8 2 32 2Z"
        fill={`url(#${id}-gloss)`}
      />
      {/* Inner bevel */}
      <path
        d="M32 3.4c11.9 0 17.8 0 21.6 3.3 3.2 3.7 7 9.6 7 25.3s-3.8 21.6-7 25.3c-3.8 3.3-9.7 3.3-21.6 3.3s-17.8 0-21.6-3.3C7.2 53.6 3.4 47.7 3.4 32S7.2 10.4 10.4 6.7C14.2 3.4 20.1 3.4 32 3.4Z"
        stroke="#FFFFFF"
        strokeOpacity="0.26"
        strokeWidth="1.2"
      />
      <circle cx="32" cy="44.4" r="16" fill={`url(#${id}-bloom)`} />
      {/* Signal arcs, softest at the back */}
      <g stroke={`url(#${id}-arc)`} strokeLinecap="round" fill="none" strokeWidth="4.4">
        <path d="M15.5 27.5a23 23 0 0 1 33 0" strokeOpacity="0.42" />
        <path d="M21.5 34.4a14.6 14.6 0 0 1 21 0" strokeOpacity="0.74" />
      </g>
      <circle cx="32" cy="44.4" r="4.6" fill="#FFFFFF" />
    </svg>
  );
}
