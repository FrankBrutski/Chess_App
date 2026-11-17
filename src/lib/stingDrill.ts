import type { MoveNode, RootNode, Sting, TreeNode } from './model';
import type { Cell } from './srs';
import type { EngineLine } from './uci';
import { stripSan } from './boardMove';

/** Above this (centipawns, for the side that played) a position counts as winning. Frank: +4.00. */
export const WIN_CP = 400;
/** An also-wins line gets full Honey when it's no more than this below the best line. Frank: 2.00. */
export const CLOSE_CP = 200;
const MATE_CP = 100_000;

export const cellKey = (id: string) => `sting:${id}`;

export type FirstMove =
  | { kind: 'best' | 'also'; node: MoveNode }
  | { kind: 'refute'; node: MoveNode }
  | { kind: 'unknown'; node?: MoveNode }; // not in your notes, or an Idea line (never accepted on its own)

/** Judge the first move from the puzzle position against the tagged lines. */
export function judgeFirst(root: RootNode, san: string): FirstMove {
  const node = root.children.find((c) => stripSan(c.san) === stripSan(san));
  if (node?.tag === 'best' || node?.tag === 'also') return { kind: node.tag, node };
  if (node?.tag === 'refute') return { kind: 'refute', node };
  return { kind: 'unknown', node };
}

/** Later in a line: only the main continuation counts; a side line you wrote is shown as a hint. */
export function judgeLater(at: TreeNode, san: string): { ok: true; node: MoveNode } | { ok: false; side?: MoveNode } {
  const main = at.children[0];
  if (main && stripSan(main.san) === stripSan(san)) return { ok: true, node: main };
  return { ok: false, side: at.children.find((c) => stripSan(c.san) === stripSan(san)) };
}

/** An engine line's score for the player who just moved (mate = huge). */
export function scoreFor(line: Pick<EngineLine, 'cp' | 'mate'> | undefined, moverWhite: boolean): number | undefined {
  if (!line) return undefined;
  const sign = moverWhite ? 1 : -1;
  if (line.mate !== undefined) return line.mate === 0 ? -sign * MATE_CP : Math.sign(line.mate) * sign * (MATE_CP - Math.abs(line.mate));
  return line.cp === undefined ? undefined : line.cp * sign;
}

/**
 * Honey for a solved card (only when solved without a mistake).
 * best: full. also: full if it scores above +4.00 and within 2.00 of the best line, else partial.
 * extra (a winning move not in your notes): partial if above +4.00.
 */
export function honeyFor(
  kind: 'best' | 'also' | 'extra',
  full: number,
  scores: { played?: number; best?: number } = {},
): number {
  const partial = Math.ceil(full / 2);
  if (kind === 'best') return full;
  if (kind === 'also') {
    if (scores.played === undefined || scores.best === undefined) return full; // engine unavailable: trust your notes
    return scores.played > WIN_CP && scores.best - scores.played <= CLOSE_CP ? full : partial;
  }
  return scores.played !== undefined && scores.played > WIN_CP ? partial : 0;
}

/** Cards for a drill: due first (most overdue first), then up to `newCount` never-drilled Ready cards (oldest first). */
export function planDrill(cards: Sting[], cells: Map<string, Cell>, now: number, newCount: number): Sting[] {
  const ready = cards.filter((c) => c.status === 'ready' && c.root?.children.some((n) => n.tag === 'best'));
  const due = ready
    .filter((c) => { const cell = cells.get(cellKey(c.id)); return cell && cell.due <= now; })
    .sort((a, b) => cells.get(cellKey(a.id))!.due - cells.get(cellKey(b.id))!.due);
  const fresh = ready.filter((c) => !cells.has(cellKey(c.id))).sort((a, b) => a.createdAt - b.createdAt).slice(0, newCount);
  return [...due, ...fresh];
}
