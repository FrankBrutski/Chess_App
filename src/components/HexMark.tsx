/** Small honeycomb mark used as the app's logo and as a bullet for hives. */
export function HexMark({ small }: { small?: boolean }) {
  const s = small ? 14 : 26;
  return (
    <svg className="hexmark" width={s} height={s} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 2 28 9v14L16 30 4 23V9z" fill="var(--honey)" />
      <path d="M16 9.5 22 13v6.9L16 23.4 10 20V13z" fill="var(--honey-deep)" />
    </svg>
  );
}

/** A small bee: the mark for tactics (Stings). */
export function StingMark({ small }: { small?: boolean }) {
  const s = small ? 14 : 26;
  return (
    <svg className="hexmark" width={s} height={s} viewBox="0 0 32 32" aria-hidden="true">
      <ellipse cx="11" cy="9" rx="5" ry="7" transform="rotate(-30 11 9)" fill="var(--honey)" opacity=".55" />
      <ellipse cx="21" cy="9" rx="5" ry="7" transform="rotate(30 21 9)" fill="var(--honey)" opacity=".55" />
      <path d="M16 8c5 0 8 4 8 9s-4 8-8 13c-4-5-8-8-8-13s3-9 8-9z" fill="var(--honey)" />
      <path d="M8.6 15h14.8M9 20h14M11 25h10" stroke="var(--text)" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
