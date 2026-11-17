import { describe, expect, it } from 'vitest';
import { parseChapters } from '../pgn';
import { splitLines } from '../lines';
import {
  CHESSABLE_LADDER, DEFAULT_LADDER, formatLadder, learnCell, lineState, parseLadder, planLearn, planReview,
  retryFrontier, reviewCell, userKeys, type Cell, type TrainLine,
} from '../srs';
import { STUDY_PGN } from './fixture';

const H = 3_600_000;

const lines = (): TrainLine[] =>
  splitLines(parseChapters(STUDY_PGN)[0].root, 'white', { order: 'mainFirst' })
    .filter((l) => l.trainable)
    .map((line) => ({ chapterId: 'c', hiveId: 'h', combTitle: 'Main', color: 'white', line }));

describe('ladder', () => {
  it('formats and parses the default ladders', () => {
    expect(formatLadder(DEFAULT_LADDER)).toBe('4h, 8h, 12h, 1d, 2d, 3d, 1w, 2w, 1mo, 2mo, 4mo, 6mo');
    expect(formatLadder(CHESSABLE_LADDER)).toBe('4h, 1d, 3d, 1w, 2w, 1mo, 3mo, 6mo');
    expect(parseLadder(formatLadder(DEFAULT_LADDER))).toEqual(DEFAULT_LADDER);
    expect(parseLadder('30m 2h, 1.5d')).toEqual([30 * 60_000, 2 * H, 36 * H]);
  });
  it('rejects bad steps', () => {
    expect(() => parseLadder('4 hours')).toThrow();
    expect(() => parseLadder('1d, 4h')).toThrow(/longer/);
    expect(() => parseLadder('')).toThrow();
  });
});

describe('scheduling', () => {
  const ladder = DEFAULT_LADDER;
  it('climbs one step per correct review and stops at the top', () => {
    let c = learnCell('k', 0, ladder);
    expect(c.due).toBe(4 * H);
    c = reviewCell(c, true, 10, ladder, 'reset');
    expect(c.level).toBe(2);
    expect(c.due).toBe(10 + 8 * H);
    for (let i = 0; i < 20; i++) c = reviewCell(c, true, 0, ladder, 'reset');
    expect(c.level).toBe(ladder.length);
  });
  it('drops per the miss policy', () => {
    const c: Cell = { key: 'k', level: 6, due: 0, learnedAt: 0, lapses: 0 };
    expect(reviewCell(c, false, 0, ladder, 'reset').level).toBe(1);
    expect(reviewCell(c, false, 0, ladder, 'back2').level).toBe(4);
    expect(reviewCell(c, false, 0, ladder, 'back1').level).toBe(5);
    expect(reviewCell(c, false, 0, ladder, 'reset').lapses).toBe(1);
  });
  it('copes with a ladder that got shorter', () => {
    const c: Cell = { key: 'k', level: 12, due: 0, learnedAt: 0, lapses: 0 };
    expect(reviewCell(c, true, 0, CHESSABLE_LADDER, 'reset').level).toBe(8);
  });
});

describe('planning', () => {
  it('learns lines in order and skips moves already known from earlier lines', () => {
    const ls = lines();
    const cells = new Map<string, Cell>();
    expect(planLearn(ls, cells)[0]).toBe(ls[0]);
    for (const k of userKeys(ls[0])) cells.set(k, learnCell(k, 0, DEFAULT_LADDER));
    expect(lineState(ls[0], cells, 1)).toBe('learned');
    expect(planLearn(ls, cells)[0]).toBe(ls[1]);
    // Line 2 shares 1.e4 2.Nf3 3.Bc4 with line 1, so only its later moves are new.
    const fresh = userKeys(ls[1]).filter((k) => !cells.has(k));
    expect(fresh.length).toBeLessThan(userKeys(ls[1]).length);
  });

  it('covers each due move once, with as few lines as possible', () => {
    const ls = lines();
    const cells = new Map<string, Cell>();
    for (const t of ls) for (const k of userKeys(t)) cells.set(k, learnCell(k, 0, DEFAULT_LADDER));
    const plan = planReview(ls, cells, 5 * H);
    const asked = plan.flatMap((p) => [...p.ask]);
    expect(new Set(asked).size).toBe(asked.length);
    expect(new Set(asked)).toEqual(new Set(ls.flatMap(userKeys)));
    expect(planReview(ls, cells, 1 * H)).toEqual([]);
  });

  it('restarts two of your moves back after a miss', () => {
    const t = lines()[0]; // 1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 4.c3 Nf6 5.d4
    // Miss at 4.c3 (index 6): two of your moves back is 2.Nf3 (index 2), so restart from index 1.
    expect(retryFrontier(t, 6, 2)).toBe(1);
    expect(retryFrontier(t, 6, 1)).toBe(3);
    expect(retryFrontier(t, 2, 5)).toBe(-1);
    expect(retryFrontier(t, 6, 0)).toBe(5);
  });
});

describe('drill on/off', () => {
  it('leaves skipped lines, combs, sections and hives out of training', async () => {
    const { trainLinesOf } = await import('../training');
    const ch = { ...parseChapters(STUDY_PGN)[0], id: 'c', courseId: 'h', sectionId: 's', order: 0, importedAt: 0 } as never as import('../model').Chapter;
    const hive = { id: 'h', name: 'H', color: 'white', tier: 1, order: 0, sections: [{ id: 's', name: 'S' }], createdAt: 0, updatedAt: 0 } as import('../model').Course;
    const all = trainLinesOf([ch], false, [hive]);
    expect(all.length).toBe(3);
    expect(trainLinesOf([{ ...ch, skipLines: [all[1].line.id] }], false, [hive]).map((t) => t.line.id)).toEqual([all[0].line.id, all[2].line.id]);
    expect(trainLinesOf([{ ...ch, skip: true }], false, [hive])).toEqual([]);
    expect(trainLinesOf([ch], false, [{ ...hive, skip: true }])).toEqual([]);
    expect(trainLinesOf([ch], false, [{ ...hive, sections: [{ id: 's', name: 'S', skip: true }] }])).toEqual([]);
    expect(trainLinesOf([ch], true, [hive]).map((t) => t.line.id)).toEqual(['main']);
  });
});
