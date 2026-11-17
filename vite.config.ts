/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

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
  plugins: [
    react(),
    cspPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png', 'favicon.svg'],
      manifest: {
        name: 'Apiary',
        short_name: 'Apiary',
        description: 'Apiary: a personal opening repertoire reader and trainer',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        background_color: '#fbf6ea',
        theme_color: '#2a1d0e',
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
