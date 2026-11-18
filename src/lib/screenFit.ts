/**
 * Some iOS Home Screen apps get a web view that stops short of the screen bottom (iOS keeps the
 * strip by the home indicator for itself and nothing drawn there shows). Detect that and mark
 * <html data-short-view> so the bottom toolbar drops its home-indicator padding, which would
 * otherwise be added on top of the strip iOS already keeps. Does nothing in a browser tab.
 */
export function startScreenFit() {
  const standalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia?.('(display-mode: standalone)').matches;
  if (!standalone) return;
  const measure = () => {
    const long = Math.max(screen.width, screen.height);
    const short = Math.min(screen.width, screen.height);
    const full = window.innerWidth > window.innerHeight ? short : long;
    const gap = full - Math.min(window.innerHeight, document.documentElement.clientHeight || window.innerHeight);
    if (gap > 8) document.documentElement.setAttribute('data-short-view', '');
    else document.documentElement.removeAttribute('data-short-view');
  };
  measure();
  window.addEventListener('resize', measure);
  window.addEventListener('orientationchange', () => setTimeout(measure, 300));
  setTimeout(measure, 500);
}
