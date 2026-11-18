/**
 * Some iOS Home Screen apps get a web view that stops short of the screen bottom (iOS keeps the
 * strip by the home indicator for itself and nothing drawn there shows). Detect that and mark
 * <html data-short-view> so the bottom toolbar drops its home-indicator padding, which would
 * otherwise be added on top of the strip iOS already keeps. Does nothing in a browser tab.
 */
const GAP_KEY = 'apiary.topGap.v2'; // v2: new 6px default replaces values saved while tuning
/** The extra space under the status bar (px), tunable in Settings › About so it can be set on the phone itself. */
export function getTopGap(): number {
  try { const v = Number(localStorage.getItem(GAP_KEY)); return localStorage.getItem(GAP_KEY) !== null && Number.isFinite(v) ? v : 6; } catch { return 6; }
}
export function setTopGap(px: number) {
  const v = Math.max(0, Math.min(48, Math.round(px)));
  try { localStorage.setItem(GAP_KEY, String(v)); } catch { /* private mode */ }
  document.documentElement.style.setProperty('--top-gap-user', `${v}px`);
  return v;
}

export function startScreenFit() {
  document.documentElement.style.setProperty('--top-gap-user', `${getTopGap()}px`);
  const standalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia?.('(display-mode: standalone)').matches;
  if (!standalone) return;
  document.documentElement.setAttribute('data-standalone', '');
  const measure = () => {
    const long = Math.max(screen.width, screen.height);
    const short = Math.min(screen.width, screen.height);
    const full = window.innerWidth > window.innerHeight ? short : long;
    // innerHeight, not html clientHeight: on iOS 18 the latter reports the short (svh) height even when
    // the app is drawn to the bottom edge (measured on an iPhone: window 874, client 812, fixed box 874).
    const gap = full - window.innerHeight;
    if (gap > 8) document.documentElement.setAttribute('data-short-view', '');
    else document.documentElement.removeAttribute('data-short-view');
  };
  measure();
  window.addEventListener('resize', measure);
  window.addEventListener('orientationchange', () => setTimeout(measure, 300));
  setTimeout(measure, 500);
}
