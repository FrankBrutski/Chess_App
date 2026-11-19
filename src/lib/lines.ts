import type { MoveNode, RootNode, TreeNode } from './model';
import { moveNumber, isWhiteMove } from './tree';

/**
 * One line of a comb, Chessable style: a fixed run of moves from the start of the comb to one leaf.
 * Every leaf of the variation tree gives one line, in reading order (line 1 = the main line).
 */
export interface Line {
  /**
   * Stable id: the key (position + move) of the move where this line first leaves the lines
   * before it, or "main" for line 1. Survives re-syncs, so custom names stick.
   */
  id: string;
  /** 1-based number within the comb. */
  number: number;
  /** Moves from the first move to the leaf. */
  nodes: MoveNode[];
  /** Node id of the last move (used in links). Changes on re-import; progress uses move keys instead. */
  leafId: string;
  /** How many leading moves this line shares with the line before it in the list (0 for line 1). */
  shared: number;
  /** Automatic name from where the line branches, e.g. "3…Nf6 4.Ng5"; "Main line" for line 1. */
  label: string;
  /** What to show: your own name, else a [Line: …] note in the study, else the label. */
  name: string;
  /**
   * True when you play the repertoire move (the first choice) at every one of your turns.
   * Lines where you try a different move of your own are kept for reading but not drilled.
   */
  trainable: boolean;
}

export const isUserMove = (n: MoveNode, color: 'white' | 'black') => isWhiteMove(n.ply) === (color === 'white');

/** `[Line: Fried Liver]` in a study comment names the line that starts at that move. */
export const LINE_MARKER = /\[\s*Line\s*:\s*([^\]\n]+?)\s*\]/i;
/** Remove `[Line: …]` markers but keep the study's line breaks and paragraph gaps. */
export const stripLineMarker = (text: string) =>
  text
    .replace(new RegExp(LINE_MARKER.source, 'gi'), '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .trim();

const markerIn = (texts: string[] | undefined) => {
  for (const t of texts ?? []) {
    const m = LINE_MARKER.exec(t);
    if (m) return m[1];
  }
  return undefined;
};

export const fmtMove = (n: MoveNode) => `${moveNumber(n.ply)}${n.san}`;

export interface SplitOptions {
  /** Your own names, by line id. */
  names?: Record<string, string>;
  /**
   * Line order. 'mainLast' (default, Chessable style): at every branch the side lines come first, in the
   * order the study lists them, and the main move's line comes last. 'mainFirst': the main line first.
   */
  order?: 'mainLast' | 'mainFirst';
  /** Your own order for this comb, by line id (Move up / Move down). Overrides `order`; lines not in it keep their place. */
  custom?: string[];
}

/** Put items in `custom` order; an item not listed goes right after the item before it in the natural order. */
export function applyCustomOrder<T extends object>(items: T[], idOf: (t: T) => string, custom?: string[]): T[] {
  if (!custom?.length) return items;
  const byId = new Map(items.map((t) => [idOf(t), t]));
  const out = custom.filter((id) => byId.has(id)).map((id) => byId.get(id)!);
  const placed = new Set(out.map(idOf));
  items.forEach((t, i) => {
    if (placed.has(idOf(t))) return;
    const prev = i > 0 ? out.indexOf(items[i - 1]) : -1;
    out.splice(prev + 1, 0, t);
    placed.add(idOf(t));
  });
  return out;
}

export function splitLines(root: RootNode, color: 'white' | 'black', opts: SplitOptions = {}): Line[] {
  const names = opts.names ?? {};
  const mainLast = (opts.order ?? 'mainLast') === 'mainLast';
  const paths: { nodes: MoveNode[]; trainable: boolean; branch: number }[] = [];
  // Iterative DFS so a very deep comb can't overflow the stack.
  // `branch` = index of the deepest move on the path that isn't its parent's first choice (-1 = main line).
  const stack: { node: TreeNode; path: MoveNode[]; trainable: boolean; branch: number }[] = [{ node: root, path: [], trainable: true, branch: -1 }];
  while (stack.length) {
    const { node, path, trainable, branch } = stack.pop()!;
    if (node.children.length === 0) {
      if (path.length) paths.push({ nodes: path, trainable, branch });
      continue;
    }
    const n = node.children.length;
    // Push in reverse of visiting order.
    const visit = mainLast ? [...Array.from({ length: n - 1 }, (_, i) => i + 1), 0] : Array.from({ length: n }, (_, i) => i);
    for (let j = visit.length - 1; j >= 0; j--) {
      const i = visit[j];
      const c = node.children[i];
      const ok = trainable && !(i > 0 && isUserMove(c, color));
      stack.push({ node: c, path: [...path, c], trainable: ok, branch: i > 0 ? path.length : branch });
    }
  }
  const main = paths.find((p) => p.branch === -1)?.nodes ?? [];
  const pathId = (p: (typeof paths)[number]) => (p.branch < 0 ? 'main' : p.nodes[p.branch].key);
  return applyCustomOrder(paths, pathId, opts.custom).map((p, i, paths) => {
    const prev = paths[i - 1]?.nodes;
    let shared = 0;
    if (prev) while (shared < prev.length && shared < p.nodes.length && prev[shared] === p.nodes[shared]) shared++;
    // Where it leaves the main line, and its own branch move (the deepest move that isn't a first choice).
    let off = 0;
    while (off < main.length && off < p.nodes.length && main[off] === p.nodes[off]) off++;
    const b = p.branch;
    let label = 'Main line';
    if (b >= 0) {
      const own = p.nodes.slice(b, b + 2).map(fmtMove);
      label = off < b ? `${fmtMove(p.nodes[off])} ${b > off + 1 ? '… ' : ''}${own[0]}` : own.join(' ');
    }
    // Stable id: the key of its own branch move, so it doesn't depend on the order or on other lines.
    const id = pathId(p);
    const branchNode = b < 0 ? undefined : p.nodes[b];
    const after = b < 0 ? undefined : p.nodes[b + 1];
    // A [Line: …] note on the branch move, or on the move right after it (the two moves of the label).
    const marker = !branchNode
      ? markerIn(root.comments) ?? markerIn(p.nodes[0].startingComments)
      : markerIn(branchNode.startingComments) ?? markerIn(branchNode.comments) ??
        (after ? markerIn(after.startingComments) ?? markerIn(after.comments) : undefined);
    const name = names[id]?.trim() || marker || label;
    return { id, number: i + 1, nodes: p.nodes, leafId: p.nodes[p.nodes.length - 1].id, shared, label, name, trainable: p.trainable };
  });
}

/** For each move in `line`, the other lines that branch off at that point (alternatives to that move). */
export function branchesAlong(line: Line, lines: Line[]): Map<string, { move: MoveNode; line: Line }[]> {
  const out = new Map<string, { move: MoveNode; line: Line }[]>();
  line.nodes.forEach((n, k) => {
    const seen = new Set<string>([n.id]);
    const alts: { move: MoveNode; line: Line }[] = [];
    for (const other of lines) {
      if (other === line) continue;
      const m = other.nodes[k];
      if (!m || seen.has(m.id)) continue;
      // Same moves before k, a different move at k.
      let same = true;
      for (let j = 0; j < k; j++) if (other.nodes[j] !== line.nodes[j]) { same = false; break; }
      if (!same) continue;
      seen.add(m.id);
      alts.push({ move: m, line: other });
    }
    if (alts.length) out.set(n.id, alts);
  });
  return out;
}

/** The line to open for a node: the first line that passes through it. */
export function lineThrough(lines: Line[], nodeId: string): Line | undefined {
  return lines.find((l) => l.nodes.some((n) => n.id === nodeId));
}
