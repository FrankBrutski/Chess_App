import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { parseChapters } from '../pgn';
import { STUDY_PGN } from './fixture';

describe('database upgrade from phase 1', () => {
  it('turns existing courses into hives with one section, keeping every comb', async () => {
    // Write data the way phase 1 stored it.
    const old = new Dexie('chess-app');
    old.version(1).stores({ courses: 'id, name, updatedAt', chapters: 'id, courseId, [courseId+order]' });
    const parsed = parseChapters(STUDY_PGN);
    await old.table('courses').put({ id: 'c1', name: 'Italian', sourceUrl: 'https://lichess.org/study/AbCdEfGh', createdAt: 1, updatedAt: 1 });
    await old.table('chapters').bulkPut(
      parsed.map((p, i) => ({ id: `ch${i}`, courseId: 'c1', order: i, title: p.title, orientation: 'black', root: p.root, importedAt: 1 })),
    );
    old.close();

    const { db, chaptersOf } = await import('../db');
    const hive = (await db.courses.get('c1'))!;
    expect(hive).toMatchObject({ name: 'Italian', color: 'black', tier: 1, order: 0 });
    expect(hive.sections).toHaveLength(1);
    expect(hive.sections[0]).toMatchObject({ name: 'Italian', sourceUrl: 'https://lichess.org/study/AbCdEfGh' });
    const combs = await chaptersOf('c1');
    expect(combs.map((c) => [c.id, c.sectionId])).toEqual([
      ['ch0', hive.sections[0].id],
      ['ch1', hive.sections[0].id],
    ]);
  });
});
