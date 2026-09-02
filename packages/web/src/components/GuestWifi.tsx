import { useMemo, useState } from 'react';
import qrcode from 'qrcode-generator';
import { Async, Button, Card } from './ui.tsx';
import { useApi } from '../lib/api.ts';
import { useToast } from './Toast.tsx';
import { canShare, copyText } from '../lib/clipboard.ts';
import { CopyIcon, CheckIcon, ShareIcon, EyeIcon, EyeOffIcon } from './icons.tsx';

/**
 * The card you hold up when a visitor asks for the Wi-Fi.
 *
 * The QR is the point - scanning it joins the network without anyone reading a
 * password aloud - so it gets the space, and the password sits behind a reveal.
 */
export function GuestWifi(): React.JSX.Element | null {
  const wifi = useApi<{ ssid: string; qr: string }>('/wifi');
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const { showToast } = useToast();

  // WIFI_SSID is optional server-side, so a 404 here means "not configured",
  // which is a reason to show nothing rather than an error.
  if (wifi.error !== null && wifi.data === null) return null;

  const handleCopy = async (pass: string): Promise<void> => {
    const ok = await copyText(pass);
    if (!ok) {
      showToast('Could not copy — reveal the password and copy it by hand', 'error');
      return;
    }
    setCopied(true);
    showToast('Password copied', 'success');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = async (ssid: string, pass: string): Promise<void> => {
    try {
      await navigator.share({ title: `Wi-Fi: ${ssid}`, text: `Network: ${ssid}\nPassword: ${pass}` });
    } catch {
      // Dismissing the share sheet is a normal outcome, not a failure.
    }
  };

  return (
    <Card title="Guest Wi-Fi">
      <Async state={wifi}>
        {(data) => {
          const pass = passwordFrom(data.qr);
          return (
            <div className="wifi-card">
              <div className="wifi-qr">
                <QrCode text={data.qr} />
              </div>
              <div className="wifi-detail">
                <span className="wifi-label">Network</span>
                <p className="wifi-ssid">{data.ssid}</p>
                <span className="wifi-label">Password</span>
                <p className={`wifi-pass ${revealed ? '' : 'masked'}`}>
                  {revealed ? pass : '••••••••••'}
                </p>
                <div className="wifi-actions">
                  <Button
                    size="sm"
                    variant="primary"
                    icon={copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
                    onClick={() => void handleCopy(pass)}
                  >
                    {copied ? 'Copied' : 'Copy'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={revealed ? <EyeOffIcon size={14} /> : <EyeIcon size={14} />}
                    onClick={() => setRevealed((v) => !v)}
                  >
                    {revealed ? 'Hide' : 'Reveal'}
                  </Button>
                  {canShare() && (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<ShareIcon size={14} />}
                      onClick={() => void handleShare(data.ssid, pass)}
                    >
                      Share
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        }}
      </Async>
    </Card>
  );
}

function passwordFrom(payload: string): string {
  const m = payload.match(/;P:((?:\\.|[^;])*);/);
  return m?.[1]?.replace(/\\(.)/g, '$1') ?? '';
}

function QrCode({ text }: { text: string }): React.JSX.Element {
  const { path, count } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
      }
    }
    return { path: d, count: n };
  }, [text]);

  return (
    <svg
      className="qr"
      viewBox={`-1.5 -1.5 ${count + 3} ${count + 3}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="Wi-Fi QR code"
    >
      {/* Always light-on-dark-modules, in both themes: a camera has to read it. */}
      <rect x={-1.5} y={-1.5} width={count + 3} height={count + 3} fill="#FFFFFF" />
      <path d={path} fill="#101318" />
    </svg>
  );
}
