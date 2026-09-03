import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/*
 * The collector's port, read out of the root .env rather than off the ambient
 * environment.
 *
 * It used to be `process.env.PORT`, which is the same variable half the world's
 * dev harnesses set to the port they want *this* server on. When one does, the
 * proxy below quietly points /api at Vite itself and every call in the app
 * comes back 500 with the UI insisting the monitor is unreachable.
 */
function apiPort(): string {
  try {
    const env = readFileSync(new URL('../../.env', import.meta.url), 'utf8');
    // `\d` and `\s`, not `d` and `s`: unescaped, this matched a literal "d"
    // and never fired, so the .env was read and then silently ignored. It only
    // looked like it worked because the fallback below is the same number.
    const found = /^PORT=(\d+)\s*$/m.exec(env);
    if (found?.[1]) return found[1];
  } catch {
    // No .env - a fresh clone, or CI. The default below is the one the server
    // falls back to as well.
  }
  return '8477';
}

const SERVER_PORT = process.env['WAIFAI_API_PORT'] ?? apiPort();

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // The dashboard is opened when something is wrong, which is the worst
      // possible moment to be told a new version needs a manual refresh.
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Waifai',
        short_name: 'Waifai',
        description: 'Is the internet up, is the light on, and who is on the Wi-Fi.',
        start_url: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#1E1F22',
        theme_color: '#FFFFFF',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        /*
         * The app icons are .png and the typeface is a self-hosted woff2, and
         * neither was on this list before - so an offline launch fell back to
         * a system font and a blank icon.
         *
         * Only the one variable face is named. public/fonts also holds around
         * eighty unused faces; globbing all of them precached 5 MB of dead
         * weight onto every phone.
         */
        globPatterns: ['**/*.{js,css,html,svg,png}', 'fonts/Inter-Variable.woff2'],
        navigateFallback: '/index.html',
        // Never let the service worker intercept the live socket.
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            /*
             * Network-first with a short timeout, falling back to the last
             * response. This is what makes the app useful during an outage:
             * the phone still opens to the most recent known state instead of
             * a spinner, and the UI marks it as stale.
             */
            urlPattern: /^.*\/api\/(status|devices|usage|incidents|notices).*$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'waifai-api',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    target: 'es2022',
    // A Pi serving six phones over Wi-Fi benefits more from small files than
    // from the last few percent of minification.
    reportCompressedSize: false,
    rollupOptions: {
      output: {
        manualChunks: {
          // uPlot changes far less often than app code, so keeping it separate
          // means an app update does not re-download the charting library.
          charts: ['uplot'],
          // Same argument for the animation runtime, which is the single
          // largest dependency in the tree. Splitting it keeps a one-line copy
          // change off the critical path for everyone who already has it.
          motion: ['motion/react'],
        },
      },
    },
  },
  server: {
    /*
     * All interfaces, not just loopback. Vite's default binds 127.0.0.1, so
     * the dev server is invisible to every phone on the LAN - which is where
     * this app is actually read.
     */
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        // 127.0.0.1, not localhost: Node resolves "localhost" to ::1 first,
        // the server binds 0.0.0.0 (IPv4 only), and every proxied call comes
        // back 500 with nothing in either log to say why.
        target: `http://127.0.0.1:${SERVER_PORT}`,
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
