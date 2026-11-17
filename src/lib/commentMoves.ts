import { parseFen, makeFen } from 'chessops/fen';
import { Chess } from 'chessops/chess';
import { parseSan, makeSanAndPlay } from 'chessops/san';
import { makeUci } from 'chessops/util';
import type { TreeNode } from './model';

/** A move written inside comment text that the app can play on the board. */
export interface GhostMove {
  san: string;
  uci: string;
  fen: string; // position after the move
  ply: number;
}

export type CommentPiece =
  | { kind: 'text'; text: string }
  | {
      kind: 'move';
      text: string;
      line: GhostMove[];
      index: number;
      baseFen: string;
      baseId: string;
      /** 0 for the bracketed line itself, 1+ for (side lines) nested inside it. */
      depth?: number;
    }
  /** A <...> line the author marked as moves but which is not legal here. */
  | { kind: 'bad'; text: string };

// Move number like "12.", "12...", "12…" optionally directly followed by a SAN.
// Dots: "12." White; "12...", "12..", "12…", "12.…" Black.
const NUM = /^(\d+)(\.{1,3}|…|\.…)$/;
const NUM_SAN = /^(\d+)(\.{1,3}|…|\.…)([^.…].*)$/;
/** A lone "..." or "…" after "12." (as in "12. ... Nf6") means Black's move. */
const ELLIPSIS = /^(\.{2,3}|…)$/;
const SAN = /^(?:[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=?[QRBN])?|O-O(?:-O)?|0-0(?:-0)?)[+#]?[!?]*$/;

interface Token { text: string; start: number; end: number }

function tokenize(text: string): Token[] {
  const out: Token[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  return out;
}

/** Strip punctuation that commonly wraps moves in prose: "(8.Bg5", "h6," "Nf3)". */
function trimToken(t: Token): Token {
  let { text, start, end } = t;
  const lead = /^[("'“‘[]+/.exec(text)?.[0].length ?? 0;
  text = text.slice(lead); start += lead;
  // Keep a trailing "." only when the token is a bare move number like "8."
  const trail = NUM.test(text) ? null : /[)"'”’\],;:.]+$/.exec(text);
  if (trail) {
    text = text.slice(0, text.length - trail[0].length);
    end -= trail[0].length;
  }
  return { text, start, end };
}

const plyFromNumber = (num: number, dots: string) => (num - 1) * 2 + (dots === '.' ? 0 : 1);
const blackPly = (ply: number) => (ply % 2 === 0 ? ply + 1 : ply);

/** Lenient SAN clean-up: 0-0 castling, missing "=" in promotions, trailing marks and e.p. */
function cleanSan(s: string) {
  return s
    .replace(/[!?]+$/, '')
    .replace(/^0-0(-0)?/, (m) => m.replace(/0/g, 'O'))
    .replace(/^([a-h](?:x[a-h])?[18])([QRBNqrbn])/, (_, sq, p) => `${sq}=${p.toUpperCase()}`)
    .replace(/(e\.?p\.?)$/, '');
}

/**
 * Turn a comment into text and clickable move runs. Only lines wrapped in
 * <...> are linked unless opts.auto is on. Moves are validated by actually playing them: a run starting with a move number is matched to the
 * ancestor position with that move number (so "Instead 7.Bc4 ..." works from
 * later in the line); a run with no number starts from the current position.
 */
export interface ParseOptions {
  /** Also link legal move runs that are not wrapped in <...>. Off by default. */
  auto?: boolean;
}

/** Clickable lines are written as <12...Bf6 13.Bxf6 Nxf5> in Lichess comments ([[...]] also works). */
const MARKER = /<([^<>]+)>|\[\[([\s\S]*?)\]\]/g;

export function parseCommentMoves(
  text: string,
  node: TreeNode,
  ancestors: TreeNode[],
  opts: ParseOptions = {},
): CommentPiece[] {
  // Positions available as starting points: this node and its ancestors (nearest first).
  // ...then main-line moves still to come, for "the plan is <14.Bg5 ...>" written ahead of time.
  const ahead: TreeNode[] = [];
  for (let n = node.children[0]; n; n = n.children[0]) ahead.push(n);
  const candidates = [node, ...[...ancestors].reverse(), ...ahead];
  const pieces: CommentPiece[] = [];
  const marker = new RegExp(MARKER.source, 'g');
  const plain = (t: string): CommentPiece[] => (opts.auto ? scan(t, candidates, false) : [{ kind: 'text', text: t }]);
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = marker.exec(text))) {
    if (m.index > last) pieces.push(...plain(text.slice(last, m.index)));
    const inner = (m[1] ?? m[2]).trim();
    pieces.push(...(parseBracket(inner, candidates) ?? [{ kind: 'bad' as const, text: inner }]));
    last = m.index + m[0].length;
  }
  if (last < text.length) pieces.push(...plain(text.slice(last)));
  return pieces.filter((p) => p.kind !== 'text' || p.text.length > 0);
}

function scan(text: string, candidates: TreeNode[], forced: boolean): CommentPiece[] {
  const tokens = tokenize(text).map(trimToken);
  const pieces: CommentPiece[] = [];
  let cursor = 0;
  let i = 0;
  while (i < tokens.length) {
    const run = tryRun(tokens, i, candidates, forced);
    if (!run) { i++; continue; }
    if (run.startChar > cursor) pieces.push({ kind: 'text', text: text.slice(cursor, run.startChar) });
    run.spans.forEach((span, k) => {
      if (k > 0 && span.start > run.spans[k - 1].end) {
        pieces.push({ kind: 'text', text: text.slice(run.spans[k - 1].end, span.start) });
      }
      pieces.push({
        kind: 'move',
        text: text.slice(span.start, span.end),
        line: run.line,
        index: span.moveIndex,
        baseFen: run.baseFen,
        baseId: run.baseId,
      });
    });
    cursor = run.spans[run.spans.length - 1].end;
    i = run.nextToken;
  }
  if (cursor < text.length) pieces.push({ kind: 'text', text: text.slice(cursor) });
  return pieces;
}

interface Run {
  startChar: number;
  spans: { start: number; end: number; moveIndex: number }[];
  line: GhostMove[];
  baseFen: string;
  baseId: string;
  nextToken: number;
}

function tryRun(tokens: Token[], i: number, candidates: TreeNode[], forced: boolean): Run | undefined {
  const first = tokens[i];
  let wantPly: number | undefined;
  let firstSan: string | undefined;
  let startChar = first.start;
  let j = i;
  let m = NUM_SAN.exec(first.text);
  if (m && SAN.test(m[3])) {
    wantPly = plyFromNumber(+m[1], m[2]);
    firstSan = m[3];
    j = i + 1;
  } else if ((m = NUM.exec(first.text)) && tokens[i + 1] && SAN.test(tokens[i + 1].text)) {
    wantPly = plyFromNumber(+m[1], m[2]);
    firstSan = tokens[i + 1].text;
    j = i + 2;
  } else if (SAN.test(first.text)) {
    firstSan = first.text;
    j = i + 1;
  } else return undefined;

  // Without a move number, a run must start from the current position, and a lone
  // pawn move ("a4" in a sentence) is not linked unless the author used [[...]].
  for (const base of candidates) {
    if (wantPly !== undefined && base.ply !== wantPly) continue;
    if (wantPly === undefined && base !== candidates[0]) break;
    const setup = parseFen(base.fen);
    if (setup.isErr) continue;
    const pos = Chess.fromSetup(setup.value);
    if (pos.isErr) continue;
    const res = playRun(tokens, i, j, firstSan, pos.value, base.ply);
    if (!res) continue;
    if (!forced && wantPly === undefined && res.line.length < 2 && !/^[KQRBNO]/.test(firstSan)) continue;
    return { startChar, ...res, baseFen: base.fen, baseId: base.id };
  }
  return undefined;
}

function playRun(tokens: Token[], i: number, j: number, firstSan: string, pos: Chess, basePly: number) {
  const line: GhostMove[] = [];
  const spans: Run['spans'] = [];
  const play = (san: string): GhostMove | undefined => {
    const move = parseSan(pos, cleanSan(san));
    if (!move) return undefined;
    const uci = makeUci(move);
    const s = makeSanAndPlay(pos, move);
    return { san: s, uci, fen: makeFen(pos.toSetup()), ply: basePly + line.length + 1 };
  };
  const first = play(firstSan);
  if (!first) return undefined;
  line.push(first);
  spans.push({ start: tokens[i].start, end: tokens[j - 1].end, moveIndex: 0 });
  let k = j;
  while (k < tokens.length) {
    const t = tokens[k];
    const nm = NUM_SAN.exec(t.text);
    const plyNow = basePly + line.length;
    if (nm && SAN.test(nm[3])) {
      if (plyFromNumber(+nm[1], nm[2]) !== plyNow) break;
      const g = play(nm[3]);
      if (!g) break;
      line.push(g);
      spans.push({ start: t.start, end: t.end, moveIndex: line.length - 1 });
      k++;
      continue;
    }
    const n2 = NUM.exec(t.text);
    if (n2 && tokens[k + 1] && SAN.test(tokens[k + 1].text)) {
      if (plyFromNumber(+n2[1], n2[2]) !== plyNow) break;
      const g = play(tokens[k + 1].text);
      if (!g) break;
      line.push(g);
      spans.push({ start: t.start, end: tokens[k + 1].end, moveIndex: line.length - 1 });
      k += 2;
      continue;
    }
    if (SAN.test(t.text)) {
      const g = play(t.text);
      if (!g) break;
      line.push(g);
      spans.push({ start: t.start, end: t.end, moveIndex: line.length - 1 });
      k++;
      continue;
    }
    break;
  }
  return { line, spans, nextToken: k };
}


// ---------- Bracketed lines: a small PGN movetext parser with (nested side lines) ----------

interface BTok { text: string; start: number; end: number }

function bracketTokens(text: string): BTok[] {
  const out: BTok[] = [];
  const re = /\(|\)|[^\s()]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  return out;
}

// Tokens inside a bracketed line that are allowed but not moves:
// NAGs ($1), marks (!?, ??), evaluations (+-, =, ±, +/=, ∞), results, e.p., novelty "N"/"TN".
const SKIP_TOKEN = /^(\$\d+|[!?]{1,2}|[+\-=±∓⩲⩱∞/]{1,3}|1-0|0-1|1\/2-1\/2|½-½|\*|e\.p\.?|ep|T?N|[,;:.]+)$/;

/**
 * Parse "<12...Nf6 13. Bxf6 (13. Nxf6 gxf6??) gxf6>" into clickable moves.
 * A side line in parentheses is an alternative to the move just before it, as in PGN;
 * after the closing parenthesis the outer line carries on. Returns undefined if any
 * move is not legal, so the caller can flag the whole line.
 */
function parseBracket(text: string, candidates: TreeNode[]): CommentPiece[] | undefined {
  const toks = bracketTokens(text);
  if (!toks.length) return undefined;
  let wantPly: number | undefined;
  const first = toks[0].text;
  const m1 = NUM_SAN.exec(first) ?? NUM.exec(first);
  if (m1) wantPly = plyFromNumber(+m1[1], m1[2]);
  if (m1 && !NUM_SAN.test(first) && toks[1] && ELLIPSIS.test(toks[1].text) && wantPly !== undefined) wantPly = blackPly(wantPly);

  // With a move number: any position in the chapter's path with that number.
  // Without one: the current position, then the position before the last move
  // (an alternative to the move just played).
  const pool = wantPly !== undefined ? candidates : candidates.slice(0, 2);
  for (const base of pool) {
    if (wantPly !== undefined && base.ply !== wantPly) continue;
    const marks = parseBracketFrom(toks, base);
    if (!marks) continue;
    const pieces: CommentPiece[] = [];
    let cursor = 0;
    for (const mk of marks) {
      if (mk.start > cursor) pieces.push({ kind: 'text', text: text.slice(cursor, mk.start) });
      pieces.push({
        kind: 'move',
        text: text.slice(mk.start, mk.end),
        line: mk.line,
        index: mk.index,
        baseFen: base.fen,
        baseId: base.id,
        depth: mk.depth,
      });
      cursor = mk.end;
    }
    if (cursor < text.length) pieces.push({ kind: 'text', text: text.slice(cursor) });
    return pieces;
  }
  return undefined;
}

const SAN_LIKE = /[a-h][1-8]|O-O|0-0/;

interface Mark { start: number; end: number; line: GhostMove[]; index: number; depth: number }

function parseBracketFrom(toks: BTok[], base: TreeNode): Mark[] | undefined {
  const marks: Mark[] = [];
  const posAt = (line: GhostMove[]) => {
    const fen = line.length ? line[line.length - 1].fen : base.fen;
    const setup = parseFen(fen);
    if (setup.isErr) return undefined;
    const pos = Chess.fromSetup(setup.value);
    return pos.isErr ? undefined : pos.value;
  };
  let i = 0;
  let ok = true;

  // Parse one line starting from `prefix` (moves already on the board). Returns at ")" or the end.
  const parseLine = (prefix: GhostMove[], depth: number) => {
    const line = [...prefix];
    let pendingNum: { start: number; ply: number } | undefined;
    while (i < toks.length && ok) {
      const t = toks[i];
      if (t.text === ')') { if (depth === 0) ok = false; return; }
      if (t.text === '(') {
        if (line.length === prefix.length) { ok = false; return; } // nothing to branch from yet
        i++;
        parseLine(line.slice(0, -1), depth + 1);
        if (!ok) return;
        if (toks[i]?.text !== ')') { ok = false; return; }
        i++;
        continue;
      }
      const numOnly = NUM.exec(t.text);
      if (numOnly) { pendingNum = { start: t.start, ply: plyFromNumber(+numOnly[1], numOnly[2]) }; i++; continue; }
      if (pendingNum && ELLIPSIS.test(t.text)) { pendingNum.ply = blackPly(pendingNum.ply); i++; continue; }
      if (SKIP_TOKEN.test(t.text) && !SAN_LIKE.test(t.text)) { i++; continue; }
      let san = t.text.replace(/[,;:.]+$/, '');
      let start = pendingNum?.start ?? t.start;
      let wantPly = pendingNum?.ply;
      const ns = NUM_SAN.exec(t.text);
      if (ns) { san = ns[3]; start = t.start; wantPly = plyFromNumber(+ns[1], ns[2]); }
      pendingNum = undefined;
      const plyBefore = base.ply + line.length;
      if (wantPly !== undefined && wantPly !== plyBefore) { ok = false; return; }
      const pos = posAt(line);
      const move = pos && parseSan(pos, cleanSan(san.replace(/[!?]+$/, '')));
      if (!pos || !move) { ok = false; return; }
      const uci = makeUci(move);
      const s = makeSanAndPlay(pos, move);
      line.push({ san: s, uci, fen: makeFen(pos.toSetup()), ply: plyBefore + 1 });
      // Every move in this line shares the final array, so stepping forward follows this line.
      marks.push({ start, end: t.start + t.text.replace(/[,;:.]+$/, '').length, line, index: line.length - 1, depth });
      i++;
    }
    if (pendingNum) ok = false;
  };

  parseLine([], 0);
  if (!ok || i < toks.length || !marks.length) return undefined;
  return marks;
}
