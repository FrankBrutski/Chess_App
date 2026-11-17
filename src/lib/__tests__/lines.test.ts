import { describe, expect, it } from 'vitest';
import { parseChapters } from '../pgn';
import { splitLines, branchesAlong, lineThrough } from '../lines';
import { STUDY_PGN } from './fixture';

const MF = { order: 'mainFirst' as const };

const root = () => parseChapters(STUDY_PGN)[0].root;

describe('splitLines', () => {
  it('gives one line per leaf, main line first', () => {
    const lines = splitLines(root(), 'white', MF);
    expect(lines.map((l) => l.nodes.map((n) => n.san).join(' '))).toEqual([
      'e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d4',
      'e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5!? d5',
      'e4 e5 Nf3 Nc6 Bc4 Nf6 d3',
      'e4 e5 Nf3 d6 d4',
    ].map((s) => s.replace('!?', '')));
  });

  it('labels lines by where they leave the previous one', () => {
    const lines = splitLines(root(), 'white', MF);
    expect(lines.map((l) => l.label)).toEqual(['Main line', '3…Nf6 4.Ng5', '3…Nf6 4.d3', '2…d6 3.d4']);
    expect(lines.map((l) => l.shared)).toEqual([0, 5, 6, 3]);
  });

  it('only drills lines where you play your first-choice move', () => {
    const lines = splitLines(root(), 'white', MF);
    // 4.d3 is White's second choice, so that line is for reading only.
    expect(lines.map((l) => l.trainable)).toEqual([true, true, false, true]);
    // Seen from Black's side, Black's alternatives (3…Nf6, 2…d6) become the reading-only lines.
    expect(splitLines(root(), 'black', MF).map((l) => l.trainable)).toEqual([true, false, false, false]);
  });

  it('lists the other lines branching off along a line', () => {
    const lines = splitLines(root(), 'white', MF);
    const b = branchesAlong(lines[0], lines);
    const at = (san: string) => b.get(lines[0].nodes.find((n) => n.san === san)!.id)?.map((x) => x.line.number);
    expect(at('Nc6')).toEqual([4]);
    expect(at('Bc5')).toEqual([2]);
    expect(at('e4')).toBeUndefined();
    const b2 = branchesAlong(lines[1], lines);
    expect(b2.get(lines[1].nodes[6].id)?.map((x) => x.move.san)).toEqual(['d3']);
  });

  it('finds the line through a node', () => {
    const lines = splitLines(root(), 'white', MF);
    expect(lineThrough(lines, lines[2].leafId)?.number).toBe(3);
  });
});

describe('line names', () => {
  it('keeps ids stable when a line is extended or a new line is added before it', () => {
    const a = splitLines(root(), 'white', MF);
    const pgn2 = STUDY_PGN.replace('(4. d3 { Quieter. })', '(4. d3 { Quieter. } 4... d6 5. O-O)').replace('(2... d6', '(2... f5 3. exf5) (2... d6');
    const b = splitLines(parseChapters(pgn2)[0].root, 'white', MF);
    const ids = (ls: typeof a) => Object.fromEntries(ls.map((l) => [l.label, l.id]));
    expect(ids(b)['3…Nf6 4.d3']).toBe(ids(a)['3…Nf6 4.d3']);
    expect(ids(b)['2…d6 3.d4']).toBe(ids(a)['2…d6 3.d4']);
    expect(b.length).toBe(a.length + 1);
  });

  it('labels a sub-branch by where it leaves the main line and its own branch', () => {
    const pgn2 = STUDY_PGN.replace('(4. d3 { Quieter. })', '(4. d3 { Quieter. }) 4... d5 (4... Bc5 5. Bxf7+)');
    const labels = splitLines(parseChapters(pgn2)[0].root, 'white', MF).map((l) => l.label);
    expect(labels).toContain('3…Nf6 … 4…Bc5');
  });

  it('uses your own name first, then a [Line: …] note, then the label', () => {
    const pgn2 = STUDY_PGN.replace('4. Ng5!? { Sharp. }', '4. Ng5!? { [Line: Fried Liver] Sharp. }').replace('{ The Philidor.', '{ [line:Philidor] The Philidor.');
    const r = parseChapters(pgn2)[0].root;
    let ls = splitLines(r, 'white', MF);
    // The note can sit on the branch move or the move right after it.
    expect(ls[1].name).toBe('Fried Liver');
    expect(ls[2].name).toBe('3…Nf6 4.d3');
    expect(ls[3].name).toBe('Philidor');
    ls = splitLines(r, 'white', { ...MF, names: { [ls[3].id]: 'My Philidor' } });
    expect(ls[3].name).toBe('My Philidor');
  });
});

describe('Chessable order (main line last)', () => {
  it('lists side lines in study order and the main line last, at every branch', () => {
    const ls = splitLines(root(), 'white');
    expect(ls.map((l) => l.label)).toEqual(['2…d6 3.d4', '3…Nf6 4.d3', '3…Nf6 4.Ng5', 'Main line']);
    expect(ls[3].id).toBe('main');
    // Ids, names and trainability don't depend on the order.
    const mf = splitLines(root(), 'white', MF);
    const byId = (x: typeof ls) => Object.fromEntries(x.map((l) => [l.id, [l.label, l.trainable]]));
    expect(byId(ls)).toEqual(byId(mf));
  });
});
