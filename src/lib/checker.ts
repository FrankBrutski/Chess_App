import type { Issue, MoveNode, RootNode, TreeNode } from './model';
import type { ParsedChapter } from './pgn';
import { annotateChapter } from './annotations';
import { moveNumber } from './tree';
import type { ParseOptions } from './commentMoves';

const epd = (fen: string) => fen.split(' ').slice(0, 4).join(' ');
const sideToMove = (fen: string) => (fen.split(' ')[1] === 'b' ? 'black' : 'white');
const label = (n: TreeNode) => (n.id === 'root' ? 'the start' : `${moveNumber((n as MoveNode).ply)}${(n as MoveNode).san}`);

function walk(root: RootNode, f: (n: TreeNode, onMain: boolean) => void) {
  const go = (n: TreeNode, onMain: boolean) => {
    f(n, onMain);
    n.children.forEach((c, i) => go(c, onMain && i === 0));
  };
  go(root, true);
}

/**
 * The import checker. Only problems that cut the main line short are errors;
 * everything else is a warning that is shown but never stops an import.
 */
export function checkChapter(p: ParsedChapter, opts: ParseOptions = {}): Issue[] {
  const issues: Issue[] = [];
  const byId = new Map<string, TreeNode>();
  walk(p.root, (n) => byId.set(n.id, n));

  if (!p.root.children.length && !p.unreadable.length) {
    issues.push({ severity: 'error', kind: 'empty-chapter', message: 'This chapter has no moves.', key: 'empty' });
  }

  for (const u of p.unreadable) {
    const parent = byId.get(u.parentId);
    const where = parent ? `after ${label(parent)}` : '';
    issues.push({
      severity: u.onMainLine ? 'error' : 'warning',
      kind: 'unreadable-move',
      message: u.onMainLine
        ? `Main line stops ${where}: "${u.san}" is not a legal move there, so the rest of the main line is missing.`
        : `Side line skipped ${where}: "${u.san}" is not a legal move there.`,
      nodeId: u.parentId,
      key: `unreadable|${parent && 'key' in parent ? parent.key : 'root'}|${u.san}`,
    });
  }

  // Bracketed lines that are not legal, and stray brackets.
  const ann = annotateChapter(p.root, opts);
  walk(p.root, (n) => {
    const a = ann.get(n.id);
    const raw = [...n.comments, ...('startingComments' in n ? n.startingComments : [])];
    for (const pieces of [...(a?.before ?? []), ...(a?.after ?? [])]) {
      for (const piece of pieces) {
        if (piece.kind === 'bad') {
          issues.push({
            severity: 'warning',
            kind: 'bad-bracket-line',
            message: `Bracketed line at ${label(n)} has an illegal move: <${piece.text}>`,
            nodeId: n.id,
            key: `bad|${'key' in n ? n.key : 'root'}|${piece.text}`,
          });
        }
      }
    }
    for (const c of raw) {
      const stripped = c.replace(/<[^<>]*>/g, '');
      if (/[<>]/.test(stripped)) {
        issues.push({
          severity: 'warning',
          kind: 'unmatched-bracket',
          message: `Comment at ${label(n)} has a < or > without its partner: “${c.slice(0, 60)}${c.length > 60 ? '…' : ''}”`,
          nodeId: n.id,
          key: `unmatched|${'key' in n ? n.key : 'root'}|${c.slice(0, 40)}`,
        });
      }
    }
  });

  // Same position reached twice with different repertoire moves (matters for training).
  const repMove = new Map<string, { san: string; at: TreeNode }>();
  walk(p.root, (n) => {
    if (sideToMove(n.fen) !== p.orientation || !n.children.length) return;
    const main = n.children[0];
    const k = epd(n.fen);
    const seen = repMove.get(k);
    if (!seen) repMove.set(k, { san: main.san, at: n });
    else if (seen.san !== main.san) {
      issues.push({
        severity: 'warning',
        kind: 'conflicting-moves',
        message: `Same position, different repertoire moves: ${label(main)} here, but ${seen.san} after ${label(seen.at)}. Pick one so training is consistent.`,
        nodeId: main.id,
        key: `conflict|${k}|${[seen.san, main.san].sort().join('/')}`,
      });
    }
  });

  return issues;
}

export const hasBlockingError = (issues: Issue[]) => issues.some((i) => i.severity === 'error');
