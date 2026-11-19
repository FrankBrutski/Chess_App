import Dexie, { type Table } from 'dexie';
import type { Chapter, Course, Section, Shot, Sting } from './model';
import type { Cell } from './srs';
import { migrateHive, LICHESS_STUDY_URL } from './hives';
import { isZip, makeZip, readZip } from './zip';

class ChessDb extends Dexie {
  courses!: Table<Course, string>;
  chapters!: Table<Chapter, string>;
  /** Training progress per move you play (see lib/srs.ts). */
  cells!: Table<Cell, string>;
  /** Honey earned per day ("2026-11-17"). */
  honey!: Table<HoneyDay, string>;
  /** Tactics cards and their screenshots (images live in their own table so lists load fast). */
  stings!: Table<Sting, string>;
  shots!: Table<Shot, string>;
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
    // v3: the opening trainer.
    this.version(3).stores({
      courses: 'id, name, updatedAt',
      chapters: 'id, courseId, sectionId, [courseId+order]',
      cells: 'key, due',
      honey: 'day',
    });
    // v4: tactics (Stings).
    this.version(4).stores({
      stings: 'id, status, createdAt',
      shots: 'id',
    });
    // v5: study links move from sections to the hive (one Sync per hive); combs can be Unsectioned.
    this.version(5)
      .stores({})
      .upgrade(async (tx) => {
        const chapters = (await tx.table('chapters').toArray()) as Chapter[];
        const courses = (await tx.table('courses').toArray()) as Course[];
        courses.forEach((c, i) => migrateHive(c, chapters, c.order ?? i, newId));
        await tx.table('courses').bulkPut(courses);
        await tx.table('chapters').bulkPut(chapters);
      });
  }
}

export interface HoneyDay {
  day: string;
  amount: number;
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
  // Combs in no section come first (shown as a plain list at the top), then each section in order.
  return list.sort((a, b) => (rank.get(a.sectionId) ?? -1) - (rank.get(b.sectionId) ?? -1) || a.order - b.order);
}

/** Combs of one section of a hive ('' = the hive's Unsectioned combs), in order. */
export async function chaptersOfSection(courseId: string, sectionId: string): Promise<Chapter[]> {
  const list = await db.chapters.where('courseId').equals(courseId).filter((c) => (c.sectionId ?? '') === sectionId).toArray();
  return list.sort((a, b) => a.order - b.order);
}

export const today = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export async function addHoney(amount: number) {
  if (amount <= 0) return;
  const day = today();
  await db.transaction('rw', db.honey, async () => {
    const cur = await db.honey.get(day);
    await db.honey.put({ day, amount: (cur?.amount ?? 0) + amount });
  });
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
  version: 1 | 2 | 3 | 4;
  exportedAt: string;
  courses: Course[];
  chapters: Chapter[];
  /** Training progress (version 3+). */
  cells?: Cell[];
  honey?: HoneyDay[];
  /** Tactics cards (version 4+). Their images are separate files in the zip. */
  stings?: Sting[];
  shots?: { id: string; file: string; width: number; height: number }[];
}

export async function exportBackup(): Promise<Backup> {
  return {
    app: 'chess-app',
    version: 4,
    exportedAt: new Date().toISOString(),
    courses: await db.courses.toArray(),
    chapters: await db.chapters.toArray(),
    cells: await db.cells.toArray(),
    honey: await db.honey.toArray(),
    stings: await db.stings.toArray(),
  };
}

/** The whole app as one .zip: backup.json plus every screenshot as its own JPEG. */
export async function exportBackupZip(): Promise<{ bytes: Uint8Array; name: string; stings: number }> {
  const data = await exportBackup();
  const shots = await db.shots.toArray();
  data.shots = shots.map((s) => ({ id: s.id, file: `shots/${s.id}.jpg`, width: s.width, height: s.height }));
  const entries = [{ name: 'backup.json', data: new TextEncoder().encode(JSON.stringify(data)) }];
  for (const s of shots) entries.push({ name: `shots/${s.id}.jpg`, data: new Uint8Array(await s.blob.arrayBuffer()) });
  return { bytes: makeZip(entries), name: `apiary-backup-${data.exportedAt.slice(0, 10)}.zip`, stings: data.stings?.length ?? 0 };
}

/** Restore a backup file: the .zip (with screenshots) or an older .json. */
export async function importBackupFile(bytes: Uint8Array): Promise<{ hives: number; stings: number }> {
  if (!isZip(bytes)) {
    const hives = await importBackup(JSON.parse(new TextDecoder().decode(bytes)));
    return { hives, stings: 0 };
  }
  const files = new Map(readZip(bytes).map((e) => [e.name, e.data]));
  const json = files.get('backup.json');
  if (!json) throw new Error('This zip is not an Apiary backup.');
  const b = JSON.parse(new TextDecoder().decode(json)) as Backup;
  const hives = await importBackup(b);
  const STATUSES = ['inbox', 'progress', 'ready'];
  const stings = (Array.isArray(b.stings) ? b.stings : []).filter(
    (s) => s && typeof s.id === 'string' && STATUSES.includes(s.status) && Number.isFinite(s.createdAt),
  );
  const shots: Shot[] = [];
  for (const m of Array.isArray(b.shots) ? b.shots : []) {
    const data = m && typeof m.id === 'string' && typeof m.file === 'string' ? files.get(m.file) : undefined;
    if (data) shots.push({ id: m.id, blob: new Blob([data], { type: 'image/jpeg' }), width: +m.width || 0, height: +m.height || 0 });
  }
  const have = new Set(shots.map((s) => s.id));
  for (const s of stings) if (s.shotId && !have.has(s.shotId)) delete s.shotId;
  await db.transaction('rw', db.stings, db.shots, async () => {
    await db.shots.bulkPut(shots);
    await db.stings.bulkPut(stings);
  });
  return { hives, stings: stings.length };
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
  const cells = (Array.isArray(b.cells) ? b.cells : []).filter(
    (c) => c && typeof c.key === 'string' && Number.isFinite(c.level) && Number.isFinite(c.due),
  );
  const honey = (Array.isArray(b.honey) ? b.honey : []).filter((h) => h && typeof h.day === 'string' && Number.isFinite(h.amount));
  await db.transaction('rw', [db.courses, db.chapters, db.cells, db.honey], async () => {
    for (const c of b.courses) await db.chapters.where('courseId').equals(c.id).delete();
    await db.courses.bulkPut(b.courses);
    await db.chapters.bulkPut(b.chapters);
    // Progress in the backup wins for the moves it covers; other progress on this phone is kept.
    await db.cells.bulkPut(cells);
    await db.honey.bulkPut(honey);
  });
  return b.courses.length;
}
