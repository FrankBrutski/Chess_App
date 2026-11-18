import type { MoveNode, RootNode, TreeNode } from './model';

export interface TreeIndex {
  byId: Map<string, TreeNode>;
  parent: Map<string, TreeNode>;
}

export function indexTree(root: RootNode): TreeIndex {
  const byId = new Map<string, TreeNode>();
  const parent = new Map<string, TreeNode>();
  const stack: TreeNode[] = [root];
  while (stack.length) {
    const n = stack.pop()!;
    byId.set(n.id, n);
    for (const c of n.children) {
      parent.set(c.id, n);
      stack.push(c);
    }
  }
  return { byId, parent };
}

/** Nodes from the root (exclusive) down to `id` (inclusive). */
export function pathTo(idx: TreeIndex, id: string): MoveNode[] {
  const out: MoveNode[] = [];
  let n = idx.byId.get(id);
  while (n && n.id !== 'root') {
    out.unshift(n as MoveNode);
    n = idx.parent.get(n.id);
  }
  return out;
}

export const NAG_SYMBOLS: Record<number, string> = {
  1: '!', 2: '?', 3: '!!', 4: '??', 5: '!?', 6: '?!', 7: '□', 10: '=', 13: '∞',
  14: '⩲', 15: '⩱', 16: '±', 17: '∓', 18: '+−', 19: '−+', 22: '⨀', 32: '⟳', 36: '→', 40: '↑', 132: '⇆', 146: 'N',
};

/** Move-quality NAGs (1–6) get a coloured badge; the rest are shown as plain symbols. */
export function nagClass(nag: number): string {
  switch (nag) {
    case 1: case 3: return 'nag-good';
    case 2: case 4: return 'nag-bad';
    case 5: return 'nag-interesting';
    case 6: return 'nag-dubious';
    default: return 'nag-eval';
  }
}

/** "12." for White's move, "12…" for Black's. */
export function moveNumber(ply: number): string {
  const full = Math.ceil(ply / 2);
  return ply % 2 === 1 ? `${full}.` : `${full}…`;
}

export const isWhiteMove = (ply: number) => ply % 2 === 1;

/** Count moves in a branch (for collapsed-variation summaries). */
export function countMoves(n: MoveNode): number {
  let total = 1;
  for (const c of n.children) total += countMoves(c);
  return total;
}
