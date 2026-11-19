import { useEffect, type ReactNode } from 'react';
import { navigate } from '../router';

const svg = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);
/** Left to right; the most-used tab (Openings) sits under a right thumb. */
const TABS = [
  { id: 'profile', label: 'Profile', path: '/profile', icon: svg(<><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4-6 8-6s7 2 8 6" /></>) },
  { id: 'stings', label: 'Tactics', path: '/stings', icon: svg(<><path d="M12 3v3" /><path d="M7.5 8h9l-1.5 8.5L12 21l-3-4.5z" /></>) },
  { id: 'openings', label: 'Openings', path: '/', icon: svg(<path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z" />) },
  {
    id: 'settings', label: 'Settings', path: '/settings',
    icon: svg(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>),
  },
] as const;

export type TabId = (typeof TABS)[number]['id'];

/** The docked bar on the main screens (hidden inside a comb, a line or a training session). */
export function TabBar({ active }: { active: TabId }) {
  // Pages leave room for the bar while it is shown.
  useEffect(() => {
    document.documentElement.setAttribute('data-tabs', '');
    return () => document.documentElement.removeAttribute('data-tabs');
  }, []);
  return (
    <nav className="tab-bar" aria-label="Sections">
      {TABS.map((t) => (
        <button key={t.id} type="button" className={t.id === active ? 'on' : undefined} aria-current={t.id === active ? 'page' : undefined}
          onClick={() => navigate(t.path)}>
          {t.icon}
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
