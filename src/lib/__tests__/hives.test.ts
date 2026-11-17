import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, chaptersOf, exportBackup, importBackup, newId } from '../db';
import { createHive, importInto, moveComb, planSync } from '../importer';
import { groupHives, migrateHive, tierName } from '../hives';
import { parseChapters } from '../pgn';
import { STUDY_PGN } from './fixture';
import type { Chapter, Course } from '../model';

beforeEach(async () => {
  await db.courses.clear();
  await db.chapters.clear();
});

describe('hive helpers', () => {
  it('names tiers', () => {
    expect([1, 2, 3, 4].map(tierName)).toEqual(['Main', 'Secondary', 'Tertiary', 'Tier 4']);
  });

  it('groups hives by colour, then tier, then manual order', () => {
    const h = (name: string, color: 'white' | 'black', tier: number, order: number) =>
      ({ id: name, name, color, tier, order, sections: [], createdAt: 0, updatedAt: 0 }) as Course;
    const groups = groupHives([h('Scotch', 'white', 2, 0), h('KG', 'white', 1, 0), h('Najdorf', 'black', 1, 1), h('Caro', 'black', 1, 0)]);
    expect(groups.map((g) => [g.color, g.tiers.map((t) => [t.tier, t.hives.map((x) => x.name)])])).toEqual([
      ['white', [[1, ['KG']], [2, ['Scotch']]]],
      ['black', [[1, ['Caro', 'Najdorf']]]],
    ]);
  });

  it('migrates an old one-study course into a hive with one section', () => {
    const url = 'https://lichess.org/study/AbCdEfGh';
    const old = { id: 'c1', name: 'Italian', sourceUrl: url, lichessStudyId: 'AbCdEfGh' };
    const ch = [{ id: 'x', courseId: 'c1', orientation: 'black' } as unknown as Chapter];
    const hive = migrateHive(old, ch, 3, () => 's1');
    expect(hive).toMatchObject({ color: 'black', tier: 1, order: 3, sections: [{ id: 's1', name: 'Italian', sourceUrl: url }] });
    expect(hive.sourceUrl).toBeUndefined();
    expect(ch[0].sectionId).toBe('s1');
  });

  it('drops a non-Lichess link while migrating', () => {
    const hive = migrateHive({ id: 'c', name: 'n', sourceUrl: 'javascript:alert(1)' }, [], 0, () => 's');
    expect(hive.sections[0].sourceUrl).toBeUndefined();
  });

  it('add mode never removes existing combs; replace mode does', () => {
    const parsed = parseChapters(STUDY_PGN);
    const existing = [{ id: 'old', title: 'Something else', lichessChapterId: 'zzzzzzzz' } as Chapter];
    expect(planSync(existing, parsed, false).removed).toEqual([]);
    expect(planSync(existing, parsed, true).removed.map((c) => c.id)).toEqual(['old']);
  });
});

describe('importing into hives and sections', () => {
  it('imports a study into a new section of a new hive, oriented to the hive colour', async () => {
    const hive = await createHive({ name: "King's Gambit", color: 'black', tier: 1 });
    const r = await importInto({ hiveId: hive.id, newSectionName: 'Accepted', replace: false }, parseChapters(STUDY_PGN));
    const saved = (await db.courses.get(hive.id))!;
    expect(saved.sections.map((s) => s.name)).toEqual(['Accepted']);
    const combs = await chaptersOf(hive.id);
    expect(combs.map((c) => [c.title, c.sectionId, c.orientation])).toEqual([
      ['Main line', r.sectionId, 'black'],
      ['Black plays ...Be7', r.sectionId, 'black'],
    ]);
  });

  it('a second study goes into its own section, and reading order follows the sections', async () => {
    const hive = await createHive({ name: 'Scotch', color: 'white', tier: 2 });
    await importInto({ hiveId: hive.id, newSectionName: 'A', replace: false }, parseChapters(STUDY_PGN).slice(0, 1));
    await importInto({ hiveId: hive.id, newSectionName: 'B', replace: false }, parseChapters(STUDY_PGN).slice(1));
    const saved = (await db.courses.get(hive.id))!;
    expect(saved.sections.map((s) => s.name)).toEqual(['A', 'B']);
    expect((await chaptersOf(hive.id)).map((c) => c.title)).toEqual(['Main line', 'Black plays ...Be7']);
  });

  it('syncing a section keeps comb ids and only touches that section', async () => {
    const hive = await createHive({ name: 'H', color: 'white', tier: 1 });
    const a = await importInto({ hiveId: hive.id, newSectionName: 'A', replace: false }, parseChapters(STUDY_PGN));
    const b = await importInto({ hiveId: hive.id, newSectionName: 'B', replace: false }, parseChapters(STUDY_PGN).slice(0, 1));
    const before = await chaptersOf(hive.id);
    const ids = before.filter((c) => c.sectionId === a.sectionId).map((c) => c.id);
    await importInto({ hiveId: hive.id, sectionId: a.sectionId, replace: true }, parseChapters(STUDY_PGN).slice(0, 1));
    const after = await chaptersOf(hive.id);
    expect(after.filter((c) => c.sectionId === a.sectionId).map((c) => c.id)).toEqual([ids[0]]);
    expect(after.filter((c) => c.sectionId === b.sectionId)).toHaveLength(1);
  });

  it('moving a comb to another hive keeps its id and adopts the new colour', async () => {
    const white = await createHive({ name: 'W', color: 'white', tier: 1 });
    const black = await createHive({ name: 'B', color: 'black', tier: 1 });
    await importInto({ hiveId: white.id, newSectionName: 'S', replace: false }, parseChapters(STUDY_PGN).slice(0, 1));
    const r = await importInto({ hiveId: black.id, newSectionName: 'T', replace: false }, parseChapters(STUDY_PGN).slice(1));
    const [comb] = await chaptersOf(white.id);
    await moveComb(comb.id, black.id, r.sectionId);
    const moved = (await db.chapters.get(comb.id))!;
    expect(moved).toMatchObject({ courseId: black.id, sectionId: r.sectionId, orientation: 'black', order: 1 });
    expect(await chaptersOf(white.id)).toHaveLength(0);
  });

  it('restores an old (version 1) backup into hives with sections', async () => {
    const parsed = parseChapters(STUDY_PGN);
    const oldBackup = {
      app: 'chess-app',
      version: 1,
      exportedAt: '',
      courses: [{ id: 'c1', name: 'Italian', sourceUrl: 'https://lichess.org/study/AbCdEfGh', createdAt: 0, updatedAt: 0 }],
      chapters: parsed.map((p, i) => ({ id: `ch${i}`, courseId: 'c1', order: i, title: p.title, orientation: 'white', root: p.root, importedAt: 0 })),
    };
    await importBackup(oldBackup);
    const hive = (await db.courses.get('c1'))!;
    expect(hive.sections).toHaveLength(1);
    expect(hive.sections[0].sourceUrl).toBe('https://lichess.org/study/AbCdEfGh');
    expect((await chaptersOf('c1')).every((c) => c.sectionId === hive.sections[0].id)).toBe(true);
    const round = await exportBackup();
    expect(round.version).toBe(3);
    expect(newId()).toMatch(/\w/);
  });
});

describe('training progress in backups', () => {
  it('saves and restores cells and honey', async () => {
    const { db, exportBackup, importBackup, addHoney } = await import('../db');
    await db.cells.put({ key: 'k1', level: 3, due: 123, learnedAt: 1, lapses: 0 });
    await addHoney(5);
    await addHoney(2);
    const b = await exportBackup();
    expect(b.cells?.find((c) => c.key === 'k1')?.level).toBe(3);
    expect(b.honey?.reduce((n, h) => n + h.amount, 0)).toBeGreaterThanOrEqual(7);
    await db.cells.clear();
    await db.honey.clear();
    await importBackup({ ...b, cells: [...(b.cells ?? []), { key: 5 }] });
    expect((await db.cells.get('k1'))?.level).toBe(3);
    expect(await db.cells.count()).toBe(1);
  });
});

describe('line settings across a re-sync', () => {
  it('keeps line names, skipped lines and comb skip after syncing a changed study', async () => {
    const hive = await createHive({ name: 'Keep', color: 'white', tier: 1 });
    const a = await importInto({ hiveId: hive.id, newSectionName: 'A', replace: false }, parseChapters(STUDY_PGN).slice(0, 1));
    const [ch] = await chaptersOf(hive.id);
    const { splitLines } = await import('../lines');
    const before = splitLines(ch.root, 'white', { order: 'mainFirst' });
    const { db } = await import('../db');
    await db.chapters.where('id').equals(ch.id).modify((c) => { c.lineNames = { [before[3].id]: 'Philidor' }; c.skipLines = [before[1].id]; c.skip = true; });
    // The study gains a new line and an extended one.
    const changed = STUDY_PGN.replace('(4. d3 { Quieter. })', '(4. d3 { Quieter. } 4... d6)').replace('(2... d6', '(2... f5 3. exf5) (2... d6');
    await importInto({ hiveId: hive.id, sectionId: a.sectionId, replace: true }, parseChapters(changed).slice(0, 1));
    const [after] = await chaptersOf(hive.id);
    expect(after.id).toBe(ch.id);
    const lines = splitLines(after.root, 'white', { names: after.lineNames });
    expect(lines.find((l) => l.id === before[3].id)?.name).toBe('Philidor');
    expect(after.skipLines).toEqual([before[1].id]);
    expect(after.skip).toBe(true);
  });
});
