import type { Line } from './lines';
import { isUserMove } from './lines';

/** Training progress for one of your moves (a "cell"): a position plus the move you play there. */
export interface Cell {
  /** MoveNode.key: position before the move + the move. Shared across combs (transpositions count once). */
  key: string;
  /** 1 = first step of the ladder. */
  level: number;
  /** When it's due for review (ms since epoch). */
  due: number;
  learnedAt: number;
  lastReviewed?: number;
  lapses: number;
}

export type MissPolicy = 'reset' | 'back2' | 'back1';

const MIN = 60_000;
const H = 60 * MIN;
const D = 24 * H;

/** Frank's default ladder: 4h, 8h, 12h, 1d, 2d, 3d, 1w, 2w, 1mo, 2mo, 4mo, 6mo. */
export const DEFAULT_LADDER = [4 * H, 8 * H, 12 * H, D, 2 * D, 3 * D, 7 * D, 14 * D, 30 * D, 60 * D, 120 * D, 180 * D];
/** Chessable's published ladder (Chess.com support page): 4h, 1d, 3d, 1w, 2w, 1mo, 3mo, 6mo. */
export const CHESSABLE_LADDER = [4 * H, D, 3 * D, 7 * D, 14 * D, 30 * D, 90 * D, 180 * D];

const UNITS: Record<string, number> = { m: MIN, min: MIN, h: H, d: D, w: 7 * D, mo: 30 * D, y: 365 * D };

/** "4h, 1d, 2w, 1mo" → milliseconds. Throws a readable error on bad input. */
export function parseLadder(text: string): number[] {
  const parts = text.split(/[,\s]+/).filter(Boolean);
  if (!parts.length) throw new Error('Add at least one step, like 4h.');
  const out = parts.map((p) => {
    const m = /^(\d+(?:\.\d+)?)(mo|min|m|h|d|w|y)$/i.exec(p);
    if (!m) throw new Error(`“${p}” isn't a step. Use a number and a unit: m, h, d, w, mo or y.`);
    return Math.round(Number(m[1]) * UNITS[m[2].toLowerCase()]);
  });
  for (let i = 1; i < out.length; i++) if (out[i] < out[i - 1]) throw new Error('Steps should get longer, not shorter.');
  return out;
}

export function formatDuration(ms: number): string {
  const units: [string, number][] = [['y', 365 * D], ['mo', 30 * D], ['w', 7 * D], ['d', D], ['h', H], ['m', MIN]];
  for (const [u, v] of units) if (ms >= v && ms % v === 0) return `${ms / v}${u}`;
  for (const [u, v] of units) if (ms >= v) return `${Math.round((ms / v) * 10) / 10}${u}`;
  return `${Math.round(ms / MIN)}m`;
}
export const formatLadder = (l: number[]) => l.map(formatDuration).join(', ');

/** Schedule a move you just learned. */
export function learnCell(key: string, now: number, ladder: number[]): Cell {
  return { key, level: 1, due: now + ladder[0], learnedAt: now, lapses: 0 };
}

/**
 * Honey for a right move. Immediate quiz try n pays n (1, 2, 3…). A review pays one more than the
 * last try, and one more again for each step up the ladder: with 3 tries, reviews pay 4, 5, 6, 7…
 */
export const quizHoney = (tryNo: number) => tryNo;
export const reviewHoney = (c: Cell, tries: number) => tries + Math.max(1, c.level);

/** Schedule after a review: up one step when right; down per the miss policy when wrong. */
export function reviewCell(c: Cell, correct: boolean, now: number, ladder: number[], policy: MissPolicy): Cell {
  const top = ladder.length;
  let level: number;
  if (correct) level = Math.min(Math.min(c.level, top) + 1, top);
  else level = policy === 'reset' ? 1 : Math.max(1, c.level - (policy === 'back2' ? 2 : 1));
  return { ...c, level, due: now + ladder[level - 1], lastReviewed: now, lapses: c.lapses + (correct ? 0 : 1) };
}

/** A line to train, with where it comes from. */
export interface TrainLine {
  chapterId: string;
  hiveId: string;
  combTitle: string;
  color: 'white' | 'black';
  line: Line;
}

export const userKeys = (t: TrainLine) => t.line.nodes.filter((n) => isUserMove(n, t.color)).map((n) => n.key);

export type LineState = 'new' | 'due' | 'learned';

export function lineState(t: TrainLine, cells: Map<string, Cell>, now: number): LineState {
  const keys = userKeys(t);
  if (keys.some((k) => !cells.has(k))) return 'new';
  if (keys.some((k) => cells.get(k)!.due <= now)) return 'due';
  return 'learned';
}

/** Next lines to learn, in study order. */
export const planLearn = (lines: TrainLine[], cells: Map<string, Cell>) => lines.filter((t) => userKeys(t).some((k) => !cells.has(k)));

/**
 * Lines that cover every due move, fewest lines first (greedy): each due move is asked once per session,
 * even when several lines pass through it. Returns the lines with the keys to ask in each.
 */
export function planReview(lines: TrainLine[], cells: Map<string, Cell>, now: number): { t: TrainLine; ask: Set<string> }[] {
  const dueKeys = new Set([...cells.values()].filter((c) => c.due <= now).map((c) => c.key));
  // Only lines whose moves are all learned; new moves belong to Learn.
  const candidates = lines
    .filter((t) => userKeys(t).every((k) => cells.has(k)))
    .map((t) => ({ t, keys: new Set(userKeys(t).filter((k) => dueKeys.has(k))) }))
    .filter((x) => x.keys.size > 0);
  const out: { t: TrainLine; ask: Set<string> }[] = [];
  const covered = new Set<string>();
  while (true) {
    let best: (typeof candidates)[number] | undefined;
    let bestGain = 0;
    for (const c of candidates) {
      let gain = 0;
      for (const k of c.keys) if (!covered.has(k)) gain++;
      if (gain > bestGain) { best = c; bestGain = gain; }
    }
    if (!best) break;
    const ask = new Set([...best.keys].filter((k) => !covered.has(k)));
    ask.forEach((k) => covered.add(k));
    out.push({ t: best.t, ask });
  }
  // Keep study order so a session flows through the repertoire.
  const order = new Map(lines.map((t, i) => [t, i]));
  return out.sort((a, b) => order.get(a.t)! - order.get(b.t)!);
}

/**
 * After a miss at line index `missIdx`, where to restart: `movesBack` of your own moves earlier
 * (the position before that move). Returns the frontier index (-1 = the start of the line).
 */
export function retryFrontier(t: TrainLine, missIdx: number, movesBack: number): number {
  if (movesBack <= 0) return missIdx - 1;
  let count = 0;
  for (let i = missIdx - 1; i >= 0; i--) {
    if (isUserMove(t.line.nodes[i], t.color)) {
      count++;
      if (count === movesBack) return i - 1;
    }
  }
  return -1;
}
