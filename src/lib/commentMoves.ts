import { makeFen } from 'chessops/fen';
import { positionOf } from './boardMove';
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
  | {
      kind: 'text';
      text: string;
      /** In a <...> aside: the first numbered move that could not be played, and why (the rest stays text). */
      stuck?: string;
    }
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
  | { kind: 'bad'; text: string; /** What is wrong, e.g. "13.Bxf7 is not legal after 12…a5". */ reason?: string };

// Move number like "12.", "12...", "12…" optionally directly followed by a SAN.
// Dots: "12." White; "12...", "12..", "12…", "12.…" Black.
const NUM = /^(\d+)(\.{1,3}|…|\.…)$/;
const NUM_SAN = /^(\d+)(\.{1,3}|…|\.…)([^.…].*)$/;
/** A lone "..." or "…" after "12." (as in "12. ... Nf6") means Black's move. */
const ELLIPSIS = /^(\.{2,3}|…)$/;
const SAN = /^(?:[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=?[QRBN])?|O-O(?:-O)?|0-0(?:-0)?)[+#]?[!?]*$/;

interface Token {
  text: string; start: number; end: number;
  /** "(" and ")" trimmed off this token: a side line in prose opens or closes here. */
  opens?: number; closes?: number;
}

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
  const opens = lead ? (t.text.slice(0, lead).match(/\(/g)?.length ?? 0) : 0;
  const closes = trail ? (trail[0].match(/\)/g)?.length ?? 0) : 0;
  return { text, start, end, opens, closes };
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
    const res = parseBracket(inner, candidates);
    if ('pieces' in res) pieces.push(...res.pieces);
    // Some authors wrap a whole aside in <...> ("<If 10...Re8 then 11. Be2 ...>"): that is prose,
    // not a move list, so show it as text with its playable moves linked instead of flagging it.
    // Only from this position and the ones before it: a hypothetical line in an aside never jumps ahead.
    else if (isProse(inner)) pieces.push(...scan(inner, candidates.slice(0, candidates.length - ahead.length), false, true));
    else pieces.push({ kind: 'bad', text: inner, reason: res.reason });
    last = m.index + m[0].length;
  }
  if (last < text.length) pieces.push(...plain(text.slice(last)));
  return pieces.filter((p) => p.kind !== 'text' || p.text.length > 0);
}

const plyNum = (ply: number) => (ply % 2 ? `${Math.ceil(ply / 2)}.` : `${ply / 2}…`);

/**
 * `aside`: text from a <...> aside. Once a numbered move in it can't be played (a typo, or a line
 * we can't follow), the rest is left as text: later moves likely continue that line, and linking
 * them from some other position would show the wrong board.
 */
function scan(text: string, candidates: TreeNode[], forced: boolean, aside = false): CommentPiece[] {
  const tokens = tokenize(text).map(trimToken);
  const pieces: CommentPiece[] = [];
  let cursor = 0;
  let i = 0;
  // Every line read so far, newest first: "(24. Ra1?? Rd8 …) 24...Re8" goes back to an earlier one.
  const chains: Chain[] = [];
  let lastEnd = -1; // token right after the last line read
  // For each "(" still open: the line it branches off. After its ")", the text carries on with that
  // line again, as in PGN: "15. Bd3?? (15. Be3 Qa5+ …) 15...h6" answers 15.Bd3, not 15.Be3.
  const outer: (Chain | undefined)[] = [];
  const closeUpTo = (end: number, from: number) => {
    for (let t = from; t < end; t++) {
      for (let c = 0; c < (tokens[t].closes ?? 0) && outer.length; c++) {
        const o = outer.pop();
        const at = o ? chains.indexOf(o) : -1;
        if (at > 0) { chains.splice(at, 1); chains.unshift(o!); }
      }
    }
  };
  while (i < tokens.length) {
    for (let c = 0; c < (tokens[i].opens ?? 0); c++) outer.push(chains[0]);
    const chain = chains[0];
    const run = tryRun(tokens, i, candidates, forced, chains, i > 0 && (tokens[i - 1].closes ?? 0) > 0);
    if (!run) {
      const t = tokens[i];
      const numbered = NUM_SAN.exec(t.text) ?? (NUM.test(t.text) && tokens[i + 1] && SAN.test(tokens[i + 1].text) ? NUM.exec(t.text) : null);
      const goesOn = i === lastEnd && SAN.test(t.text); // "… 17. Qe3 Qh5" where Qh5 can't be played
      if (aside && ((numbered && (NUM.test(t.text) || SAN.test(numbered[3]))) || goesOn)) {
        const last = chain?.line[chain.line.length - 1];
        const move = goesOn && !numbered && last ? `${plyNum(last.ply + 1)}${t.text}` : NUM.test(t.text) ? `${t.text}${tokens[i + 1].text}` : t.text;
        const where = last ? `after ${plyNum(last.ply)}${last.san}` : 'from this position or the moves before it';
        pieces.push({ kind: 'text', text: text.slice(cursor), stuck: `${move.replace(/\.{3}/, '…')} can't be played ${where}` });
        return pieces.filter((p) => p.kind !== 'text' || p.text.length > 0);
      }
      closeUpTo(i + 1, i);
      i++;
      continue;
    }
    chains.unshift({ line: run.line, baseFen: run.baseFen, baseId: run.baseId, basePly: run.basePly });
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
    closeUpTo(run.nextToken, i);
    i = run.nextToken;
    lastEnd = i;
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
  basePly: number;
  nextToken: number;
}

/** The last line read in this text: prose like "If 10...Re8 then 11. Be2 … After 11...Bxc3" carries on from it. */
interface Chain { line: GhostMove[]; baseFen: string; baseId: string; basePly: number }

function tryRun(tokens: Token[], i: number, candidates: TreeNode[], forced: boolean, chains: Chain[] = [], afterClose = false): Run | undefined {
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

  // A numbered move that fits the line just read continues that line (the sentence goes on with it).
  // Right after a ")", a move with no number carries on the line the side line branched off: "(15. Be3) h6".
  const wantPlyNum = wantPly;
  const resume = wantPly === undefined && afterClose && chains[0] ? [chains[0]] : chains;
  for (const chain of resume) {
    const wantPly = resume === chains ? wantPlyNum : chain.basePly + chain.line.length;
    if (wantPly === undefined || wantPly <= chain.basePly || wantPly > chain.basePly + chain.line.length) continue;
    const k = wantPly - chain.basePly; // moves of the chain kept before this one
    const pos = positionOf(chain.line[k - 1].fen);
    const res = pos && playRun(tokens, i, j, firstSan, pos, wantPly);
    if (res) {
      const prefix = chain.line.slice(0, k);
      return {
        startChar,
        line: [...prefix, ...res.line],
        spans: res.spans.map((s) => ({ ...s, moveIndex: s.moveIndex + k })),
        nextToken: res.nextToken,
        baseFen: chain.baseFen,
        baseId: chain.baseId,
        basePly: chain.basePly,
      };
    }
  }
  // Without a move number, a run must start from the current position, and a lone
  // pawn move ("a4" in a sentence) is not linked unless the author used [[...]].
  for (const base of candidates) {
    if (wantPly !== undefined && base.ply !== wantPly) continue;
    if (wantPly === undefined && base !== candidates[0]) break;
    const pos = positionOf(base.fen);
    if (!pos) continue;
    const res = playRun(tokens, i, j, firstSan, pos, base.ply);
    if (!res) continue;
    if (!forced && wantPly === undefined && res.line.length < 2 && !/^[KQRBNO]/.test(firstSan)) continue;
    return { startChar, ...res, baseFen: base.fen, baseId: base.id, basePly: base.ply };
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
  // A side line in the text ends at its ")", and a "(" starts a new one: neither continues this run.
  const ends = (n: number) => (tokens[n - 1].closes ?? 0) > 0;
  while (k < tokens.length && !ends(k)) {
    const t = tokens[k];
    if ((t.opens ?? 0) > 0) break;
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


/** Words in it that can't be part of a move list ("If", "then", "Black's"…), so it's an aside, not moves. */
const WORD = /^[(“"']*[A-Za-z][a-z]+[A-Za-z'’]*[)”"',;:.!?]*$/;
function isProse(text: string): boolean {
  return bracketTokens(text).some((t) => {
    const w = t.text.replace(/[,;:.!?)”"']+$/, '');
    return WORD.test(t.text) && !/^[KQRBN][a-hx]/.test(w) && !SAN.test(w) && !NUM_SAN.test(w) && !SKIP_TOKEN.test(w) && !/^(e\.?p|ep)$/i.test(w);
  });
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
function parseBracket(text: string, candidates: TreeNode[]): { pieces: CommentPiece[] } | { reason: string } {
  const toks = bracketTokens(text);
  if (!toks.length) return { reason: 'the brackets are empty' };
  let wantPly: number | undefined;
  const first = toks[0].text;
  const m1 = NUM_SAN.exec(first) ?? NUM.exec(first);
  if (m1) wantPly = plyFromNumber(+m1[1], m1[2]);
  if (m1 && !NUM_SAN.test(first) && toks[1] && ELLIPSIS.test(toks[1].text) && wantPly !== undefined) wantPly = blackPly(wantPly);

  // With a move number: any position in the chapter's path with that number.
  // Without one: the current position, then the position before the last move
  // (an alternative to the move just played).
  const pool = wantPly !== undefined ? candidates : candidates.slice(0, 2);
  let best: BracketFail | undefined;
  for (const base of pool) {
    if (wantPly !== undefined && base.ply !== wantPly) continue;
    const res = parseBracketFrom(toks, base);
    if ('fail' in res) {
      if (!best || res.fail.progress > best.progress) best = res.fail;
      continue;
    }
    const marks = res.marks;
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
    return { pieces };
  }
  if (best) return { reason: best.reason };
  if (wantPly !== undefined) return { reason: `it starts at ${num(wantPly + 1)}, but this line never reaches that move` };
  return { reason: 'it does not start with a move' };
}

/** "13." for White's 13th move, "12…" for Black's: the number of the move with this ply. */
const num = (ply: number) => (ply % 2 === 1 ? `${Math.ceil(ply / 2)}.` : `${ply / 2}…`);

interface BracketFail { reason: string; /** Moves read before it went wrong (the attempt that got furthest wins). */ progress: number }

const SAN_LIKE = /[a-h][1-8]|O-O|0-0/;

interface Mark { start: number; end: number; line: GhostMove[]; index: number; depth: number }

function parseBracketFrom(toks: BTok[], base: TreeNode): { marks: Mark[] } | { fail: BracketFail } {
  const marks: Mark[] = [];
  let reason = '';
  /** Where the line stands: "after 12…a5", or the position the brackets start from. */
  const after = (line: GhostMove[]) => {
    if (line.length) { const g = line[line.length - 1]; return `after ${num(g.ply)}${g.san}`; }
    return 'id' in base && base.id !== 'root' ? `after ${num(base.ply)}${(base as { san?: string }).san ?? ''}` : 'at the start';
  };
  const posAt = (line: GhostMove[]) => {
    return positionOf(line.length ? line[line.length - 1].fen : base.fen);
  };
  let i = 0;
  let ok = true;

  // Parse one line starting from `prefix` (moves already on the board). Returns at ")" or the end.
  const parseLine = (prefix: GhostMove[], depth: number) => {
    const line = [...prefix];
    let pendingNum: { start: number; ply: number } | undefined;
    while (i < toks.length && ok) {
      const t = toks[i];
      if (t.text === ')') { if (depth === 0) { ok = false; reason = `there is a ")" with no "(" ${after(line)}`; } return; }
      if (t.text === '(') {
        if (line.length === prefix.length) { ok = false; reason = `a "(" side line opens before any move ${after(line)}`; return; } // nothing to branch from yet
        i++;
        parseLine(line.slice(0, -1), depth + 1);
        if (!ok) return;
        if (toks[i]?.text !== ')') { ok = false; reason = 'a "(" side line is never closed with ")"'; return; }
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
      const written = `${wantPly !== undefined ? num(wantPly + 1) : ''}${san}`;
      if (wantPly !== undefined && wantPly !== plyBefore) {
        ok = false;
        reason = `${written} has the wrong move number: ${after(line)} the next move is ${num(plyBefore + 1)}`;
        return;
      }
      const pos = posAt(line);
      const move = pos && parseSan(pos, cleanSan(san.replace(/[!?]+$/, '')));
      if (!pos || !move) {
        ok = false;
        reason = SAN.test(san.replace(/[!?]+$/, ''))
          ? `${num(plyBefore + 1)}${san} is not legal ${after(line)}`
          : `"${t.text}" is not a move (${after(line)})`;
        return;
      }
      const uci = makeUci(move);
      const s = makeSanAndPlay(pos, move);
      line.push({ san: s, uci, fen: makeFen(pos.toSetup()), ply: plyBefore + 1 });
      // Every move in this line shares the final array, so stepping forward follows this line.
      marks.push({ start, end: t.start + t.text.replace(/[,;:.]+$/, '').length, line, index: line.length - 1, depth });
      i++;
    }
    if (pendingNum && ok) { ok = false; reason = 'it ends with a move number but no move'; }
  };

  parseLine([], 0);
  if (ok && i < toks.length) { ok = false; reason = `there is a ")" with no "("`; }
  if (ok && !marks.length) { ok = false; reason = 'there are no moves in it'; }
  if (!ok) return { fail: { reason, progress: marks.length } };
  return { marks };
}
