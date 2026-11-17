import type { RootNode, TreeNode } from './model';
import { parseCommentMoves, type CommentPiece, type ParseOptions } from './commentMoves';

export interface NodeAnnotations {
  before: CommentPiece[][];
  after: CommentPiece[][];
}

/** Pre-parse every comment in a chapter once, so rendering stays fast on big studies. */
export function annotateChapter(root: RootNode, opts: ParseOptions = {}): Map<string, NodeAnnotations> {
  const out = new Map<string, NodeAnnotations>();
  const walk = (n: TreeNode, ancestors: TreeNode[]) => {
    const parentAnc = ancestors; // positions before this move
    const before = n.id === 'root' ? [] : ((n as { startingComments: string[] }).startingComments ?? []).map((c) =>
      parseCommentMoves(c, ancestors[ancestors.length - 1], parentAnc.slice(0, -1), opts),
    );
    const after = n.comments.map((c) => parseCommentMoves(c, n, ancestors, opts));
    out.set(n.id, { before, after });
    const next = [...ancestors, n];
    for (const c of n.children) walk(c, next);
  };
  walk(root, []);
  return out;
}

export function countInlineLines(ann: Map<string, NodeAnnotations>): { lines: number; bad: number } {
  let lines = 0;
  let bad = 0;
  for (const a of ann.values()) {
    for (const pieces of [...a.before, ...a.after]) {
      const seen = new Set<unknown>();
      for (const p of pieces) {
        if (p.kind === 'move' && !seen.has(p.line)) { seen.add(p.line); lines++; }
        if (p.kind === 'bad') bad++;
      }
    }
  }
  return { lines, bad };
}
