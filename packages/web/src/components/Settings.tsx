import { useState } from 'react';
import { formatDuration } from '@waifai/shared';
import { Async, Badge, Button, Card, Hint, Segmented, Stat, StatGrid, ago } from './ui.tsx';
import { Sheet } from './Sheet.tsx';
import { endpoints, exportUrl, humanError, useApi, type HealthResponse } from '../lib/api.ts';
import { useToast } from './Toast.tsx';
import { useTheme, type ThemeChoice } from '../lib/theme.ts';
import { DownloadIcon, PowerIcon } from './icons.tsx';

/**
 * Everything that is upkeep rather than monitoring.
 *
 * Three things were pulled in here, each from a place it did not belong. The
 * monitor's own health sat at the bottom of the data screen, where it competed
 * with the numbers the screen exists for. The theme control had a permanent
 * seat in the header, which is prime real estate for something touched twice a
 * year. And Restart was the third of three equal-looking buttons on the home
 * screen, one tap away from a thumb, despite dropping the whole house for a
 * minute and a half.
 */
export function Settings({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element {
  return (
    <Sheet open={open} title="Settings" onClose={onClose}>
      <Appearance />
      <Monitor />
      <Danger onDone={onClose} />
    </Sheet>
  );
}

/* -- appearance ----------------------------------------------------------- */

function Appearance(): React.JSX.Element {
  const { choice, setChoice } = useTheme();

  return (
    <Card title="Appearance">
      <Segmented<ThemeChoice>
        label="Theme"
        value={choice}
        onChange={setChoice}
        options={[
          { value: 'system', label: 'System' },
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
        ]}
      />
    </Card>
  );
}

/*
 * Both of these arrive from the server under the names the code uses for them
 * - `ont`, `wan_ip`, `counters`. Those belong in a log file. On a phone they
 * read as a leak, so the translation happens here and the raw name is only a
 * fallback for a collector added later and not named yet.
 */
const JOB_LABEL: Record<string, string> = {
  probe: 'Reachability',
  ont: 'Router',
  presence: 'Devices',
  speedtest: 'Speed tests',
  maintenance: 'Housekeeping',
};

const READING_LABEL: Record<string, string> = {
  optical: 'Fibre signal',
  pon: 'Line status',
  wan_ip: 'Internet address',
  counters: 'Data used',
  devices: 'Attached devices',
  info: 'Router model',
  uptime: 'Router uptime',
};

/* -- the collector itself ------------------------------------------------- */

function Monitor(): React.JSX.Element {
  const health = useApi<HealthResponse>('/health');

  return (
    <Card title="Monitor">
      <Async state={health}>
        {(h) => {
          /*
           * What the monitor can actually read, rather than how many router
           * pages it took to get there. The page count was the number this
           * card happened to have; the readings are the number that says
           * whether the screens have anything to draw.
           */
          const readings = [...new Set(h.ont.knownPages.flatMap((p) => p.kinds))];

          return (
            <>
              <StatGrid>
                <Stat label="Monitor up" value={formatDuration(h.uptimeSec)} tone="good" />
                <Stat label="Router" value={h.ont.model ?? h.ont.host} hint={h.ont.firmware ?? undefined} />
                <Stat label="Router up" value={h.ont.uptimeSec ? formatDuration(h.ont.uptimeSec) : '—'} />
                <Stat
                  label="Router readings"
                  value={readings.length}
                  tone={readings.length === 0 ? 'bad' : 'good'}
                  hint={readings.length === 0 ? 'nothing readable yet' : 'reading cleanly'}
                />
              </StatGrid>

              {/*
                Whether a phone will actually be told about a cut. The app cannot
                wake a locked phone by itself, so this line is the difference
                between the power log being a record and being an alarm.
              */}
              <div className="setting-row">
                <div className="setting-text">
                  <span className="setting-name">Phone alerts</span>
                  <Hint tone={h.alerts.channels.length === 0 ? 'bad' : 'neutral'}>
                    {h.alerts.channels.length === 0
                      ? 'Not set up, so nobody is told when the light goes.'
                      : `Sent through ${h.alerts.channels.join(' and ')}, at most once every ${h.alerts.cooldownMin} min per condition.`}
                  </Hint>
                </div>
                <Badge tone={h.alerts.channels.length === 0 ? 'warn' : 'good'} dot>
                  {h.alerts.channels.length === 0 ? 'Off' : 'On'}
                </Badge>
              </div>

              <ul className="jobs">
                {h.jobs.map((j) => (
                  <li key={j.name}>
                    <Badge tone={j.lastError !== null ? 'bad' : j.runs > 0 ? 'good' : 'neutral'} dot>
                      {JOB_LABEL[j.name] ?? j.name}
                    </Badge>
                    <span className="muted">
                      {j.runs} runs
                      {j.failures > 0 ? ` · ${j.failures} failed` : ''}
                      {j.lastRun ? ` · ${ago(j.lastRun)}` : ''}
                    </span>
                  </li>
                ))}
              </ul>

              <div className="wifi-actions">
                <a className="btn btn-ghost btn-sm" href={exportUrl('/power.csv?days=90')} download>
                  <DownloadIcon size={14} />
                  <span>Power CSV</span>
                </a>
                <a className="btn btn-ghost btn-sm" href={exportUrl('/uptime.csv?days=90')} download>
                  <DownloadIcon size={14} />
                  <span>Outages CSV</span>
                </a>
              </div>

              {readings.length > 0 && (
                <details className="details">
                  <summary>What is read from the router ({readings.length})</summary>
                  <ul className="page-list">
                    {readings.map((k) => (
                      <li key={k}>{READING_LABEL[k] ?? k}</li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          );
        }}
      </Async>
    </Card>
  );
}

/* -- the one button that hurts -------------------------------------------- */

function Danger({ onDone }: { onDone: () => void }): React.JSX.Element {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const { showToast } = useToast();

  const reboot = async (): Promise<void> => {
    if (!armed) {
      setArmed(true);
      window.setTimeout(() => setArmed(false), 5000);
      return;
    }
    setArmed(false);
    setBusy(true);
    try {
      await endpoints.reboot();
      showToast('Reboot sent. Everything drops for about 90 seconds.', 'info');
      onDone();
    } catch (err) {
      showToast(humanError(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Router">
      <p className="muted">
        Restarting drops every device in the house for about a minute and a half, and the power log
        treats the gap as an unexplained one.
      </p>
      <div className="wifi-actions">
        <Button
          variant={armed ? 'danger' : 'inverted'}
          size="sm"
          busy={busy}
          icon={<PowerIcon size={14} />}
          onClick={() => void reboot()}
        >
          {armed ? 'Tap again to confirm' : 'Restart the router'}
        </Button>
      </div>
    </Card>
  );
}
