import { describe, expect, it } from 'vitest';
import { parseChapters } from '../pgn';
import { indexTree, pathTo } from '../tree';
import { parseCommentMoves, type CommentPiece } from '../commentMoves';
import { checkChapter } from '../checker';
import type { TreeNode } from '../model';

// Ruy Lopez main line to move 12, then a quiet endgame chapter for promotions.
const RUY = `[ChapterName "Ruy"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Na5 10. Bc2 c5 11. d4 Qc7 12. Nbd2 Bd7 *`;
const ENDGAME = `[ChapterName "Pawn race"]
[FEN "8/P5k1/8/8/8/8/5Kp1/8 w - - 0 50"]
[SetUp "1"]

50. a8=Q g1=Q+ *`;

function at(pgn: string, sans: string[]): { node: TreeNode; anc: TreeNode[] } {
  const ch = parseChapters(pgn)[0];
  const idx = indexTree(ch.root);
  let node: TreeNode = ch.root;
  for (const san of sans) node = node.children.find((c) => c.san === san)!;
  const anc = node.id === 'root' ? [] : [ch.root, ...pathTo(idx, node.id).slice(0, -1)];
  return { node, anc };
}

const moves = (pieces: CommentPiece[]) => pieces.filter((p) => p.kind === 'move').map((p) => p.text);
const isBad = (pieces: CommentPiece[]) => pieces.some((p) => p.kind === 'bad');
const lineOf = (pieces: CommentPiece[], text: string) => {
  const p = pieces.find((x) => x.kind === 'move' && x.text === text);
  return p && p.kind === 'move' ? p.line.slice(0, p.index + 1).map((g) => g.san) : undefined;
};
const shown = (pieces: CommentPiece[]) => pieces.map((p) => p.text).join('');

// Comment sits after 11...Qc7 (ply 22), White to play move 12.
const RUY_PATH = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'Re1', 'b5', 'Bb3', 'd6', 'c3', 'O-O', 'h3', 'Na5', 'Bc2', 'c5', 'd4', 'Qc7'];
const ruy = at(RUY, RUY_PATH);
const parse = (text: string) => parseCommentMoves(text, ruy.node, ruy.anc);

describe('bracketed lines: move numbers and spacing', () => {
  it.each([
    ['<12. Nbd2 Bd7>', ['12. Nbd2', 'Bd7']],
    ['<12.Nbd2 Bd7>', ['12.Nbd2', 'Bd7']],
    ['<  12. Nbd2   Bd7 >', ['12. Nbd2', 'Bd7']],
    ['<Nbd2 Bd7 13. Nf1>', ['Nbd2', 'Bd7', '13. Nf1']],
  ])('%s', (text, expected) => {
    const p = parse(text);
    expect(isBad(p)).toBe(false);
    expect(moves(p)).toEqual(expected);
  });

  it.each([
    ['<11...Qc7 12. Nbd2>', ['11...Qc7', '12. Nbd2']],
    ['<11... Qc7 12. Nbd2>', ['11... Qc7', '12. Nbd2']],
    ['<11…Qc7 12. Nbd2>', ['11…Qc7', '12. Nbd2']],
    ['<11.. Qc7 12. Nbd2>', ['11.. Qc7', '12. Nbd2']],
    ['<11. ... Qc7 12. Nbd2>', ['11. ... Qc7', '12. Nbd2']],
    ['<11. … Qc7 12. Nbd2>', ['11. … Qc7', '12. Nbd2']],
  ])('Black move numbers: %s', (text, expected) => {
    const p = parse(text);
    expect(isBad(p)).toBe(false);
    expect(moves(p)).toEqual(expected);
  });
});

describe('bracketed lines: starting point', () => {
  it('starts from an earlier move (an alternative already passed)', () => {
    const p = parse('<9...Bb7 10. d4>');
    expect(moves(p)).toEqual(['9...Bb7', '10. d4']);
  });
  it('starts from the first move of the game', () => {
    expect(moves(parse('<1. d4 d5>'))).toEqual(['1. d4', 'd5']);
  });
  it('starts from a main-line move still to come', () => {
    const early = at(RUY, ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']);
    const p = parseCommentMoves('The plan is <9. h3 Na5 10. Bc2>.', early.node, early.anc);
    expect(moves(p)).toEqual(['9. h3', 'Na5', '10. Bc2']);
  });
  it('without a number, tries the current position, then an alternative to the last move', () => {
    expect(moves(parse('<Nbd2 Bd7>'))).toEqual(['Nbd2', 'Bd7']);
    expect(moves(parse('<cxd4 cxd4>'))).toEqual(['cxd4', 'cxd4']); // Black's alternative to 11...Qc7
  });
  it('flags a wrong move number', () => {
    expect(isBad(parse('<14. Nbd2 Bd7>'))).toBe(true);
  });
});

describe('bracketed lines: notation', () => {
  it('accepts O-O and 0-0 castling', () => {
    const e = at(RUY, ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6']);
    expect(moves(parseCommentMoves('<5. O-O Be7>', e.node, e.anc))).toEqual(['5. O-O', 'Be7']);
    expect(moves(parseCommentMoves('<5. 0-0 Be7>', e.node, e.anc))).toEqual(['5. 0-0', 'Be7']);
  });
  it('accepts promotions with or without "=", and checks', () => {
    const e = at(ENDGAME, []);
    expect(moves(parseCommentMoves('<50. a8=Q g1=Q+>', e.node, e.anc))).toEqual(['50. a8=Q', 'g1=Q+']);
    expect(moves(parseCommentMoves('<50. a8Q g1Q+>', e.node, e.anc))).toEqual(['50. a8Q', 'g1Q+']);
    expect(moves(parseCommentMoves('<50. a8=N g1=Q+>', e.node, e.anc))).toEqual(['50. a8=N', 'g1=Q+']);
  });
  it('accepts a missing or extra check sign', () => {
    const e = at(ENDGAME, []);
    expect(isBad(parseCommentMoves('<50. a8=Q g1=Q>', e.node, e.anc))).toBe(false);
  });
  it('accepts mate signs', () => {
    const e = at('[ChapterName "Mate"]\n\n1. f3 e5 2. g4 *', ['f3', 'e5', 'g4']);
    expect(moves(parseCommentMoves('<2...Qh4#>', e.node, e.anc))).toEqual(['2...Qh4#']);
  });
  it.each(['??', '!?', '?!', '!!', '!', '?'])('keeps move marks attached: Nbd2%s', (mark) => {
    expect(moves(parse(`<12. Nbd2${mark} Bd7>`))).toEqual([`12. Nbd2${mark}`, 'Bd7']);
  });
  it('skips separate marks, NAGs, evaluations and results', () => {
    const p = parse('<12. Nbd2 !? Bd7 $6 13. Nf1 += Rfe8 +/= 14. Ng3 1-0>');
    expect(isBad(p)).toBe(false);
    expect(moves(p)).toEqual(['12. Nbd2', 'Bd7', '13. Nf1', 'Rfe8', '14. Ng3']);
  });
  it('accepts commas inside the brackets', () => {
    const p = parse('<12. Nbd2 Bd7, 13. Nf1>');
    expect(moves(p)).toEqual(['12. Nbd2', 'Bd7', '13. Nf1']);
  });
});

describe('bracketed lines: side lines', () => {
  it('handles a side line in the middle', () => {
    const p = parse('<12. Nbd2 (12. d5 c4) Bd7>');
    expect(moves(p)).toEqual(['12. Nbd2', '12. d5', 'c4', 'Bd7']);
    expect(lineOf(p, 'c4')).toEqual(['d5', 'c4']);
    expect(lineOf(p, 'Bd7')).toEqual(['Nbd2', 'Bd7']);
  });
  it('handles two side lines in a row (alternatives to the same move)', () => {
    const p = parse('<12. Nbd2 (12. d5 c4) (12. a4 Bb7) Bd7>');
    expect(isBad(p)).toBe(false);
    expect(lineOf(p, 'Bb7')).toEqual(['a4', 'Bb7']);
    expect(lineOf(p, 'Bd7')).toEqual(['Nbd2', 'Bd7']);
  });
  it('handles side lines nested two levels deep', () => {
    const p = parse('<12. Nbd2 Bd7 (12...cxd4 13. cxd4 (13. Nxd4?! Bd7) Nc6) 13. Nf1>');
    expect(isBad(p)).toBe(false);
    expect(lineOf(p, '13. Nxd4?!')).toEqual(['Nbd2', 'cxd4', 'Nxd4']);
    expect(lineOf(p, 'Nc6')).toEqual(['Nbd2', 'cxd4', 'cxd4', 'Nc6']);
    expect(lineOf(p, '13. Nf1')).toEqual(['Nbd2', 'Bd7', 'Nf1']);
    const depths = p.filter((x) => x.kind === 'move').map((x) => (x.kind === 'move' ? x.depth : -1));
    expect(depths).toEqual([0, 0, 1, 1, 2, 2, 1, 0]);
  });
  it('handles a side line with spaces inside the parentheses', () => {
    expect(isBad(parse('<12. Nbd2 ( 12. d5 c4 ) Bd7>'))).toBe(false);
  });
  it('handles a side line at the very end', () => {
    expect(moves(parse('<12. Nbd2 Bd7 (12...Re8)>'))).toEqual(['12. Nbd2', 'Bd7', '12...Re8']);
  });
  it.each(['<12. Nbd2 (12. d5 c4 Bd7>', '<12. Nbd2 12. d5 c4) Bd7>', '<(12. d5) Nbd2>'])('flags unbalanced parentheses: %s', (text) => {
    expect(isBad(parse(text))).toBe(true);
  });
  it('flags an illegal move inside a nested line', () => {
    expect(isBad(parse('<12. Nbd2 (12. d5 Qxh2) Bd7>'))).toBe(true);
  });
});

describe('bracketed lines in sentences', () => {
  it('handles several bracketed lines in one comment', () => {
    const p = parse('Both <12. Nbd2 Bd7> and <12. d5 c4> are fine; <12. a4 Bb7> is rarer.');
    expect(moves(p)).toEqual(['12. Nbd2', 'Bd7', '12. d5', 'c4', '12. a4', 'Bb7']);
    expect(shown(p)).toBe('Both 12. Nbd2 Bd7 and 12. d5 c4 are fine; 12. a4 Bb7 is rarer.');
  });
  it('handles brackets next to punctuation', () => {
    for (const [text, out] of [
      ['(<12. Nbd2 Bd7>)', '(12. Nbd2 Bd7)'],
      ['"<12. Nbd2 Bd7>",', '"12. Nbd2 Bd7",'],
      ['better is <12. Nbd2 Bd7>.', 'better is 12. Nbd2 Bd7.'],
      ['<12. Nbd2 Bd7>!', '12. Nbd2 Bd7!'],
      ['better:<12. Nbd2 Bd7>', 'better:12. Nbd2 Bd7'],
    ]) {
      const p = parse(text);
      expect(isBad(p), text).toBe(false);
      expect(shown(p), text).toBe(out);
    }
  });
  it('leaves unbracketed moves as plain text', () => {
    const p = parse('We can consider 12. d5? but 12. Nbd2 is the main move.');
    expect(moves(p)).toEqual([]);
  });
  it('treats an empty "<>" as plain text', () => {
    expect(isBad(parse('see <> here'))).toBe(false);
  });
  it('flags prose inside brackets', () => {
    expect(isBad(parse('<see the note above>'))).toBe(true);
  });
});

describe('checker on stray brackets', () => {
  it('warns about a < or > without its partner but does not block', () => {
    const ch = parseChapters('[ChapterName "x"]\n\n1. e4 { Better is <1...c5 2. Nf3 } e5 { and 2.Nf3 > 2.Bc4 } *')[0];
    const issues = checkChapter(ch);
    expect(issues.filter((i) => i.kind === 'unmatched-bracket')).toHaveLength(2);
    expect(issues.every((i) => i.severity === 'warning')).toBe(true);
  });
});

