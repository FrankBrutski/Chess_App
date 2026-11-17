import { registerSW } from 'virtual:pwa-register';

/** App updates: a new version is downloaded in the background and applied when you tap Reload. */
type Listener = (ready: boolean) => void;
const listeners = new Set<Listener>();
let ready = false;
let reg: ServiceWorkerRegistration | undefined;
let apply: ((reload?: boolean) => Promise<void>) | undefined;

export const appVersion = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
export const buildTime = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : '';

export function startUpdates() {
  apply = registerSW({
    immediate: true,
    onNeedRefresh() {
      ready = true;
      listeners.forEach((l) => l(true));
    },
    onRegisteredSW(_url, r) {
      reg = r;
      // Home-screen apps can stay open for days: look for a new version whenever the app comes back to the front.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void r?.update();
      });
    },
  });
}

export function onUpdateReady(l: Listener) {
  listeners.add(l);
  l(ready);
  return () => { listeners.delete(l); };
}

export async function applyUpdate() {
  if (apply) await apply(true);
  else window.location.reload();
}

/** Ask the server for a newer version now. Resolves true when one is waiting. */
export async function checkForUpdate(): Promise<boolean> {
  await reg?.update();
  // Give a found update a moment to install.
  await new Promise((r) => setTimeout(r, 1500));
  return ready;
}
