import { useEffect, useMemo, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import type { Device } from '@waifai/shared';
import {
  Async,
  Button,
  Hint,
  SearchField,
  Segmented,
  Switch,
  ago,
  localTime,
} from '../components/ui.tsx';
import { PageHeader } from '../components/PageHeader.tsx';
import { endpoints, useApi } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { DeviceCard } from '../components/DeviceCard.tsx';
import { GuestWifi } from '../components/GuestWifi.tsx';
import { Sheet } from '../components/Sheet.tsx';

type Filter = 'online' | 'unnamed' | 'all';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'online', label: 'Online' },
  { value: 'unnamed', label: 'Unnamed' },
  { value: 'all', label: 'All' },
];

/** The words in the field, against every name a device answers to. */
function matchesQuery(device: Device, needle: string): boolean {
  if (needle === '') return true;
  return [device.label, device.hostname, device.vendor, device.owner, device.ip, device.mac]
    .filter(Boolean)
    .some((field) => String(field).toLowerCase().includes(needle));
}

function matchesFilter(device: Device, filter: Filter): boolean {
  if (filter === 'online') return device.online;
  if (filter === 'unnamed') return device.label === null;
  return true;
}

/**
 * The roster, once.
 *
 * This screen used to render the same devices three times over: a shelf of
 * cards, a grid of counts that could be got by looking at the shelf, and a
 * list of rows restating the shelf in words. The cards won - a device is an
 * object in a flat, and objects are recognised by picture faster than they
 * are read by name - so the list folded into them and the counts went.
 *
 * What the row carried that a card cannot hold now lives in a sheet: naming,
 * ownership, the mains-witness switch, and the rest of the addresses. That is
 * the right trade. They are things you go looking for one device at a time,
 * and they were being shown for every device at once.
 */
export function Devices(): React.JSX.Element {
  const devices = useApi<{ devices: Device[] }>('/devices');
  const [filter, setFilter] = useState<Filter>('online');
  const [query, setQuery] = useState('');

  const roster = devices.data?.devices ?? null;
  const needle = query.trim().toLowerCase();

  /*
   * The counts are taken after the search, not before it. That is what makes
   * them worth carrying in the control rather than in a line of their own:
   * the number on a tab is how many devices you would be looking at if you
   * pressed it, so the row answers "is what I am looking for hiding behind a
   * different filter" without pressing anything.
   */
  const counts = useMemo(() => {
    const within = (roster ?? []).filter((d) => matchesQuery(d, needle));
    return {
      online: within.filter((d) => matchesFilter(d, 'online')).length,
      unnamed: within.filter((d) => matchesFilter(d, 'unnamed')).length,
      all: within.length,
    };
  }, [roster, needle]);

  return (
    <>
      <PageHeader title="Devices" />

      {/*
        The field and the filter it works with, in that order and next to each
        other. They used to be a screen apart - the filter in the page header,
        the field in the header of a card halfway down - which put the two
        halves of one question in two different places.
      */}
      <SearchField
        value={query}
        onChange={setQuery}
        label="Search devices"
        placeholder="Name, owner, address or vendor"
      />

      {roster !== null && (
        <Segmented<Filter>
          wide
          label="Filter"
          value={filter}
          onChange={setFilter}
          options={FILTERS.map((f) => ({ ...f, count: counts[f.value] }))}
        />
      )}

      <Async state={devices}>
        {(data) => (
          <DeviceGrid
            devices={data.devices}
            filter={filter}
            query={query}
            onChange={devices.reload}
          />
        )}
      </Async>

      {/*
        Handing the Wi-Fi to a visitor is a device task, not a home-screen one.
        It sat at the bottom of Home, below six cards about the state of the
        line, for a thing you reach for while someone is standing next to you.
      */}
      <GuestWifi />
    </>
  );
}

function DeviceGrid({
  devices,
  filter,
  query,
  onChange,
}: {
  devices: Device[];
  filter: Filter;
  query: string;
  onChange: () => void;
}): React.JSX.Element {
  const reduced = useReducedMotion() === true;
  const [editing, setEditing] = useState<string | null>(null);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return devices
      .filter((d) => matchesFilter(d, filter) && matchesQuery(d, needle))
      .sort((a, b) => {
        if (a.online !== b.online) return a.online ? -1 : 1;
        // Named devices before unnamed ones. This compared `a` with itself
        // before, so the whole clause was dead.
        const aNamed = a.label !== null;
        const bNamed = b.label !== null;
        if (aNamed !== bNamed) return aNamed ? -1 : 1;
        return b.lastSeen - a.lastSeen;
      });
  }, [devices, filter, query]);

  /*
   * Held as an address rather than as an object, so an edit that reloads the
   * roster leaves the open sheet showing what was saved instead of what it
   * was opened with.
   */
  const target = editing === null ? null : (devices.find((d) => d.mac === editing) ?? null);

  /*
   * The one thing on the old stat grid that was not a count of what is
   * already on screen. With no mains-only device marked, a power cut cannot
   * be told from the router being switched off, and nothing else in the app
   * says so.
   */
  const noWitness = devices.length > 0 && devices.every((d) => !d.mainsWitness);

  return (
    <>
      {noWitness && (
        <p className="notice notice-info">
          Nothing here is marked as always plugged into the wall, so a power cut cannot be told
          apart from the router being switched off. Open a device that never runs on a battery and
          turn that switch on.
        </p>
      )}

      {shown.length === 0 ? (
        <p className="muted">
          {query.trim() === '' ? 'Nothing matches this filter.' : `Nothing matches “${query}”.`}
        </p>
      ) : (
        <div className="device-grid">
          {shown.map((d, i) => (
            <DeviceCard
              key={d.mac}
              device={d}
              index={i}
              tilt={0}
              reduced={reduced}
              showAddress
              onSelect={() => setEditing(d.mac)}
            />
          ))}
        </div>
      )}

      <DeviceEditor device={target} onClose={() => setEditing(null)} onChange={onChange} />
    </>
  );
}

/* -- the edit sheet -------------------------------------------------------- */

function DeviceEditor({
  device,
  onClose,
  onChange,
}: {
  device: Device | null;
  onClose: () => void;
  onChange: () => void;
}): React.JSX.Element {
  /*
   * The sheet slides out over about a third of a second, and it cannot slide
   * out empty. So the last device stays here until another replaces it:
   * `device` going null closes the sheet, it does not blank it.
   */
  const [shown, setShown] = useState<Device | null>(device);
  useEffect(() => {
    if (device !== null) setShown(device);
  }, [device]);

  const name = shown === null ? '' : (shown.label ?? shown.hostname ?? shown.vendor ?? shown.mac);

  return (
    <Sheet open={device !== null} title={name} onClose={onClose}>
      {shown !== null && (
        /*
         * Keyed by address: opening a second device resets the fields rather
         * than carrying the first one's half-typed name across.
         */
        <DeviceForm key={shown.mac} device={shown} onClose={onClose} onChange={onChange} />
      )}
    </Sheet>
  );
}

function DeviceForm({
  device,
  onClose,
  onChange,
}: {
  device: Device;
  onClose: () => void;
  onChange: () => void;
}): React.JSX.Element {
  const [label, setLabel] = useState(device.label ?? '');
  const [owner, setOwner] = useState(device.owner ?? '');
  const [witness, setWitness] = useState(device.mainsWitness);
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();

  const randomised = device.vendor === 'Private address (randomised)';

  /*
   * One write for the whole sheet. The witness switch used to save the moment
   * it was flipped, which is right for a row in a list and wrong inside a
   * dialog with a Cancel button in it.
   */
  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      await endpoints.updateDevice(device.mac, {
        label: label.trim(),
        owner: owner.trim(),
        trusted: true,
        mainsWitness: witness,
      });
      showToast('Saved', 'success');
      onChange();
      onClose();
    } catch {
      showToast('Could not save this device', 'error', {
        label: 'Retry',
        onPress: () => void save(),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="form-panel">
      <label className="field">
        <span>Name</span>
        <input
          className="input"
          value={label}
          maxLength={64}
          placeholder="Living room TV"
          onChange={(e) => setLabel(e.target.value)}
        />
      </label>

      <label className="field">
        <span>Belongs to</span>
        <input
          className="input"
          value={owner}
          maxLength={64}
          placeholder="Alex"
          onChange={(e) => setOwner(e.target.value)}
        />
      </label>

      {/*
        One line was carrying a label and an explanation at once, which made
        the switch's own name a sentence long. The Tempo sheet keeps those
        apart, and they are different things to read: the label says what the
        switch is, the hint says what turning it on buys you.
      */}
      <div className="field">
        <Switch checked={witness} onChange={setWitness} label="Always plugged into the wall" />
        <Hint>
          Marks this device as mains-only, which is how a power cut is told apart from the router
          being switched off.
        </Hint>
      </div>

      {randomised && device.label === null && (
        <p className="notice notice-info">
          This device rotates its MAC address, so it looks new each time it joins. Naming it stops
          the repeat alerts.
        </p>
      )}

      {/*
        Everything the card has no room for. These were pills on a list row,
        repeated the whole way down the roster, for facts you read one device
        at a time.
      */}
      <dl className="device-facts">
        <div>
          <dt>{device.online ? 'Connected' : 'Last seen'}</dt>
          <dd>{device.online ? connectedLabel(device) : lastSeenLabel(device)}</dd>
        </div>
        <div>
          <dt>Address</dt>
          <dd>{device.ip ?? 'None'}</dd>
        </div>
        <div>
          <dt>MAC</dt>
          <dd>{device.mac}</dd>
        </div>
        <div>
          <dt>Vendor</dt>
          <dd>{device.vendor ?? 'Unknown'}</dd>
        </div>
        <div>
          <dt>Connection</dt>
          <dd>
            {device.connection === 'unknown' ? 'Unknown' : device.connection}
            {device.rssi !== null && ` · ${device.rssi} dBm`}
          </dd>
        </div>
        <div>
          <dt>First seen</dt>
          <dd>{localTime(device.firstSeen)}</dd>
        </div>
      </dl>

      <div className="form-actions">
        <Button variant="primary" busy={saving} onClick={() => void save()}>
          Save
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/*
 * The clock time and the elapsed time together, which is the one place in the
 * app they are both worth having: the card already picked one of them, and
 * this is where you come to settle "since when, and how long is that".
 */
function connectedLabel(device: Device): string {
  if (device.onlineSince === null) return 'Just now';
  return `${localTime(device.onlineSince)} · ${ago(device.onlineSince).replace(/ ago$/, '')}`;
}

function lastSeenLabel(device: Device): string {
  return `${localTime(device.lastSeen)} · ${ago(device.lastSeen)}`;
}
