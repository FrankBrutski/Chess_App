import { makeFen } from 'chessops/fen';
import { makeUci } from 'chessops/util';
import { parseSan, makeSanAndPlay } from 'chessops/san';
import type { LineTag, MoveNode, RootNode, TreeNode } from './model';
import { positionOf } from './boardMove';
import { indexTree } from './tree';
import { epd } from './fen';

export const TAG_LABEL: Record<LineTag, string> = { best: 'Best', also: 'Also wins', refute: 'Refutation', idea: 'Idea' };

/** Deep copy so edits never change the object Dexie / React handed us. */
const clone = (root: RootNode): RootNode => structuredClone(root);

function nextId(root: RootNode): string {
  let max = 0;
  for (const id of indexTree(root).byId.keys()) {
    const m = /^s(\d+)$/.exec(id);
    if (m) max = Math.max(max, +m[1]);
  }
  return `s${max + 1}`;
}

/**
 * Play `san` after node `parentId`. Goes to the existing child if the move is already there,
 * otherwise adds it as a new side line (or main line if it is the first). Returns the new tree and the node id.
 */
export function playMove(root: RootNode, parentId: string, san: string): { root: RootNode; id: string } | undefined {
  const r = clone(root);
  const parent = indexTree(r).byId.get(parentId);
  if (!parent) return undefined;
  const pos = positionOf(parent.fen);
  if (!pos) return undefined;
  const move = parseSan(pos, san);
  if (!move) return undefined;
  const uci = makeUci(move);
  const existing = parent.children.find((c) => c.uci === uci);
  if (existing) return { root, id: existing.id };
  const key = `${epd(parent.fen)}|${uci}`;
  const cleanSan = makeSanAndPlay(pos, move);
  const node: MoveNode = {
    id: nextId(r),
    ply: parent.ply + 1,
    san: cleanSan,
    uci,
    fen: makeFen(pos.toSetup()),
    key,
    comments: [],
    startingComments: [],
    nags: [],
    shapes: [],
    children: [],
  };
  // A new line from the puzzle position starts untagged unless it's the first one, which is the obvious best guess.
  if (parent.id === 'root' && parent.children.length === 0) node.tag = 'best';
  parent.children.push(node);
  return { root: r, id: node.id };
}

/** Change a node: its note, or its tag (first moves only). */
export function editNode(root: RootNode, id: string, patch: { comment?: string; tag?: LineTag | null }): RootNode {
  const r = clone(root);
  const n = indexTree(r).byId.get(id);
  if (!n) return root;
  if (patch.comment !== undefined) n.comments = patch.comment.trim() ? [patch.comment.trim()] : [];
  if (patch.tag !== undefined && n.id !== 'root' && r.children.includes(n as MoveNode)) {
    const m = n as MoveNode;
    if (patch.tag === 'best') {
      // Only one best line; it becomes the main line (first child).
      for (const c of r.children) if (c.tag === 'best' && c !== m) c.tag = 'also';
      r.children = [m, ...r.children.filter((c) => c !== m)];
    }
    if (patch.tag === null) delete m.tag;
    else m.tag = patch.tag;
  }
  return r;
}

/** Remove a move and everything after it. Returns the tree and the id to show next (its parent). */
export function deleteNode(root: RootNode, id: string): { root: RootNode; id: string } {
  const r = clone(root);
  const idx = indexTree(r);
  const parent = idx.parent.get(id);
  if (!parent) return { root, id };
  parent.children = parent.children.filter((c) => c.id !== id);
  return { root: r, id: parent.id };
}

/** Make a side line the main continuation at its branch point. */
export function promote(root: RootNode, id: string): RootNode {
  const r = clone(root);
  const parent = indexTree(r).parent.get(id);
  if (!parent || parent.id === 'root') return r; // first moves are ordered by their tags
  const n = parent.children.find((c) => c.id === id)!;
  parent.children = [n, ...parent.children.filter((c) => c !== n)];
  return r;
}

/** The first move (from the puzzle position) of the line a node is on. */
export function lineStart(root: RootNode, id: string): MoveNode | undefined {
  const idx = indexTree(root);
  let n: TreeNode | undefined = idx.byId.get(id);
  while (n && n.id !== 'root') {
    const p = idx.parent.get(n.id);
    if (p?.id === 'root') return n as MoveNode;
    n = p;
  }
  return undefined;
}

/** What stops a card from being Ready (empty = it can be marked Ready). */
export function readyProblems(root: RootNode | undefined): string[] {
  if (!root) return ['Set up the position first.'];
  const best = root.children.filter((c) => c.tag === 'best');
  const out: string[] = [];
  if (best.length === 0) out.push('Play the winning move and tag its line Best.');
  if (best.length > 1) out.push('Only one line can be Best.');
  const untagged = root.children.filter((c) => !c.tag);
  if (untagged.length) out.push(`Tag every first move: ${untagged.map((c) => c.san).join(', ')} ${untagged.length === 1 ? 'has' : 'have'} no tag yet.`);
  return out;
}
