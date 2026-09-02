import { useCallback, useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import type { Device } from '@waifai/shared';
import { DeviceCard } from './DeviceCard.tsx';

/**
 * The device shelf.
 *
 * Modelled on the Recents row in Files by Google, which was tracked frame by
 * frame to get this right. Three things came out of that and all three are
 * load-bearing:
 *
 * 1. **It does not snap.** The row comes to rest wherever momentum leaves it,
 *    mid-card as often as not. So this is `overflow-x: auto` with no
 *    `scroll-snap-type`, and the deceleration is the platform's own - which is
 *    the one thing guaranteed to match the phone the reader is holding.
 * 2. **The card is the artwork.** Image to the edges, a scrim only where type
 *    sits on it, name and one line of meta at the bottom, one round overflow
 *    button top-right. No border, no separate caption area.
 * 3. **Peek, don't clip.** The next card is always partly visible, which is the
 *    only affordance the row gets - there are no arrows and no dots.
 *
 * What is ours rather than theirs: the device is a rendered object on a lit
 * stage rather than a photograph, and it turns very slightly as the row
 * scrolls. That is the part that sells them as hardware sitting in a room
 * instead of icons in a list.
 *
 * The card itself lives in `DeviceCard`; this file is only the rail and the
 * parallax that the rail drives.
 */

const CARD_W = 164;

export function DeviceCarousel({
  devices,
  onSelect,
}: {
  devices: Device[];
  onSelect?: (device: Device) => void;
}): React.JSX.Element | null {
  const railRef = useRef<HTMLDivElement | null>(null);
  const [scrollX, setScrollX] = useState(0);
  const pending = useRef(false);
  const lastX = useRef(0);
  const reduced = useReducedMotion() === true;

  /*
   * Scroll position drives the parallax tilt.
   *
   * Coalesced into one rAF and ignored below a 3px move. The tilt is
   * decorative and a frame of lag on it is invisible; a React render per
   * scroll event across a rail of cards is not. The scroll itself is never
   * touched - it stays on the compositor where the platform put it.
   */
  const onScroll = useCallback(() => {
    if (pending.current) return;
    pending.current = true;
    requestAnimationFrame(() => {
      pending.current = false;
      const rail = railRef.current;
      if (!rail) return;
      if (Math.abs(rail.scrollLeft - lastX.current) < 3) return;
      lastX.current = rail.scrollLeft;
      setScrollX(rail.scrollLeft);
    });
  }, []);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    rail.addEventListener('scroll', onScroll, { passive: true });
    return () => rail.removeEventListener('scroll', onScroll);
  }, [onScroll]);

  if (devices.length === 0) return null;

  return (
    <div className="shelf">
      <div className="shelf-rail" ref={railRef}>
        {devices.map((device, i) => (
          <DeviceCard
            key={device.mac}
            device={device}
            index={i}
            tilt={tiltFor(i, scrollX, reduced)}
            reduced={reduced}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

/*
 * How far this card sits from the left edge of the rail, in card widths,
 * turned into degrees. Clamped hard: past one card of travel the tilt stops
 * growing, so a long row does not have a device lying on its side at the far
 * end.
 */
function tiltFor(index: number, scrollX: number, reduced: boolean): number {
  if (reduced) return 0;
  const offset = (index * (CARD_W + 12) - scrollX) / (CARD_W + 12);
  return Math.max(-1, Math.min(1, offset - 0.35)) * 7;
}
