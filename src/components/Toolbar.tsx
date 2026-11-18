import type { ReactNode } from 'react';

export interface ToolItem {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  /** Highlighted (the main action). */
  primary?: boolean;
  /** Toggled on (e.g. the engine). */
  pressed?: boolean;
  title?: string;
}

/** The bar at the bottom of the board screens: icon over a short label. `fixed` pins it to the screen on scrolling pages. */
export function Toolbar({ items, fixed }: { items: ToolItem[]; fixed?: boolean }) {
  return (
    <nav className={`toolbar${fixed ? ' fixed' : ''}`} aria-label="Board controls">
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          className={`tool${it.primary ? ' primary-tool' : ''}${it.pressed ? ' on' : ''}`}
          onClick={it.onClick}
          disabled={it.disabled}
          aria-pressed={it.pressed}
          title={it.title}
        >
          <span className="tool-icon" aria-hidden="true">{it.icon}</span>
          <span className="tool-label">{it.label}</span>
        </button>
      ))}
    </nav>
  );
}

const svg = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
);

/** Simple line icons drawn for Apiary. */
export const Icon = {
  start: svg(<><path d="M6 5v14" /><path d="M18 6l-8 6 8 6z" /></>),
  back: svg(<path d="M16 5l-8 7 8 7" />),
  next: svg(<path d="M8 5l8 7-8 7" />),
  forage: svg(<><path d="M12 3l7.5 4.3v8.6L12 20.2l-7.5-4.3V7.3z" /><path d="M10 10l4 2-4 2z" fill="currentColor" /></>),
  hint: svg(<><path d="M9 18h6" /><path d="M10 21h4" /><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.8V16h5v-.3c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 3z" /></>),
  stop: svg(<rect x="6.5" y="6.5" width="11" height="11" rx="2" />),
  flip: svg(<><path d="M4 9h13l-3-3" /><path d="M20 15H7l3 3" /></>),
  engine: svg(<><path d="M4 19V5" /><path d="M4 19h16" /><path d="M7 15l4-5 3 3 5-7" /></>),
  lines: svg(<><path d="M9 6h11" /><path d="M9 12h11" /><path d="M9 18h11" /><circle cx="4.5" cy="6" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="18" r="1" /></>),
  retry: svg(<><path d="M4 12a8 8 0 1 0 2.4-5.7" /><path d="M4 4v4h4" /></>),
  eye: svg(<><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>),
  skip: svg(<><path d="M5 5l8 7-8 7" /><path d="M19 5v14" /></>),
  settings: svg(<><path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" /><circle cx="9" cy="7" r="2.2" fill="var(--bg)" /><circle cx="15" cy="12" r="2.2" fill="var(--bg)" /><circle cx="8" cy="17" r="2.2" fill="var(--bg)" /></>),
};
