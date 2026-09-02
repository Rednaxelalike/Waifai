import { StrictMode, Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles.css';

if (import.meta.env.PROD) {
  void import('virtual:pwa-register')
    .then(({ registerSW }) => registerSW({ immediate: true }))
    .catch(() => {
      // No service worker is a degraded experience, not a broken one.
    });
} else if ('serviceWorker' in navigator) {
  // A worker left over from a production build will happily serve stale assets
  // over the dev server and send it into a reload loop.
  void navigator.serviceWorker
    .getRegistrations()
    .then((all) => Promise.all(all.map((r) => r.unregister())))
    .catch(() => {});
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('Waifai crashed:', error, info);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="crash">
        <div className="crash-card">
          <h1>Something broke</h1>
          <p>{error.message || 'The screen failed to render.'}</p>
          <button type="button" className="btn btn-primary btn-md" onClick={() => location.reload()}>
            <span>Reload</span>
          </button>
        </div>
      </div>
    );
  }
}

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
