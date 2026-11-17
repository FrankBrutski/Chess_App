import Dexie, { type Table } from 'dexie';
import type { Chapter, Course, Section } from './model';
import { migrateHive, LICHESS_STUDY_URL } from './hives';

class ChessDb extends Dexie {
  courses!: Table<Course, string>;
  chapters!: Table<Chapter, string>;
  constructor() {
    super('chess-app');
    this.version(1).stores({
      courses: 'id, name, updatedAt',
      chapters: 'id, courseId, [courseId+order]',
    });
    // v2: hives get a colour, tier and sections; combs belong to a section.
    this.version(2)
      .stores({
        courses: 'id, name, updatedAt',
        chapters: 'id, courseId, sectionId, [courseId+order]',
      })
      .upgrade(async (tx) => {
        const chapters = (await tx.table('chapters').toArray()) as Chapter[];
        const courses = (await tx.table('courses').toArray()) as Course[];
        courses.forEach((c, i) => migrateHive(c, chapters, i, newId));
        await tx.table('courses').bulkPut(courses);
        await tx.table('chapters').bulkPut(chapters);
      });
  }
}

export const db = new ChessDb();

export const newId = () =>
  (crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

/** Ask the browser not to evict our data (installed home-screen apps usually get this). */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

/** All combs of a hive in reading order: by section, then position within the section. */
export async function chaptersOf(courseId: string): Promise<Chapter[]> {
  const [hive, list] = await Promise.all([db.courses.get(courseId), db.chapters.where('courseId').equals(courseId).toArray()]);
  const rank = new Map((hive?.sections ?? []).map((s, i) => [s.id, i]));
  return list.sort((a, b) => (rank.get(a.sectionId) ?? 999) - (rank.get(b.sectionId) ?? 999) || a.order - b.order);
}

export async function chaptersOfSection(sectionId: string): Promise<Chapter[]> {
  const list = await db.chapters.where('sectionId').equals(sectionId).toArray();
  return list.sort((a, b) => a.order - b.order);
}

export async function deleteCourse(courseId: string) {
  await db.transaction('rw', db.courses, db.chapters, async () => {
    await db.chapters.where('courseId').equals(courseId).delete();
    await db.courses.delete(courseId);
  });
}

// ---------- Backup ----------

export interface Backup {
  app: 'chess-app';
  version: 1 | 2;
  exportedAt: string;
  courses: Course[];
  chapters: Chapter[];
}

export async function exportBackup(): Promise<Backup> {
  return {
    app: 'chess-app',
    version: 2,
    exportedAt: new Date().toISOString(),
    courses: await db.courses.toArray(),
    chapters: await db.chapters.toArray(),
  };
}

/** Restores a backup, replacing any course with the same id. Returns the number of courses restored. */
export async function importBackup(data: unknown): Promise<number> {
  const b = data as Backup;
  if (!b || b.app !== 'chess-app' || !Array.isArray(b.courses) || !Array.isArray(b.chapters)) {
    throw new Error('This file is not a Chess App backup.');
  }
  for (const c of b.courses) {
    if (typeof c.id !== 'string' || typeof c.name !== 'string') throw new Error('This backup file is damaged.');
    // Only keep a study link that really points at lichess.org.
    if (c.sourceUrl !== undefined && !LICHESS_STUDY_URL.test(c.sourceUrl)) delete c.sourceUrl;
    for (const s of (c.sections ?? []) as Section[]) {
      if (s.sourceUrl !== undefined && !LICHESS_STUDY_URL.test(s.sourceUrl)) delete s.sourceUrl;
    }
  }
  for (const ch of b.chapters) {
    if (typeof ch.id !== 'string' || typeof ch.courseId !== 'string' || !ch.root) throw new Error('This backup file is damaged.');
  }
  // Backups made before hives had sections are upgraded on the way in.
  b.courses.forEach((c, i) => migrateHive(c, b.chapters, i, newId));
  await db.transaction('rw', db.courses, db.chapters, async () => {
    for (const c of b.courses) await db.chapters.where('courseId').equals(c.id).delete();
    await db.courses.bulkPut(b.courses);
    await db.chapters.bulkPut(b.chapters);
  });
  return b.courses.length;
}
