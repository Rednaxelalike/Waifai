import { motion } from 'motion/react';
import type { Device } from '@waifai/shared';
import { DevicePicture } from './DevicePicture.tsx';
import { WifiIcon, PowerIcon, MoreIcon } from './icons.tsx';
import { SPRING, stagger } from '../lib/motion.ts';
import { ago, shortTime } from './ui.tsx';

/**
 * One device, as an object standing on a lit stage.
 *
 * Lifted out of the shelf so the two places that show devices draw the same
 * card: the horizontal rail on Home, and the grid on the devices screen. The
 * only difference between them is the tilt - the rail drives it from scroll
 * position, the grid has no scroll of its own and leaves it at zero.
 *
 * `showAddress` is what separates the two readings. On Home the card answers
 * "who is on the network", and an IP address there is noise. On the devices
 * screen the card *is* the device record - it replaced a list row that carried
 * the address - so the address comes with it.
 */
export function DeviceCard({
  device,
  index,
  tilt,
  reduced,
  showAddress = false,
  onSelect,
}: {
  device: Device;
  index: number;
  tilt: number;
  reduced: boolean;
  showAddress?: boolean;
  onSelect?: (device: Device) => void;
}): React.JSX.Element {
  const name = device.label ?? device.hostname ?? device.vendor ?? device.mac;

  /*
   * Signal strength wins the line where the ONT reports it - it is the number
   * that explains a bad stream. Where it does not, the join time goes there
   * rather than the word "Online", which the dot in the corner is already
   * saying.
   */
  const since = device.onlineSince !== null ? `Since ${shortTime(device.onlineSince)}` : 'Online';
  const meta = device.online
    ? device.connection === 'ethernet'
      ? 'Wired'
      : device.rssi !== null
        ? `${device.rssi} dBm`
        : since
    : ago(device.lastSeen);

  return (
    <motion.button
      type="button"
      className={`shelf-card ${device.online ? 'is-online' : 'is-offline'} ${showAddress ? 'has-address' : ''}`}
      initial={reduced ? false : { opacity: 0, y: 18, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ ...SPRING.settle, delay: stagger(index) / 1000 }}
      whileTap={reduced ? undefined : { scale: 0.96 }}
      onClick={() => onSelect?.(device)}
      aria-label={`${name}. ${device.online ? 'Online' : 'Offline'}.`}
    >
      {/* The stage: floor, key light, and the object standing on it. */}
      <span className="shelf-stage" aria-hidden="true">
        <span className="shelf-floor" />
        <span
          className="shelf-object"
          style={{ transform: `perspective(520px) rotateY(${tilt}deg)` }}
        >
          <DevicePicture device={device} size={104} />
        </span>
        <span className="shelf-reflection">
          <DevicePicture device={device} size={104} />
        </span>
      </span>

      <span className="shelf-overflow" aria-hidden="true">
        <MoreIcon size={15} />
      </span>

      {device.mainsWitness && (
        <span className="shelf-badge" title="Power witness">
          <PowerIcon size={12} />
        </span>
      )}

      <span className="shelf-scrim" aria-hidden="true" />

      <span className="shelf-text">
        <span className="shelf-name">{name}</span>
        <span className="shelf-meta">
          {device.online && device.connection !== 'ethernet' && <WifiIcon size={11} />}
          {meta}
        </span>
        {/* Falls back to the MAC: a device with no lease still has an address. */}
        {showAddress && <span className="shelf-address">{device.ip ?? device.mac}</span>}
      </span>

      <span className={`shelf-dot ${device.online ? 'on' : 'off'}`} aria-hidden="true" />
    </motion.button>
  );
}
