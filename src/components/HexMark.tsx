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
