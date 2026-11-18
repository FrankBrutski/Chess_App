import { useEffect, useState } from 'react';

const KEY = 'apiary.screenCheck';
export const screenCheckOn = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
export const setScreenCheck = (on: boolean) => {
  try { if (on) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch { /* private mode */ }
  window.dispatchEvent(new Event('apiary-screencheck'));
};

/** What the screen and the web view report: one screenshot shows where height is lost. */
export function screenNumbers(): [string, string][] {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;visibility:hidden;pointer-events:none';
  for (const side of ['top', 'right', 'bottom', 'left']) probe.style.setProperty(`padding-${side}`, `env(safe-area-inset-${side}, 0px)`);
  document.body.appendChild(probe);
  const c = getComputedStyle(probe);
  const cs = { paddingTop: c.paddingTop, paddingBottom: c.paddingBottom, paddingLeft: c.paddingLeft, paddingRight: c.paddingRight };
  const box = probe.getBoundingClientRect();
  probe.remove();
  const lvh = document.createElement('div');
  lvh.style.cssText = 'position:absolute;top:0;height:100lvh;width:1px;visibility:hidden';
  document.body.appendChild(lvh);
  const lvhH = lvh.getBoundingClientRect().height;
  lvh.style.height = '100dvh';
  const dvhH = lvh.getBoundingClientRect().height;
  lvh.style.height = '100svh';
  const svhH = lvh.getBoundingClientRect().height;
  lvh.remove();
  const bar = document.querySelector('.toolbar')?.getBoundingClientRect();
  const r = (n: number | undefined) => (n === undefined ? '–' : String(Math.round(n * 10) / 10));
  return [
    ['screen', `${screen.width} × ${screen.height} @${devicePixelRatio}x`],
    ['window', `${innerWidth} × ${innerHeight}`],
    ['html client', `${document.documentElement.clientWidth} × ${document.documentElement.clientHeight}`],
    ['html scroll', r(document.documentElement.scrollHeight)],
    ['visualViewport', `${r(visualViewport?.width)} × ${r(visualViewport?.height)} (top ${r(visualViewport?.offsetTop)})`],
    ['fixed inset 0', `top ${r(box.top)} bottom ${r(box.bottom)}`],
    ['lvh / dvh / svh', `${r(lvhH)} / ${r(dvhH)} / ${r(svhH)}`],
    ['safe area', `top ${cs.paddingTop} bottom ${cs.paddingBottom} left ${cs.paddingLeft} right ${cs.paddingRight}`],
    ['standalone', `${matchMedia('(display-mode: standalone)').matches ? 'display-mode yes' : 'display-mode no'} · navigator ${(navigator as Navigator & { standalone?: boolean }).standalone ? 'yes' : 'no'}`],
    ['flags', `${document.documentElement.hasAttribute('data-standalone') ? 'standalone ' : ''}${document.documentElement.hasAttribute('data-short-view') ? 'short-view' : ''}` || 'none'],
    ['toolbar', bar ? `top ${r(bar.top)} bottom ${r(bar.bottom)}` : 'not on this screen'],
    ['iOS', (navigator.userAgent.match(/OS (\d+[_\d]*)/)?.[1] ?? '?').replace(/_/g, '.')],
  ];
}

/**
 * Temporary screen check, switched on in Settings › About. Stripes paint the page itself, so any
 * part of the screen without stripes is outside the web view; the outline is a fixed inset-0 box.
 */
export function ScreenCheckOverlay() {
  const [on, setOn] = useState(screenCheckOn);
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => setOn(screenCheckOn());
    const t = () => tick((n) => n + 1);
    window.addEventListener('apiary-screencheck', f);
    window.addEventListener('resize', t);
    window.addEventListener('hashchange', () => setTimeout(t, 300));
    const id = setInterval(t, 2000);
    return () => { window.removeEventListener('apiary-screencheck', f); window.removeEventListener('resize', t); clearInterval(id); };
  }, []);
  useEffect(() => {
    document.documentElement.toggleAttribute('data-screen-check', on);
  }, [on]);
  if (!on) return null;
  return (
    <>
      <div className="sc-frame" aria-hidden="true" />
      <div className="sc-panel" role="status">
        {screenNumbers().map(([k, v]) => <div key={k}><b>{k}</b> {v}</div>)}
        <button type="button" onClick={() => setScreenCheck(false)}>Hide screen check</button>
      </div>
    </>
  );
}
