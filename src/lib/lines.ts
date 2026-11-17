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
  /** How many leading moves this line shares with the line before it (0 for line 1). */
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
export const stripLineMarker = (text: string) => text.replace(new RegExp(LINE_MARKER.source, 'gi'), '').replace(/\s{2,}/g, ' ').trim();

const markerIn = (texts: string[] | undefined) => {
  for (const t of texts ?? []) {
    const m = LINE_MARKER.exec(t);
    if (m) return m[1];
  }
  return undefined;
};

export const fmtMove = (n: MoveNode) => `${moveNumber(n.ply)}${n.san}`;

export function splitLines(root: RootNode, color: 'white' | 'black', names: Record<string, string> = {}): Line[] {
  const paths: { nodes: MoveNode[]; trainable: boolean }[] = [];
  // Iterative DFS so a very deep comb can't overflow the stack; children[0] first.
  const stack: { node: TreeNode; path: MoveNode[]; trainable: boolean }[] = [{ node: root, path: [], trainable: true }];
  while (stack.length) {
    const { node, path, trainable } = stack.pop()!;
    if (node.children.length === 0) {
      if (path.length) paths.push({ nodes: path, trainable });
      continue;
    }
    for (let i = node.children.length - 1; i >= 0; i--) {
      const c = node.children[i];
      const ok = trainable && !(i > 0 && isUserMove(c, color));
      stack.push({ node: c, path: [...path, c], trainable: ok });
    }
  }
  return paths.map((p, i) => {
    const prev = paths[i - 1]?.nodes;
    let shared = 0;
    if (prev) while (shared < prev.length && shared < p.nodes.length && prev[shared] === p.nodes[shared]) shared++;
    // Where it leaves the main line, and where it leaves the line before it.
    const main = paths[0].nodes;
    let off = 0;
    while (off < main.length && off < p.nodes.length && main[off] === p.nodes[off]) off++;
    let label = 'Main line';
    if (i > 0) {
      const own = p.nodes.slice(shared, shared + 2).map(fmtMove);
      label = off < shared ? `${fmtMove(p.nodes[off])} ${shared > off + 1 ? '… ' : ''}${own[0]}` : own.join(' ');
    }
    const id = i === 0 ? 'main' : p.nodes[shared].key;
    const branch = p.nodes[shared];
    // A [Line: …] note on the branch move, or on the move right after it (the two moves of the label).
    const after = p.nodes[shared + 1];
    const marker =
      i === 0
        ? markerIn(root.comments) ?? markerIn(p.nodes[0].startingComments)
        : markerIn(branch.startingComments) ?? markerIn(branch.comments) ??
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
