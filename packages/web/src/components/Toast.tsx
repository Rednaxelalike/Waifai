import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangleIcon, CheckCircleIcon, InfoIcon, XIcon } from './icons.tsx';

export function triggerHaptic(type: 'light' | 'medium' | 'success' | 'warning' = 'light'): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  const pattern = { light: 10, medium: 22, success: [14, 36, 18], warning: [28, 44, 28] }[type];
  try {
    navigator.vibrate(pattern);
  } catch {
    // Vibration is a nicety; a browser refusing it is not an error.
  }
}

type ToastKind = 'success' | 'error' | 'info';

/**
 * One button, at the tail of the message.
 *
 * The Tempo toast carries an action slot, and this app has a use for it that
 * the old one had no room for: everything destructive here - restart, forget a
 * device - announces itself in a toast and then cannot be taken back. An
 * action is how "Restarting" becomes "Restarting / Undo", and how a failed
 * write offers "Retry" instead of asking the reader to find the button again.
 */
interface ToastAction {
  label: string;
  onPress: () => void;
}

interface ToastMessage {
  id: string;
  text: string;
  kind: ToastKind;
  action?: ToastAction;
  /** Set while the toast plays its exit, one frame before it is dropped. */
  leaving?: boolean;
}

/** Matches --d-fast in styles.css; the exit animation runs for exactly this. */
const EXIT_MS = 150;

type ShowToast = (text: string, kind?: ToastKind, action?: ToastAction) => void;

const ToastContext = createContext<{ showToast: ShowToast } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  // Timers are tracked so an unmount mid-flight cannot fire setState afterwards.
  const timers = useRef<number[]>([]);

  useEffect(
    () => () => {
      for (const t of timers.current) window.clearTimeout(t);
    },
    [],
  );

  /*
   * Dismissal is two steps because a toast that vanishes on the frame it is
   * touched reads as a mis-tap rather than as a thing you closed. The row is
   * marked leaving, the exit animation plays, and only then does it go.
   */
  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    timers.current.push(
      window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), EXIT_MS),
    );
  }, []);

  const showToast = useCallback<ShowToast>(
    (text, kind = 'info', action) => {
      triggerHaptic(kind === 'error' ? 'warning' : kind === 'success' ? 'success' : 'light');
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      setToasts((prev) => [...prev.slice(-2), { id, text, kind, action }]);
      // A toast holding a button has to outlast the time it takes to notice
      // there is one and reach it. Everything else keeps the old 3.6s.
      timers.current.push(window.setTimeout(() => dismiss(id), action ? 6000 : 3600));
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}${t.leaving === true ? ' is-leaving' : ''}`}>
            <span className="toast-icon">
              {t.kind === 'success' ? (
                <CheckCircleIcon size={17} />
              ) : t.kind === 'error' ? (
                <AlertTriangleIcon size={17} />
              ) : (
                <InfoIcon size={17} />
              )}
            </span>
            <span className="toast-text">{t.text}</span>
            {t.action && (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  triggerHaptic('light');
                  t.action?.onPress();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            <button
              type="button"
              className="toast-close"
              aria-label="Dismiss"
              onClick={() => dismiss(t.id)}
            >
              <XIcon size={15} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): { showToast: ShowToast } {
  return (
    useContext(ToastContext) ?? {
      showToast: (text: string) => console.warn('[toast]', text),
    }
  );
}
