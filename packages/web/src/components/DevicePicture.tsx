import type { SVGProps } from 'react';
import type { Device } from '@waifai/shared';

/**
 * Device portraits.
 *
 * These are drawn rather than photographed on purpose: the dashboard has to
 * open during an outage, from a service worker cache, on a phone that may have
 * no route to the internet, so every pixel it needs has to already be in the
 * bundle. Vector portraits also stay crisp at the 28px roster size and the
 * 48px list size, which product photography does not.
 *
 * Each one is modelled on the hardware it stands for - the ONT in particular
 * is the Huawei EchoLife HG8145V5 this project talks to, a 30 x 173 x 120 mm
 * upright white slab with its indicator column low on the front face.
 */

type PictureProps = SVGProps<SVGSVGElement> & { size?: number };

/**
 * Shared canvas.
 *
 * `zoom` exists because a phone is a tall thin object on a square canvas: drawn
 * at its true proportions it fills less than half the frame and reads as a
 * postage stamp next to a laptop. Portrait-shaped devices are scaled up about
 * the centre so every portrait carries roughly the same optical weight.
 */
function Frame({ size = 44, zoom = 1, children, ...props }: PictureProps & { zoom?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true" {...props}>
      {zoom === 1 ? children : <g transform={`translate(32 32) scale(${zoom}) translate(-32 -32)`}>{children}</g>}
    </svg>
  );
}

/** Soft elliptical contact shadow that grounds each object on its surface. */
function Ground({ cy = 57, rx = 17 }: { cy?: number; rx?: number }): React.JSX.Element {
  return <ellipse cx="32" cy={cy} rx={rx} ry="2.4" fill="#0B1220" fillOpacity="0.09" />;
}

/* ==========================================================================
   Huawei EchoLife HG8145V5 - the gateway this project polls
   ========================================================================== */

export function OntPicture(props: PictureProps): React.JSX.Element {
  return (
    <Frame zoom={1.1} {...props}>
      <defs>
        <linearGradient id="wf-ont-face" x1="18" y1="8" x2="44" y2="55" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFFFFF" />
          <stop offset="0.55" stopColor="#F1F3F7" />
          <stop offset="1" stopColor="#D9DEE7" />
        </linearGradient>
        <linearGradient id="wf-ont-side" x1="43" y1="10" x2="49" y2="54" gradientUnits="userSpaceOnUse">
          <stop stopColor="#C6CCD8" />
          <stop offset="1" stopColor="#A2AAB9" />
        </linearGradient>
        <linearGradient id="wf-ont-gloss" x1="20" y1="9" x2="34" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFFFFF" stopOpacity="0.95" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
      </defs>
      <Ground cy={56} rx={15} />
      {/* Depth: the 30mm side face, seen slightly from the right */}
      <path d="M42 9.5c3.4.5 5.6 2.4 5.6 5v34.8c0 2.6-2.2 4.5-5.6 5z" fill="url(#wf-ont-side)" />
      {/* Front face */}
      <rect x="17" y="8" width="26" height="47" rx="5.2" fill="url(#wf-ont-face)" />
      <rect
        x="17.5"
        y="8.5"
        width="25"
        height="46"
        rx="4.8"
        stroke="#98A1B2"
        strokeOpacity="0.45"
        strokeWidth="1"
      />
      {/* Glossy sweep across the upper front */}
      <path d="M17 13.2A5.2 5.2 0 0 1 22.2 8h15.4L21 33.4H17z" fill="url(#wf-ont-gloss)" />
      {/* Vented crown */}
      <g stroke="#AEB6C4" strokeWidth="1.1" strokeLinecap="round" strokeOpacity="0.7">
        <path d="M22.5 13.4h19M22.5 16.2h19" />
      </g>
      {/* Brand plate */}
      <rect x="22.5" y="21.5" width="15" height="2.6" rx="1.3" fill="#C3CAD6" />
      {/* Indicator column - power, PON, LOS, LAN, WLAN */}
      <g>
        <circle cx="23.4" cy="34" r="1.5" fill="#1FA97A" />
        <circle cx="23.4" cy="39" r="1.5" fill="#1FA97A" />
        <circle cx="23.4" cy="44" r="1.5" fill="#3987E5" />
        <circle cx="23.4" cy="49" r="1.5" fill="#3987E5" />
      </g>
      <g fill="#B9C0CC">
        <rect x="28" y="33.1" width="11" height="1.8" rx="0.9" />
        <rect x="28" y="38.1" width="8.4" height="1.8" rx="0.9" />
        <rect x="28" y="43.1" width="9.8" height="1.8" rx="0.9" />
        <rect x="28" y="48.1" width="7" height="1.8" rx="0.9" />
      </g>
    </Frame>
  );
}

/* ==========================================================================
   Phones
   ========================================================================== */

export function IphonePicture(props: PictureProps): React.JSX.Element {
  return (
    <Frame zoom={1.14} {...props}>
      <defs>
        <linearGradient id="wf-ip-body" x1="18" y1="4" x2="46" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8E96A6" />
          <stop offset="0.5" stopColor="#5C6474" />
          <stop offset="1" stopColor="#343B49" />
        </linearGradient>
        <linearGradient id="wf-ip-screen" x1="20" y1="7" x2="44" y2="55" gradientUnits="userSpaceOnUse">
          <stop stopColor="#1C2740" />
          <stop offset="0.55" stopColor="#243D6E" />
          <stop offset="1" stopColor="#0F1729" />
        </linearGradient>
        <linearGradient id="wf-ip-gloss" x1="19" y1="6" x2="36" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFFFFF" stopOpacity="0.3" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
      </defs>
      <Ground cy={58} rx={13} />
      <rect x="18" y="4" width="28" height="53" rx="7.6" fill="url(#wf-ip-body)" />
      <rect x="19.6" y="5.6" width="24.8" height="49.8" rx="6.2" fill="url(#wf-ip-screen)" />
      <path d="M19.6 11.8a6.2 6.2 0 0 1 6.2-6.2h18.6v14.8L19.6 34z" fill="url(#wf-ip-gloss)" />
      {/* Dynamic Island */}
      <rect x="28.2" y="8" width="7.6" height="2.6" rx="1.3" fill="#0A0D14" />
      {/* Home indicator */}
      <rect x="27.6" y="52.2" width="8.8" height="1.2" rx="0.6" fill="#FFFFFF" fillOpacity="0.75" />
      {/* Side buttons */}
      <rect x="45.4" y="18" width="1.4" height="7" rx="0.7" fill="#242A36" />
      <rect x="17.2" y="16" width="1.4" height="5" rx="0.7" fill="#242A36" />
    </Frame>
  );
}

export function GalaxyPicture(props: PictureProps): React.JSX.Element {
  return (
    <Frame zoom={1.14} {...props}>
      <defs>
        <linearGradient id="wf-gx-body" x1="17" y1="4" x2="47" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3A414F" />
          <stop offset="0.5" stopColor="#232833" />
          <stop offset="1" stopColor="#12151C" />
        </linearGradient>
        <linearGradient id="wf-gx-screen" x1="19" y1="6" x2="45" y2="56" gradientUnits="userSpaceOnUse">
          <stop stopColor="#101A33" />
          <stop offset="0.5" stopColor="#2B1E58" />
          <stop offset="1" stopColor="#160F2B" />
        </linearGradient>
        <linearGradient id="wf-gx-gloss" x1="19" y1="6" x2="35" y2="28" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFFFFF" stopOpacity="0.26" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
      </defs>
      <Ground cy={58} rx={13} />
      {/* Squared-off Ultra chassis */}
      <rect x="17.5" y="4" width="29" height="53" rx="3" fill="url(#wf-gx-body)" />
      <rect x="19" y="5.4" width="26" height="50.2" rx="2.2" fill="url(#wf-gx-screen)" />
      <path d="M19 5.4h26v11.6L19 31z" fill="url(#wf-gx-gloss)" />
      {/* Centred punch-hole camera */}
      <circle cx="32" cy="9" r="1.15" fill="#05070C" />
      <rect x="27.8" y="53" width="8.4" height="1.1" rx="0.55" fill="#FFFFFF" fillOpacity="0.7" />
      <rect x="46" y="17" width="1.3" height="8" rx="0.65" fill="#171B23" />
    </Frame>
  );
}

/* ==========================================================================
   Computers
   ========================================================================== */

export function LaptopPicture(props: PictureProps): React.JSX.Element {
  return (
    <Frame {...props}>
      <defs>
        <linearGradient id="wf-lp-lid" x1="10" y1="12" x2="54" y2="42" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8B93A3" />
          <stop offset="1" stopColor="#4E5665" />
        </linearGradient>
        <linearGradient id="wf-lp-screen" x1="12" y1="14" x2="52" y2="40" gradientUnits="userSpaceOnUse">
          <stop stopColor="#16233E" />
          <stop offset="0.55" stopColor="#1E3A6B" />
          <stop offset="1" stopColor="#0E1626" />
        </linearGradient>
        <linearGradient id="wf-lp-deck" x1="6" y1="43" x2="58" y2="52" gradientUnits="userSpaceOnUse">
          <stop stopColor="#E4E8EF" />
          <stop offset="0.5" stopColor="#C3CAD6" />
          <stop offset="1" stopColor="#98A1B2" />
        </linearGradient>
        <linearGradient id="wf-lp-gloss" x1="12" y1="14" x2="34" y2="34" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFFFFF" stopOpacity="0.24" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
      </defs>
      <Ground cy={54.5} rx={24} />
      <rect x="10" y="11" width="44" height="31" rx="3" fill="url(#wf-lp-lid)" />
      <rect x="12" y="13" width="40" height="26" rx="1.6" fill="url(#wf-lp-screen)" />
      <path d="M12 13h40v9L12 33z" fill="url(#wf-lp-gloss)" />
      <circle cx="32" cy="12" r="0.7" fill="#0C1220" />
      {/* Deck, seen almost edge on */}
      <path
        d="M6.5 43.5a1.6 1.6 0 0 1 1.6-1.5h47.8a1.6 1.6 0 0 1 1.6 1.5l-1.1 5.1a2.4 2.4 0 0 1-2.35 1.9H9.95A2.4 2.4 0 0 1 7.6 48.6z"
        fill="url(#wf-lp-deck)"
      />
      <rect x="25.4" y="42" width="13.2" height="1.5" rx="0.75" fill="#7C8496" />
      <rect x="24.8" y="45.4" width="14.4" height="3.4" rx="1" fill="#DCE1E9" />
    </Frame>
  );
}

export function DesktopPicture(props: PictureProps): React.JSX.Element {
  return (
    <Frame {...props}>
      <defs>
        <linearGradient id="wf-dk-screen" x1="8" y1="9" x2="56" y2="40" gradientUnits="userSpaceOnUse">
          <stop stopColor="#16233E" />
          <stop offset="0.55" stopColor="#1E3A6B" />
          <stop offset="1" stopColor="#0E1626" />
        </linearGradient>
        <linearGradient id="wf-dk-frame" x1="6" y1="7" x2="58" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8B93A3" />
          <stop offset="1" stopColor="#4A5261" />
        </linearGradient>
      </defs>
      <Ground cy={56} rx={16} />
      <rect x="6" y="7" width="52" height="35" rx="3.4" fill="url(#wf-dk-frame)" />
      <rect x="8.4" y="9.4" width="47.2" height="27.6" rx="1.8" fill="url(#wf-dk-screen)" />
      <path d="M8.4 9.4h47.2v9L8.4 30z" fill="#FFFFFF" fillOpacity="0.12" />
      <path d="M28 42h8l1.6 9h-11.2z" fill="#9AA3B2" />
      <rect x="21" y="51" width="22" height="3.2" rx="1.6" fill="#7E8798" />
    </Frame>
  );
}

/* ==========================================================================
   Living room and everything else
   ========================================================================== */

export function TvPicture(props: PictureProps): React.JSX.Element {
  return (
    <Frame {...props}>
      <defs>
        <linearGradient id="wf-tv-screen" x1="5" y1="9" x2="59" y2="43" gradientUnits="userSpaceOnUse">
          <stop stopColor="#173056" />
          <stop offset="0.5" stopColor="#2E4E96" />
          <stop offset="1" stopColor="#101A2E" />
        </linearGradient>
      </defs>
      <Ground cy={56} rx={18} />
      <rect x="4" y="8" width="56" height="35" rx="2.6" fill="#1B2028" />
      <rect x="5.6" y="9.6" width="52.8" height="30.6" rx="1.4" fill="url(#wf-tv-screen)" />
      <path d="M5.6 9.6h52.8v10L5.6 32z" fill="#FFFFFF" fillOpacity="0.1" />
      <path d="M27.5 43h9l1.4 8h-11.8z" fill="#39404D" />
      <rect x="20" y="51" width="24" height="3.2" rx="1.6" fill="#2A303B" />
    </Frame>
  );
}

export function TabletPicture(props: PictureProps): React.JSX.Element {
  return (
    <Frame zoom={1.08} {...props}>
      <defs>
        <linearGradient id="wf-tb-body" x1="12" y1="5" x2="52" y2="59" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8E96A6" />
          <stop offset="1" stopColor="#3C4453" />
        </linearGradient>
        <linearGradient id="wf-tb-screen" x1="14" y1="7" x2="50" y2="57" gradientUnits="userSpaceOnUse">
          <stop stopColor="#15233F" />
          <stop offset="0.55" stopColor="#22467F" />
          <stop offset="1" stopColor="#0E1728" />
        </linearGradient>
      </defs>
      <Ground cy={59} rx={18} />
      <rect x="12" y="5" width="40" height="53" rx="4.4" fill="#5C6474" />
      <rect x="14" y="7" width="36" height="49" rx="3" fill="url(#wf-tb-screen)" />
      <path d="M14 7h36v12L14 33z" fill="#FFFFFF" fillOpacity="0.16" />
      <circle cx="32" cy="6" r="0.7" fill="#0B1120" />
    </Frame>
  );
}

export function WatchPicture(props: PictureProps): React.JSX.Element {
  return (
    <Frame zoom={1.1} {...props}>
      <defs>
        <linearGradient id="wf-wt-screen" x1="19" y1="17" x2="45" y2="47" gradientUnits="userSpaceOnUse">
          <stop stopColor="#152444" />
          <stop offset="0.55" stopColor="#27519B" />
          <stop offset="1" stopColor="#0E1626" />
        </linearGradient>
      </defs>
      <Ground cy={58} rx={11} />
      <path d="M25 5h14l-1.4 11H26.4z" fill="#4A5261" />
      <path d="M26.4 48h11.2L39 59H25z" fill="#4A5261" />
      <rect x="17" y="14" width="30" height="36" rx="9.5" fill="#767E8E" />
      <rect x="18.8" y="15.8" width="26.4" height="32.4" rx="8.2" fill="url(#wf-wt-screen)" />
      <path d="M18.8 24a8.2 8.2 0 0 1 8.2-8.2h18.2v6.2L18.8 34z" fill="#FFFFFF" fillOpacity="0.16" />
      <rect x="46.6" y="24" width="2.4" height="6" rx="1.2" fill="#8A92A2" />
    </Frame>
  );
}

export function ConsolePicture(props: PictureProps): React.JSX.Element {
  return (
    <Frame {...props}>
      <defs>
        <linearGradient id="wf-cs-body" x1="8" y1="16" x2="56" y2="48" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3A414F" />
          <stop offset="1" stopColor="#171B23" />
        </linearGradient>
      </defs>
      <Ground cy={52} rx={21} />
      <rect x="8" y="16" width="48" height="32" rx="4.4" fill="url(#wf-cs-body)" />
      <path d="M8 22.6h48" stroke="#3987E5" strokeWidth="1.6" strokeOpacity="0.85" />
      <path d="M8 20.4a4.4 4.4 0 0 1 4.4-4.4h39.2a4.4 4.4 0 0 1 4.4 4.4v.6L8 27.6z" fill="#FFFFFF" fillOpacity="0.12" />
      <circle cx="16" cy="38" r="2" fill="#1FA97A" />
      <rect x="34" y="35.6" width="14" height="4.8" rx="2.4" fill="#0F131A" />
    </Frame>
  );
}

export function SingleBoardPicture(props: PictureProps): React.JSX.Element {
  return (
    <Frame {...props}>
      <defs>
        <linearGradient id="wf-sb-board" x1="8" y1="14" x2="56" y2="50" gradientUnits="userSpaceOnUse">
          <stop stopColor="#1C6B4F" />
          <stop offset="1" stopColor="#0E3B2C" />
        </linearGradient>
      </defs>
      <Ground cy={52} rx={21} />
      <rect x="8" y="15" width="48" height="32" rx="3.2" fill="url(#wf-sb-board)" />
      <rect x="8" y="15" width="48" height="7" rx="3.2" fill="#FFFFFF" fillOpacity="0.1" />
      {/* SoC and headers */}
      <rect x="24" y="26" width="14" height="12" rx="1.6" fill="#0B1F18" />
      <rect x="26" y="28" width="10" height="8" rx="0.8" fill="#2C7A5D" />
      <g fill="#C9A227">
        <rect x="12" y="18" width="26" height="2.4" rx="1.2" />
      </g>
      <rect x="42" y="26" width="10" height="7" rx="1.4" fill="#8C95A6" />
      <circle cx="14" cy="42" r="1.6" fill="#1FA97A" />
      <circle cx="19" cy="42" r="1.6" fill="#E5484D" />
    </Frame>
  );
}

export function SpeakerPicture(props: PictureProps): React.JSX.Element {
  return (
    <Frame {...props}>
      <defs>
        <linearGradient id="wf-sp-body" x1="20" y1="10" x2="46" y2="54" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6E7686" />
          <stop offset="1" stopColor="#2C323D" />
        </linearGradient>
      </defs>
      <Ground cy={55} rx={14} />
      <rect x="20" y="10" width="24" height="44" rx="11" fill="url(#wf-sp-body)" />
      <rect x="22" y="12" width="20" height="40" rx="9.5" fill="#1B2029" />
      <path d="M22 21.5A9.5 9.5 0 0 1 31.5 12H42v6L22 32z" fill="#FFFFFF" fillOpacity="0.14" />
      <circle cx="32" cy="45" r="4.6" stroke="#3987E5" strokeWidth="1.6" opacity="0.8" />
    </Frame>
  );
}

/* ==========================================================================
   Matching
   ========================================================================== */

/**
 * Word-boundary match.
 *
 * Substring matching is what made the old version put a router portrait on
 * anything containing "ap" - which includes "laptop" and "apple". Anchoring
 * each term to a boundary is the whole fix.
 */
function has(haystack: string, ...terms: string[]): boolean {
  return terms.some((t) => new RegExp(`(^|[^a-z0-9])${t}([^a-z0-9]|$)`).test(haystack));
}

/** Pick the portrait that best matches whatever the network told us about a device. */
export function DevicePicture({
  device,
  size = 46,
  className = '',
}: {
  device: Device;
  size?: number;
  className?: string;
}): React.JSX.Element {
  const text = [device.label, device.hostname, device.vendor]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const p = { size, className };

  // The gateway is matched first and by model, so the one box this whole app
  // exists to watch is never mistaken for a generic phone.
  if (
    has(text, 'hg8145v5', 'hg8145', 'eg8145', 'echolife', 'ont', 'gateway', 'router', 'modem', 'onu') ||
    has(text, 'access', 'point') ||
    (has(text, 'huawei') && !has(text, 'phone', 'nova', 'mate'))
  ) {
    return <OntPicture {...p} />;
  }

  if (has(text, 'iphone') || has(text, 'ios')) return <IphonePicture {...p} />;
  if (has(text, 'ipad')) return <TabletPicture {...p} />;
  if (has(text, 'macbook', 'mbp', 'mba')) return <LaptopPicture {...p} />;
  if (has(text, 'watch')) return <WatchPicture {...p} />;
  if (has(text, 'appletv') || (has(text, 'apple') && has(text, 'tv'))) return <TvPicture {...p} />;

  if (has(text, 'galaxy', 'samsung') && !has(text, 'tv')) return <GalaxyPicture {...p} />;

  if (has(text, 'pixel', 'android', 'xiaomi', 'redmi', 'poco', 'oppo', 'vivo', 'oneplus', 'infinix', 'tecno', 'itel', 'phone', 'mobile')) {
    return <GalaxyPicture {...p} />;
  }

  if (has(text, 'tv', 'roku', 'firestick', 'chromecast', 'bravia', 'hisense', 'lg', 'shield')) {
    return <TvPicture {...p} />;
  }

  if (has(text, 'tablet', 'tab')) return <TabletPicture {...p} />;

  if (has(text, 'playstation', 'ps4', 'ps5', 'xbox', 'nintendo', 'console')) {
    return <ConsolePicture {...p} />;
  }

  if (has(text, 'raspberry', 'raspberrypi', 'rpi', 'pi', 'nas', 'synology', 'qnap', 'server')) {
    return <SingleBoardPicture {...p} />;
  }

  if (has(text, 'echo', 'sonos', 'homepod', 'speaker', 'nest')) return <SpeakerPicture {...p} />;

  if (has(text, 'laptop', 'notebook', 'thinkpad', 'latitude', 'inspiron', 'lenovo', 'asus', 'acer', 'dell', 'hp')) {
    return <LaptopPicture {...p} />;
  }

  if (has(text, 'desktop', 'imac', 'workstation')) return <DesktopPicture {...p} />;

  // Nothing matched. A wired device in a Nigerian flat is far more likely to be
  // a desk machine than a handset; anything on Wi-Fi is far more likely to be a
  // phone. Guessing along those odds beats showing a question mark.
  return device.connection === 'ethernet' ? <DesktopPicture {...p} /> : <GalaxyPicture {...p} />;
}
