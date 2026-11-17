/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';

// Shown in Settings → About, so you can tell which build the phone is running.
const commit = (() => {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try { return execSync('git rev-parse --short HEAD').toString().trim(); } catch { return 'dev'; }
})();

// Content Security Policy for the built app: it may only load its own files and
// talk to lichess.org (study downloads). Anything else is blocked by the browser.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'", // lets the on-device Stockfish (WebAssembly) start; no JS eval
  "style-src 'self' 'unsafe-inline'", // the board positions pieces with inline styles
  "img-src 'self' data: blob:", // piece images are data: URIs
  "connect-src 'self' https://lichess.org",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

const cspPlugin = (): Plugin => ({
  name: 'csp-meta',
  apply: 'build', // the dev server needs inline scripts for hot reload
  transformIndexHtml: (html) =>
    html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
});

// Relative base so the same build works at https://<user>.github.io/<repo>/ or any other host.
export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(commit), __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  plugins: [
    react(),
    cspPlugin(),
    VitePWA({
      registerType: 'prompt', // a new version waits for you to tap Reload (never mid-drill)
      includeAssets: ['apple-touch-icon.png', 'favicon.svg'],
      manifest: {
        name: 'Apiary',
        short_name: 'Apiary',
        description: 'Apiary: a personal opening repertoire reader and trainer',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        background_color: '#f5efe1',
        theme_color: '#f5efe1',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      // Precache everything, including the 1.8 MB Stockfish engine, so the app works fully offline.
      workbox: { globPatterns: ['**/*.{js,css,html,svg,png,woff2,wasm}'], maximumFileSizeToCacheInBytes: 4 * 1024 * 1024 },
    }),
  ],
  test: { include: ['src/**/*.test.ts'] },
});
