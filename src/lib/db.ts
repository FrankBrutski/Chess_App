import Dexie, { type Table } from 'dexie';
import type { Chapter, Course } from './model';

class ChessDb extends Dexie {
  courses!: Table<Course, string>;
  chapters!: Table<Chapter, string>;
  constructor() {
    super('chess-app');
    this.version(1).stores({
      courses: 'id, name, updatedAt',
      chapters: 'id, courseId, [courseId+order]',
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

export async function chaptersOf(courseId: string): Promise<Chapter[]> {
  return db.chapters.where('[courseId+order]').between([courseId, Dexie.minKey], [courseId, Dexie.maxKey]).toArray();
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
  version: 1;
  exportedAt: string;
  courses: Course[];
  chapters: Chapter[];
}

export async function exportBackup(): Promise<Backup> {
  return {
    app: 'chess-app',
    version: 1,
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
    if (c.sourceUrl !== undefined && !/^https:\/\/lichess\.org\/study\/[A-Za-z0-9]{8}$/.test(c.sourceUrl)) delete c.sourceUrl;
  }
  for (const ch of b.chapters) {
    if (typeof ch.id !== 'string' || typeof ch.courseId !== 'string' || !ch.root) throw new Error('This backup file is damaged.');
  }
  await db.transaction('rw', db.courses, db.chapters, async () => {
    for (const c of b.courses) await db.chapters.where('courseId').equals(c.id).delete();
    await db.courses.bulkPut(b.courses);
    await db.chapters.bulkPut(b.chapters);
  });
  return b.courses.length;
}
