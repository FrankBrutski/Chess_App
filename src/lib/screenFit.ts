/**
 * iOS Home Screen apps sometimes lay out fixed elements in a viewport shorter than the screen,
 * which leaves an empty band below the bottom toolbar. Measure the shortfall and expose it as
 * --fix-gap so full-screen layouts can stretch over it. Does nothing in a normal browser tab.
 */
export function startScreenFit() {
  const standalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia?.('(display-mode: standalone)').matches;
  if (!standalone) return;
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;pointer-events:none;visibility:hidden';
  document.body.appendChild(probe);
  const measure = () => {
    const long = Math.max(screen.width, screen.height);
    const short = Math.min(screen.width, screen.height);
    const full = window.innerWidth > window.innerHeight ? short : long;
    const gap = Math.round(full - probe.getBoundingClientRect().bottom);
    // Only a plausible shortfall (status-bar sized); anything else means we measured something odd.
    document.documentElement.style.setProperty('--fix-gap', gap > 0 && gap < 120 ? `${gap}px` : '0px');
  };
  measure();
  window.addEventListener('resize', measure);
  window.addEventListener('orientationchange', () => setTimeout(measure, 300));
  setTimeout(measure, 500);
}
