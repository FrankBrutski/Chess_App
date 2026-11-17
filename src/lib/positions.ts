import { parseFen, makeFen } from 'chessops/fen';
import { Chess } from 'chessops/chess';
import { parseSan, makeSanAndPlay } from 'chessops/san';
import type { Chapter, Course, MoveNode, TreeNode } from './model';
import { splitLines, type Line, type SplitOptions } from './lines';

/** Pieces + side to move: the part of a position that has to match. Castling and en passant are compared separately. */
export const placementKey = (fen: string) => fen.trim().split(/\s+/).slice(0, 2).join(' ');
/** Castling + en passant, as chessops writes them (en passant only when a capture is really possible). */
const rightsOf = (fen: string) => fen.trim().split(/\s+/).slice(2, 4).join(' ');

/** Parse and re-write a FEN so it compares the same way as positions from imported studies. */
export function normalizeFen(fen: string): { fen: string } | { error: string } {
  const setup = parseFen(fen.trim());
  if (setup.isErr) return { error: 'That FEN is not valid.' };
  const pos = Chess.fromSetup(setup.value);
  if (pos.isErr) return { error: `That position isn't legal (${String(pos.error.message ?? pos.error).toLowerCase()}).` };
  return { fen: makeFen(pos.value.toSetup()) };
}

export interface Hit {
  hive: Course;
  chapter: Chapter;
  /** The node whose position this is ("root" for the comb's start). */
  node: TreeNode;
  /** The first line (in list order) through this node, and how many lines pass through it. */
  line: Line;
  lineCount: number;
  /** Moves from here in the comb: children[0] is the repertoire / main move. */
  next: MoveNode[];
  /** It's your move here (vs. the opponent's). */
  yourMove: boolean;
  /** Castling or en passant differ from the position you entered. */
  rightsDiffer: boolean;
}

interface Entry {
  hive: Course;
  chapter: Chapter;
  node: TreeNode;
  lines: Line[];
  fen: string;
}

export interface PositionIndex {
  byKey: Map<string, Entry[]>;
  /** Every distinct position, for "closest known" search. */
  all: { key: string; board: string; entries: Entry[] }[];
}

export function buildIndex(hives: Course[], chapters: Chapter[], opts: Pick<SplitOptions, 'order'> = {}): PositionIndex {
  const hiveById = new Map(hives.map((h) => [h.id, h]));
  const byKey = new Map<string, Entry[]>();
  for (const chapter of chapters) {
    const hive = hiveById.get(chapter.courseId);
    if (!hive) continue;
    const lines = splitLines(chapter.root, chapter.orientation, { names: chapter.lineNames, order: opts.order });
    const linesThrough = new Map<string, Line[]>();
    for (const l of lines) for (const n of l.nodes) {
      const list = linesThrough.get(n.id);
      if (list) list.push(l);
      else linesThrough.set(n.id, [l]);
    }
    const add = (node: TreeNode) => {
      const key = placementKey(node.fen);
      const entry: Entry = { hive, chapter, node, fen: node.fen, lines: node.id === 'root' ? lines : linesThrough.get(node.id) ?? [] };
      const list = byKey.get(key);
      if (list) list.push(entry);
      else byKey.set(key, [entry]);
    };
    const stack: TreeNode[] = [chapter.root];
    while (stack.length) {
      const n = stack.pop()!;
      add(n);
      stack.push(...n.children);
    }
  }
  return { byKey, all: [...byKey.entries()].map(([key, entries]) => ({ key, board: key.split(' ')[0], entries })) };
}

/**
 * The line to point at for a node: the one that carries on with the main (first-choice) moves
 * from here, so you land in the line that teaches this position, not a side line that passes by.
 */
function bestLine(e: Entry): Line {
  const score = (l: Line) => {
    const i = e.node.id === 'root' ? -1 : l.nodes.indexOf(e.node as MoveNode);
    let n = 0;
    let parent: TreeNode = e.node;
    for (let j = i + 1; j < l.nodes.length; j++) {
      if (parent.children[0] !== l.nodes[j]) break;
      n++;
      parent = l.nodes[j];
    }
    // Full main continuation to the end of the line wins outright.
    return n === l.nodes.length - 1 - i ? 10_000 + n : n;
  };
  return e.lines.reduce((best, l) => (score(l) > score(best) ? l : best), e.lines[0]);
}

const toHit = (e: Entry, fen: string): Hit | undefined => {
  if (!e.lines.length) return undefined;
  const toMove = fen.split(' ')[1] === 'w' ? 'white' : 'black';
  return {
    hive: e.hive,
    chapter: e.chapter,
    node: e.node,
    line: bestLine(e),
    lineCount: e.lines.length,
    next: e.node.children,
    yourMove: toMove === e.chapter.orientation,
    rightsDiffer: rightsOf(e.fen) !== rightsOf(fen),
  };
};

/** Every place in your repertoire with this position (transpositions included), main hives first. */
export function lookup(index: PositionIndex, fen: string): Hit[] {
  const entries = index.byKey.get(placementKey(fen)) ?? [];
  return entries
    .map((e) => toHit(e, fen))
    .filter((h): h is Hit => !!h)
    .sort((a, b) => a.hive.tier - b.hive.tier || a.hive.order - b.hive.order || a.chapter.order - b.chapter.order || a.line.number - b.line.number);
}

/** Expand the board part of a FEN to 64 characters, a8..h1. */
function squares(board: string): string {
  return board.replace(/\d/g, (d) => '.'.repeat(+d)).replace(/\//g, '');
}

/** How many squares differ between two boards. */
export function boardDistance(a: string, b: string): number {
  const x = squares(a);
  const y = squares(b);
  let d = 0;
  for (let i = 0; i < 64; i++) if (x[i] !== y[i]) d++;
  return d;
}

/** Known positions closest to this one (fewest squares different, same side to move first). */
export function nearest(index: PositionIndex, fen: string, limit = 3, maxDistance = 8): { hit: Hit; distance: number }[] {
  const [board, turn] = placementKey(fen).split(' ');
  const scored: { entries: Entry[]; distance: number; sameTurn: boolean; fen: string }[] = [];
  for (const p of index.all) {
    const distance = boardDistance(board, p.board);
    if (distance === 0 && p.key.endsWith(` ${turn}`)) continue; // exact matches are shown separately
    if (distance <= maxDistance) scored.push({ entries: p.entries, distance, sameTurn: p.key.endsWith(` ${turn}`), fen: p.entries[0].fen });
  }
  scored.sort((a, b) => a.distance - b.distance || Number(b.sameTurn) - Number(a.sameTurn));
  const out: { hit: Hit; distance: number }[] = [];
  for (const s of scored) {
    const hit = s.entries.map((e) => toHit(e, s.fen)).find(Boolean);
    if (hit) out.push({ hit, distance: s.distance });
    if (out.length >= limit) break;
  }
  return out;
}

export interface PlayedPosition {
  fen: string;
  san?: string;
  ply: number;
}

/** Play SAN moves from a start position; stops at the first move that doesn't parse. */
export function playMoves(startFen: string, sans: string[]): { positions: PlayedPosition[]; error?: string } {
  const setup = parseFen(startFen);
  if (setup.isErr) return { positions: [], error: 'Bad start position.' };
  const posRes = Chess.fromSetup(setup.value);
  if (posRes.isErr) return { positions: [], error: 'Bad start position.' };
  const pos = posRes.value;
  const startPly = (pos.fullmoves - 1) * 2 + (pos.turn === 'white' ? 0 : 1);
  const positions: PlayedPosition[] = [{ fen: makeFen(pos.toSetup()), ply: startPly }];
  for (const raw of sans) {
    const move = parseSan(pos, raw);
    if (!move) return { positions, error: `“${raw}” isn't a legal move there.` };
    const san = makeSanAndPlay(pos, move);
    positions.push({ fen: makeFen(pos.toSetup()), san, ply: positions[positions.length - 1].ply + 1 });
  }
  return { positions };
}

/** Pull the moves out of PGN or plain move text ("1. e4 e5 2. Nf3 Nc6"). Ignores headers, comments, variations and results. */
export function movesFromText(text: string): string[] {
  let t = text.replace(/\[[^\]]*\]/g, ' ').replace(/\{[^}]*\}/g, ' ').replace(/;[^\n]*/g, ' ');
  // Drop variations (nested).
  let prev;
  do { prev = t; t = t.replace(/\([^()]*\)/g, ' '); } while (t !== prev);
  return t
    .split(/\s+/)
    .map((x) => x.replace(/^\d+\.(\.\.)?/, '').replace(/^\.\.\./, '').replace(/[!?]+$/, '').replace(/\$\d+/, ''))
    .filter((x) => x && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(x) && !/^\d+\.*$/.test(x));
}

/**
 * For a game, the last position that is in your repertoire, and the move that left it.
 * Returns undefined when even the start isn't known.
 */
export function leftBook(index: PositionIndex, positions: PlayedPosition[]): { at: number; hits: Hit[]; played?: string } | undefined {
  let last = -1;
  for (let i = 0; i < positions.length; i++) if (lookup(index, positions[i].fen).length) last = i;
  if (last < 0) return undefined;
  return { at: last, hits: lookup(index, positions[last].fen), played: positions[last + 1]?.san };
}
