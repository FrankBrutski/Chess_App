import { describe, expect, it } from 'vitest';
import { parseChapters } from '../pgn';
import { indexTree, pathTo } from '../tree';
import { parseCommentMoves } from '../commentMoves';
import type { MoveNode } from '../model';
import { STUDY_PGN } from './fixture';

describe('parseChapters', () => {
  const chapters = parseChapters(STUDY_PGN);

  it('reads every Lichess chapter with its title and ids', () => {
    expect(chapters.map((c) => c.title)).toEqual(['Main line', 'Black plays ...Be7']);
    expect(chapters[0].lichessStudyId).toBe('AbCdEfGh');
    expect(chapters[0].lichessChapterId).toBe('IjKlMnOp');
    expect(chapters[0].studyName).toBe('Italian Repertoire');
    expect(chapters[0].orientation).toBe('white');
  });

  it('keeps variations, nested variations, comments, NAGs and shapes', () => {
    const root = chapters[0].root;
    expect(root.comments[0]).toMatch(/quick development/);
    const nf3 = root.children[0].children[0].children[0];
    expect(nf3.san).toBe('Nf3');
    expect(nf3.shapes).toEqual([{ color: 'green', orig: 'f3', dest: 'e5' }]);
    expect(nf3.comments).toEqual(['Attacking e5 right away.']);
    expect(nf3.children.map((c) => c.san)).toEqual(['Nc6', 'd6']);
    const bc4 = nf3.children[0].children[0];
    const nf6 = bc4.children[1];
    expect(nf6.san).toBe('Nf6');
    const ng5 = nf6.children[0];
    expect(ng5.nags).toEqual([5]);
    expect(nf6.children[1].san).toBe('d3');
    expect(nf6.children[1].comments).toEqual(['Quieter.']);
    const c3 = bc4.children[0].children[0];
    expect(c3.shapes).toEqual([{ color: 'red', orig: 'd4' }]);
  });

  it('gives each move a stable position key', () => {
    const e4 = chapters[0].root.children[0];
    expect(e4.key).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -|e2e4');
    expect(e4.ply).toBe(1);
  });
});

describe('parseCommentMoves with auto-detect on', () => {
  const ch = parseChapters(STUDY_PGN)[0];
  const idx = indexTree(ch.root);
  const find = (pred: (n: MoveNode) => boolean) =>
    [...idx.byId.values()].find((n) => n.id !== 'root' && pred(n as MoveNode)) as MoveNode;

  it('links a numbered line from the current position', () => {
    const d6 = find((n) => n.san === 'd6');
    const anc = [ch.root, ...pathTo(idx, d6.id).slice(0, -1)];
    const pieces = parseCommentMoves(d6.comments[0], d6, anc, { auto: true });
    const moves = pieces.filter((p) => p.kind === 'move');
    expect(moves.map((m) => m.text)).toEqual(['3.d4', 'exd4', '4.Nxd4']);
    expect(pieces.map((p) => p.text).join('')).toBe(d6.comments[0]);
  });

  it('links a line that starts from an earlier position ("Instead 4.O-O ...")', () => {
    const c3 = find((n) => n.san === 'c3');
    const anc = [ch.root, ...pathTo(idx, c3.id).slice(0, -1)];
    const pieces = parseCommentMoves(c3.comments[0], c3, anc, { auto: true });
    const moves = pieces.filter((p) => p.kind === 'move');
    expect(moves.map((m) => m.text)).toEqual(['4.O-O', 'Nf6', '5.d3']);
    if (moves[0].kind === 'move') expect(moves[0].line[0].ply).toBe(7);
  });

  it('leaves ordinary prose alone', () => {
    const ng5 = find((n) => n.san === 'Ng5');
    const pieces = parseCommentMoves('Sharp. A good idea for a 2 hour game.', ng5, [ch.root], { auto: true });
    expect(pieces.every((p) => p.kind === 'text')).toBe(true);
  });
});

describe('<...> markers (the default)', () => {
  const ch = parseChapters(STUDY_PGN)[0];
  const idx = indexTree(ch.root);
  const c3 = [...idx.byId.values()].find((n) => n.id !== 'root' && (n as MoveNode).san === 'c3') as MoveNode;
  const anc = [ch.root, ...pathTo(idx, c3.id).slice(0, -1)];

  it('leaves unbracketed moves as plain text', () => {
    const text = 'We can consider 4...d6? but better is <4...Nf6 5.d4 exd4> here.';
    const pieces = parseCommentMoves(text, c3, anc);
    expect(pieces.filter((p) => p.kind === 'move').map((p) => p.text)).toEqual(['4...Nf6', '5.d4', 'exd4']);
    expect(pieces.map((p) => p.text).join('')).toBe('We can consider 4...d6? but better is 4...Nf6 5.d4 exd4 here.');
  });

  it('accepts a space after the move number and a line from an earlier move', () => {
    const pieces = parseCommentMoves('Also <4. O-O Nf6 5. d3>.', c3, anc);
    expect(pieces.filter((p) => p.kind === 'move').map((p) => p.text)).toEqual(['4. O-O', 'Nf6', '5. d3']);
  });
});

describe('[[...]] markers', () => {
  const ch = parseChapters(STUDY_PGN)[0];
  const e4 = ch.root.children[0];

  it('forces a single move to be a link and hides the brackets', () => {
    const pieces = parseCommentMoves('The idea is [[e5]] at once.', e4, [ch.root]);
    expect(pieces.map((p) => p.kind)).toEqual(['text', 'move', 'text']);
    expect(pieces.map((p) => p.text).join('')).toBe('The idea is e5 at once.');
  });

  it('flags an illegal bracketed line', () => {
    const pieces = parseCommentMoves('Not [[Ke7 Qxh8]] here.', e4, [ch.root]);
    expect(pieces.some((p) => p.kind === 'bad')).toBe(true);
  });
});

describe('nested side lines inside <...>', () => {
  const ch = parseChapters(STUDY_PGN)[0];
  const idx = indexTree(ch.root);
  const c3 = [...idx.byId.values()].find((n) => n.id !== 'root' && (n as MoveNode).san === 'c3') as MoveNode;
  const anc = [ch.root, ...pathTo(idx, c3.id).slice(0, -1)];

  it('plays the side line from before the move it replaces, then returns to the outer line', () => {
    // After 4.c3: 4...Nf6 5.d4 (5.d3 d6) exd4
    const text = 'Best is <4...Nf6 5. d4 (5. d3 d6?!) exd4> here.';
    const pieces = parseCommentMoves(text, c3, anc);
    const moves = pieces.filter((p) => p.kind === 'move');
    expect(moves.map((m) => m.text)).toEqual(['4...Nf6', '5. d4', '5. d3', 'd6?!', 'exd4']);
    const [nf6, d4, d3, d6, exd4] = moves as Extract<(typeof moves)[number], { kind: 'move' }>[];
    expect(d3.depth).toBe(1);
    expect(d3.line.map((g) => g.san)).toEqual(['Nf6', 'd3', 'd6']);
    expect(d6.index).toBe(2);
    expect(exd4.line.map((g) => g.san)).toEqual(['Nf6', 'd4', 'exd4']);
    expect(nf6.line).toBe(exd4.line);
    expect(d4.depth).toBe(0);
    expect(pieces.map((p) => p.text).join('')).toBe('Best is 4...Nf6 5. d4 (5. d3 d6?!) exd4 here.');
  });

  it('flags a nested line with an illegal move', () => {
    const pieces = parseCommentMoves('<4...Nf6 5. d4 (5. Qxh7) exd4>', c3, anc);
    expect(pieces[0].kind).toBe('bad');
  });
});

describe('import checker', () => {
  it('flags bad bracket lines and stray brackets as warnings, broken main lines as errors', async () => {
    const { checkChapter, hasBlockingError } = await import('../checker');
    const pgn = `[ChapterName "Test"]\n\n1. e4 { Try <1...Qxh8> or 1...e5 > } e5 (1... c5 2. Qxh7) 2. Nf3 *\n\n[ChapterName "Broken"]\n\n1. e4 e5 2. Ke3 Nc6 *`;
    const [ok, broken] = parseChapters(pgn);
    const issues = checkChapter(ok);
    expect(issues.map((i) => [i.severity, i.kind]).sort()).toEqual([
      ['warning', 'bad-bracket-line'],
      ['warning', 'unmatched-bracket'],
      ['warning', 'unreadable-move'],
    ]);
    expect(hasBlockingError(issues)).toBe(false);
    const b = checkChapter(broken);
    expect(b[0].severity).toBe('error');
    expect(b[0].message).toBe('Line 1: main line stops after 1…e5: 2.Ke3 is not a legal move there, so the rest of the main line is missing.');
    expect(b[0].detail).toBe('Moves to here: 1.e4 e5');
    const bad = issues.find((i) => i.kind === 'bad-bracket-line')!;
    expect(bad.message).toBe('Line 1: bracketed line in the note at 1.e4: 1…Qxh8 is not legal after 1.e4.');
    expect(bad.detail).toBe('<1...Qxh8> · moves to here: 1.e4');
  });

  it('names the illegal move inside a bracketed line', async () => {
    const { checkChapter } = await import('../checker');
    const pgn = `[ChapterName "T"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 { Plan: <3...Nf6 4. Ng5 d5 5. Bxf7> } Bc5 *`;
    const [c] = parseChapters(pgn);
    const bad = checkChapter(c).find((i) => i.kind === 'bad-bracket-line')!;
    expect(bad.message).toContain('5.Bxf7 is not legal after 4…d5');
    expect(bad.detail).toContain('moves to here: 1.e4 e5 2.Nf3 Nc6 3.Bc4');
    const pgn2 = `[ChapterName "T"]\n\n1. e4 e5 2. Nf3 { <2...Nc6 4. Bb5> } Nc6 *`;
    const bad2 = checkChapter(parseChapters(pgn2)[0]).find((i) => i.kind === 'bad-bracket-line')!;
    expect(bad2.message).toContain('4.Bb5 has the wrong move number: after 2…Nc6 the next move is 3.');
  });
});

describe('bold notation in plain text', () => {
  it('bolds moves and squares but not ordinary words', async () => {
    const { splitNotation } = await import('../notation');
    const parts = splitNotation('We can consider 12... Nf6? but the e5 square and Bxf6 matter. A 2a3 typo, also O-O.');
    expect(parts.filter((p) => p.bold).map((p) => p.text)).toEqual(['12... Nf6?', 'e5', 'Bxf6', 'O-O']);
  });
});
