import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, chaptersOf, exportBackup, importBackup, newId } from '../db';
import { createHive, deleteSection, importInto, moveComb, planSync, setSectionCombs } from '../importer';
import { UNSECTIONED_SCOPE, addSource, groupHives, migrateHive, tierName } from '../hives';
import { inScope } from '../training';
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
    expect(hive).toMatchObject({ color: 'black', tier: 1, order: 3, sections: [{ id: 's1', name: 'Italian' }], sources: [{ studyId: 'AbCdEfGh' }] });
    expect(hive.sourceUrl).toBeUndefined();
    expect(hive.sections[0].sourceUrl).toBeUndefined();
    expect(ch[0].sectionId).toBe('s1');
  });

  it('drops a non-Lichess link while migrating', () => {
    const hive = migrateHive({ id: 'c', name: 'n', sourceUrl: 'javascript:alert(1)', sections: [{ id: 's', name: 's', sourceUrl: 'https://evil.example/study/AbCdEfGh' }] }, [], 0, () => 's');
    expect(hive.sources).toBeUndefined();
  });

  it('moves section links to the hive, and tags combs with their study', () => {
    const course = {
      id: 'h', name: 'KID', color: 'black', tier: 1, order: 0, createdAt: 0, updatedAt: 0,
      sections: [{ id: 'a', name: 'A', sourceUrl: 'https://lichess.org/study/AbCdEfGh', lichessStudyId: 'AbCdEfGh' }, { id: 'b', name: 'B' }],
    } as Course;
    const ch = [
      { id: 'x', courseId: 'h', sectionId: 'a', lichessChapterId: 'IjKlMnOp' },
      { id: 'y', courseId: 'h', sectionId: 'gone' },
      { id: 'z', courseId: 'h', sectionId: 'b', lichessChapterId: 'QrStUvWx', lichessStudyId: 'ZzZzZzZz' },
    ] as Chapter[];
    const hive = migrateHive(course, ch, 0, () => 'n');
    expect(hive.sources).toEqual([{ studyId: 'AbCdEfGh' }]);
    expect(hive.sections).toEqual([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
    expect(ch.map((c) => [c.sectionId, c.lichessStudyId])).toEqual([['a', 'AbCdEfGh'], ['', undefined], ['b', 'ZzZzZzZz']]);
    // Running it again changes nothing.
    expect(migrateHive(structuredClone(hive), structuredClone(ch), 0, () => 'n')).toEqual(hive);
  });

  it('remembers each link once; a whole study covers its single chapters', () => {
    let s = addSource(undefined, { studyId: 'AbCdEfGh', chapterId: 'IjKlMnOp' });
    s = addSource(s, { studyId: 'AbCdEfGh', chapterId: 'IjKlMnOp' });
    expect(s).toEqual([{ studyId: 'AbCdEfGh', chapterId: 'IjKlMnOp' }]);
    s = addSource(s, { studyId: 'AbCdEfGh' });
    expect(s).toEqual([{ studyId: 'AbCdEfGh' }]);
    expect(addSource(s, { studyId: 'AbCdEfGh', chapterId: 'QrStUvWx' })).toEqual([{ studyId: 'AbCdEfGh' }]);
    expect(addSource(s, { studyId: '../evil' })).toEqual(s);
  });

  it('adding never removes; a sync removes only chapters of the synced study', () => {
    const parsed = parseChapters(STUDY_PGN);
    const existing = [
      { id: 'old', title: 'Gone from Lichess', lichessChapterId: 'zzzzzzzz', lichessStudyId: 'AbCdEfGh' },
      { id: 'other', title: 'Other study', lichessChapterId: 'yyyyyyyy', lichessStudyId: 'OtHeRsTu' },
      { id: 'file', title: 'From a PGN file' },
    ] as Chapter[];
    expect(planSync(existing, parsed, false).removed).toEqual([]);
    expect(planSync(existing, parsed, [{ studyId: 'AbCdEfGh' }]).removed.map((c) => c.id)).toEqual(['old']);
    // A single-chapter link only covers that chapter.
    expect(planSync(existing, parsed, [{ studyId: 'AbCdEfGh', chapterId: 'IjKlMnOp' }]).removed).toEqual([]);
  });
});

describe('importing into hives and sections', () => {
  it('imports a study into a new section of a new hive, oriented to the hive colour', async () => {
    const hive = await createHive({ name: "King's Gambit", color: 'black', tier: 1 });
    const r = await importInto({ hiveId: hive.id, newSectionName: 'Accepted' }, parseChapters(STUDY_PGN));
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
    await importInto({ hiveId: hive.id, newSectionName: 'A' }, parseChapters(STUDY_PGN).slice(0, 1));
    await importInto({ hiveId: hive.id, newSectionName: 'B' }, parseChapters(STUDY_PGN).slice(1));
    const saved = (await db.courses.get(hive.id))!;
    expect(saved.sections.map((s) => s.name)).toEqual(['A', 'B']);
    expect((await chaptersOf(hive.id)).map((c) => c.title)).toEqual(['Main line', 'Black plays ...Be7']);
  });

  it('importing the same study again updates combs where they are, without copies', async () => {
    const hive = await createHive({ name: 'H', color: 'white', tier: 1 });
    await importInto({ hiveId: hive.id }, parseChapters(STUDY_PGN));
    const before = await chaptersOf(hive.id);
    const s = await setSectionCombs(hive.id, undefined, 'Mine', [before[1].id]);
    await importInto({ hiveId: hive.id, newSectionName: 'Again' }, parseChapters(STUDY_PGN));
    const after = await chaptersOf(hive.id);
    expect(after.map((c) => [c.id, c.sectionId])).toEqual([[before[0].id, ''], [before[1].id, s]]);
  });

  it('a whole-study import lands in Unsectioned and saves the link on the hive', async () => {
    const hive = await createHive({ name: 'H', color: 'white', tier: 1 });
    await importInto({ hiveId: hive.id, source: { studyId: 'AbCdEfGh' } }, parseChapters(STUDY_PGN));
    const saved = (await db.courses.get(hive.id))!;
    expect(saved.sections).toEqual([]);
    expect(saved.sources).toEqual([{ studyId: 'AbCdEfGh' }]);
    const combs = await chaptersOf(hive.id);
    expect(combs.map((c) => [c.sectionId, c.order, c.lichessStudyId])).toEqual([['', 0, 'AbCdEfGh'], ['', 1, 'AbCdEfGh']]);
  });

  it('+ Section takes combs, moving them from another section; reorder and delete keep the combs', async () => {
    const hive = await createHive({ name: 'H', color: 'white', tier: 1 });
    await importInto({ hiveId: hive.id }, parseChapters(STUDY_PGN));
    const [one, two] = await chaptersOf(hive.id);
    await db.chapters.where('id').equals(one.id).modify((c) => { c.lineNames = { main: 'Mine' }; c.skipLines = ['x']; });
    const a = await setSectionCombs(hive.id, undefined, 'A', [one.id, two.id]);
    const b = await setSectionCombs(hive.id, undefined, 'B', [two.id]);
    expect((await chaptersOf(hive.id)).map((c) => [c.title, c.sectionId])).toEqual([['Main line', a], ['Black plays ...Be7', b]]);
    // Move B above A: its combs come first in reading order.
    const h = (await db.courses.get(hive.id))!;
    await db.courses.update(hive.id, { sections: [h.sections[1], h.sections[0]] });
    expect((await chaptersOf(hive.id)).map((c) => c.id)).toEqual([two.id, one.id]);
    // Choose combs: taking one out of a section sends it to Unsectioned.
    await setSectionCombs(hive.id, b, 'B renamed', []);
    expect((await db.chapters.get(two.id))!.sectionId).toBe('');
    expect((await db.courses.get(hive.id))!.sections.find((s) => s.id === b)!.name).toBe('B renamed');
    // Deleting A keeps its comb, with its settings, in Unsectioned.
    await deleteSection(hive.id, a);
    const kept = (await db.chapters.get(one.id))!;
    expect([kept.id, kept.sectionId, kept.lineNames, kept.skipLines]).toEqual([one.id, '', { main: 'Mine' }, ['x']]);
    expect((await db.courses.get(hive.id))!.sections.map((s) => s.id)).toEqual([b]);
    expect(await db.chapters.where('courseId').equals(hive.id).count()).toBe(2);
    // Training can pick the Unsectioned combs.
    const all = await db.chapters.toArray();
    const scope = { hive: hive.id, section: UNSECTIONED_SCOPE, comb: '', mainHivesOnly: false, mainLinesOnly: false };
    expect(inScope(await db.courses.toArray(), all, scope)).toHaveLength(2);
  });

  it('hive sync: updates moved combs in place, adds new chapters to Unsectioned as NEW, removes deleted ones', async () => {
    const hive = await createHive({ name: 'H', color: 'white', tier: 1 });
    await importInto({ hiveId: hive.id, source: { studyId: 'AbCdEfGh' } }, parseChapters(STUDY_PGN));
    const [one, two] = await chaptersOf(hive.id);
    const a = await setSectionCombs(hive.id, undefined, 'A', [two.id]);
    await importInto({ hiveId: hive.id }, [{ ...parseChapters(STUDY_PGN)[0], title: 'From a file', lichessChapterId: undefined, lichessStudyId: undefined }]);
    // Lichess now has only the second chapter, plus a brand new one.
    const [, second] = parseChapters(STUDY_PGN);
    const brandNew = { ...second, title: 'Averbakh', lichessChapterId: 'NeWnEwNe' };
    const r = await importInto({ hiveId: hive.id, sync: { removeScope: [{ studyId: 'AbCdEfGh' }] } }, [second, brandNew]);
    expect(r.removed.map((c) => c.id)).toEqual([one.id]);
    const after = await chaptersOf(hive.id);
    // Combs in no section are listed first, then the sections.
    expect(after.map((c) => [c.title, c.sectionId === a ? 'A' : c.sectionId, !!c.fresh])).toEqual([
      ['From a file', '', false],
      ['Averbakh', '', true],
      ['Black plays ...Be7', 'A', false],
    ]);
    expect(after[2].id).toBe(two.id);
    // Filing the new comb into a section clears its NEW tag.
    await setSectionCombs(hive.id, a, 'A', [two.id, after[1].id]);
    expect((await db.chapters.get(after[1].id))!.fresh).toBeUndefined();
  });

  it('moving a comb to another hive keeps its id and adopts the new colour', async () => {
    const white = await createHive({ name: 'W', color: 'white', tier: 1 });
    const black = await createHive({ name: 'B', color: 'black', tier: 1 });
    await importInto({ hiveId: white.id, newSectionName: 'S' }, parseChapters(STUDY_PGN).slice(0, 1));
    const r = await importInto({ hiveId: black.id, newSectionName: 'T' }, parseChapters(STUDY_PGN).slice(1));
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
    expect(hive.sources).toEqual([{ studyId: 'AbCdEfGh' }]);
    expect((await chaptersOf('c1')).every((c) => c.sectionId === hive.sections[0].id)).toBe(true);
    const round = await exportBackup();
    expect(round.version).toBe(4);
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
    await importInto({ hiveId: hive.id, newSectionName: 'A' }, parseChapters(STUDY_PGN).slice(0, 1));
    const [ch] = await chaptersOf(hive.id);
    const { splitLines } = await import('../lines');
    const before = splitLines(ch.root, 'white', { order: 'mainFirst' });
    const { db } = await import('../db');
    await db.chapters.where('id').equals(ch.id).modify((c) => { c.lineNames = { [before[3].id]: 'Philidor' }; c.skipLines = [before[1].id]; c.skip = true; });
    // The study gains a new line and an extended one.
    const changed = STUDY_PGN.replace('(4. d3 { Quieter. })', '(4. d3 { Quieter. } 4... d6)').replace('(2... d6', '(2... f5 3. exf5) (2... d6');
    await importInto({ hiveId: hive.id, sync: { removeScope: [] } }, parseChapters(changed).slice(0, 1));
    const [after] = await chaptersOf(hive.id);
    expect(after.id).toBe(ch.id);
    const lines = splitLines(after.root, 'white', { names: after.lineNames });
    expect(lines.find((l) => l.id === before[3].id)?.name).toBe('Philidor');
    expect(after.skipLines).toEqual([before[1].id]);
    expect(after.skip).toBe(true);
  });
  it('a comb moved to another section or hive is updated where it is on sync, not duplicated', async () => {
    const hive = await createHive({ name: 'H', color: 'white', tier: 1 });
    const black = await createHive({ name: 'B', color: 'black', tier: 1 });
    await importInto({ hiveId: hive.id, newSectionName: 'A' }, parseChapters(STUDY_PGN));
    const b = await importInto({ hiveId: hive.id, newSectionName: 'B' }, []);
    const other = await importInto({ hiveId: black.id, newSectionName: 'X' }, []);
    const [first, second] = await chaptersOf(hive.id);
    await db.chapters.where('id').equals(first.id).modify((c) => { c.lineNames = { x: 'Mine' }; });
    await moveComb(first.id, hive.id, b.sectionId);
    await moveComb(second.id, black.id, other.sectionId);
    const changed = STUDY_PGN.replace('(4. d3 { Quieter. })', '(4. d3 { Quieter. } 4... d6)');
    const r = await importInto({ hiveId: hive.id, sync: { removeScope: [{ studyId: 'AbCdEfGh' }] } }, parseChapters(changed));
    expect(r.added).toHaveLength(0);
    const all = await db.chapters.toArray();
    expect(all).toHaveLength(2);
    const f = all.find((c) => c.id === first.id)!;
    expect(f.sectionId).toBe(b.sectionId);
    expect(f.lineNames).toEqual({ x: 'Mine' });
    expect(JSON.stringify(f.root)).toContain('"d6"');
    const s2 = all.find((c) => c.id === second.id)!;
    expect([s2.courseId, s2.sectionId, s2.orientation]).toEqual([black.id, other.sectionId, 'black']);
  });
});
