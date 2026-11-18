/** A small ring showing how much is learned, with the percentage (or a dash) inside. */
export function ProgressRing({ done, total, size = 48 }: { done: number; total: number; size?: number }) {
  const r = 20;
  const c = 2 * Math.PI * r;
  const f = total ? done / total : 0;
  const pct = Math.round(f * 100);
  return (
    <svg className="ring" viewBox="0 0 48 48" width={size} height={size} role="img" aria-label={total ? `${pct}% learned` : 'Nothing to drill'}>
      <circle cx="24" cy="24" r={r} className="ring-track" />
      {f > 0 && (
        <circle cx="24" cy="24" r={r} className="ring-fill" strokeDasharray={`${c * f} ${c}`} transform="rotate(-90 24 24)" />
      )}
      <text x="24" y="24" className="ring-text" textAnchor="middle" dominantBaseline="central">
        {total ? (pct === 100 ? '100%' : pct ? `${pct}%` : '0') : '–'}
      </text>
    </svg>
  );
}
