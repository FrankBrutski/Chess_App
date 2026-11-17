import { describe, expect, it } from 'vitest';
import { parseChapters } from '../pgn';
import { buildIndex, boardDistance, leftBook, lookup, movesFromText, nearest, normalizeFen, playMoves } from '../positions';
import type { Chapter, Course } from '../model';
import { STUDY_PGN } from './fixture';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const hive: Course = { id: 'h', name: 'Italian', color: 'white', tier: 1, order: 0, sections: [{ id: 's', name: 'S' }], createdAt: 0, updatedAt: 0 };
const chapters: Chapter[] = parseChapters(STUDY_PGN).map((p, i) => ({
  id: `c${i}`, courseId: 'h', sectionId: 's', order: i, title: p.title, orientation: 'white', root: p.root, importedAt: 0,
}));
const index = buildIndex([hive], chapters, { order: 'mainFirst' });
const fenAfter = (moves: string) => playMoves(START, movesFromText(moves)).positions.at(-1)!.fen;

describe('position lookup', () => {
  it('finds a position in every comb and line it occurs in, with the move to play', () => {
    const hits = lookup(index, fenAfter('1. e4 e5 2. Nf3 Nc6'));
    expect(hits.map((h) => h.chapter.title)).toEqual(['Main line', 'Black plays ...Be7']);
    expect(hits[0].yourMove).toBe(true);
    expect(hits[0].next[0].san).toBe('Bc4');
    expect(hits[0].lineCount).toBeGreaterThan(1);
    // Points at the line that continues with the main moves, whatever the line order.
    expect(hits[0].line.id).toBe('main');
    const mainLast = buildIndex([hive], chapters, { order: 'mainLast' });
    expect(lookup(mainLast, fenAfter('1. e4 e5 2. Nf3 Nc6'))[0].line.id).toBe('main');
  });

  it('counts transpositions', () => {
    // 1.Nf3 Nc6 2.e4 e5 reaches the same position by another order.
    expect(lookup(index, fenAfter('1. Nf3 Nc6 2. e4 e5')).length).toBe(2);
  });

  it("tells whose move it is and gives the opponent's covered replies", () => {
    const [h] = lookup(index, fenAfter('1. e4 e5 2. Nf3'));
    expect(h.yourMove).toBe(false);
    expect(h.next.map((n) => n.san)).toEqual(['Nc6', 'd6']);
  });

  it('ignores move counters and flags castling differences', () => {
    const fen = fenAfter('1. e4 e5 2. Nf3 Nc6').replace(/ \d+ \d+$/, ' 7 30');
    expect(lookup(index, fen).length).toBe(2);
    const noCastle = fen.replace('KQkq', 'kq');
    expect(lookup(index, noCastle)[0].rightsDiffer).toBe(true);
  });

  it('finds where a game left the repertoire', () => {
    const game = playMoves(START, movesFromText('[Event "x"] 1. e4 e5 2. Nf3 {hi} Nc6 (2... d6) 3. Bc4 h6 4. d3 1-0')).positions;
    const out = leftBook(index, game)!;
    expect(game[out.at].san).toBe('Bc4');
    expect(out.played).toBe('h6');
    expect(out.hits[0].next.map((n) => n.san)).toContain('Bc5');
  });

  it('suggests the closest known positions', () => {
    const fen = fenAfter('1. e4 e5 2. Nf3 Nc6 3. Bc4 h6');
    expect(lookup(index, fen)).toEqual([]);
    const near = nearest(index, fen);
    expect(near[0].distance).toBeLessThanOrEqual(2);
    expect(boardDistance('8/8/8/8/8/8/8/8', '8/8/8/8/8/8/8/7K')).toBe(1);
  });

  it('rejects broken FENs with a readable message', () => {
    expect(normalizeFen('nonsense')).toEqual({ error: 'That FEN is not valid.' });
    expect('error' in normalizeFen('8/8/8/8/8/8/8/8 w - - 0 1')).toBe(true);
    expect(normalizeFen(START)).toEqual({ fen: START });
  });
});
