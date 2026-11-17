/** Parsing of Stockfish "info" lines. Kept free of browser APIs so it can be unit-tested. */

export interface EngineLine {
  multipv: number;
  depth: number;
  /** Centipawns from White's point of view (undefined when there is a mate score). */
  cp?: number;
  /** Moves to mate from White's point of view: +3 = White mates in 3, -2 = Black mates in 2. */
  mate?: number;
  pv: string[]; // uci moves
}

/**
 * Parse one UCI "info" line. Stockfish reports scores for the side to move;
 * they are flipped here so positive always means White is better.
 */
export function parseInfo(line: string, whiteToMove: boolean): EngineLine | undefined {
  if (!line.startsWith('info ') || !line.includes(' pv ') || line.includes(' currmove ')) return undefined;
  const t = line.split(/\s+/);
  const num = (key: string) => {
    const i = t.indexOf(key);
    return i >= 0 ? Number(t[i + 1]) : undefined;
  };
  const depth = num('depth');
  if (depth === undefined) return undefined;
  if (t.includes('lowerbound') || t.includes('upperbound')) return undefined;
  const sign = whiteToMove ? 1 : -1;
  const si = t.indexOf('score');
  let cp: number | undefined;
  let mate: number | undefined;
  if (si >= 0 && t[si + 1] === 'cp') cp = Number(t[si + 2]) * sign;
  else if (si >= 0 && t[si + 1] === 'mate') mate = Number(t[si + 2]) * sign;
  else return undefined;
  const pv = t.slice(t.indexOf('pv') + 1).filter(Boolean);
  return { multipv: num('multipv') ?? 1, depth, cp, mate, pv };
}

/** "+0.35", "−1.20", "#3", "#−2" */
export function formatScore(l: Pick<EngineLine, 'cp' | 'mate'>): string {
  if (l.mate !== undefined) return l.mate === 0 ? '#' : `#${l.mate > 0 ? '' : '−'}${Math.abs(l.mate)}`;
  const v = (l.cp ?? 0) / 100;
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}`;
}

/** Share of the eval bar for White, 0..1 (smooth, saturating around ±6 pawns). */
export function whiteShare(l: Pick<EngineLine, 'cp' | 'mate'>): number {
  if (l.mate !== undefined) return l.mate > 0 ? 1 : 0;
  const cp = l.cp ?? 0;
  return 1 / (1 + Math.exp(-cp / 250));
}
