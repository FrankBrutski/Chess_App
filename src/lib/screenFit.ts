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

/** Apply the saved top gap, and mark <html data-standalone> in the Home Screen app so it can fill the full screen height. */
export function startScreenFit() {
  document.documentElement.style.setProperty('--top-gap-user', `${getTopGap()}px`);
  const standalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia?.('(display-mode: standalone)').matches;
  if (standalone) document.documentElement.setAttribute('data-standalone', '');
}
