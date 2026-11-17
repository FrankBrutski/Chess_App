import { db, newId, chaptersOf } from './db';
import type { Chapter, Course } from './model';
import { toChapter, type ParsedChapter } from './pgn';
import { checkChapter } from './checker';
import { getAutoLink } from './prefs';

export interface SyncPlan {
  added: ParsedChapter[];
  updated: { parsed: ParsedChapter; existing: Chapter }[];
  removed: Chapter[];
}

export interface SyncResult extends SyncPlan {
  /** Issues from the previous import that are gone now. */
  fixed: number;
  /** Issues present now. */
  open: number;
}

const build = (p: ParsedChapter, courseId: string, order: number, id: string) =>
  toChapter(p, courseId, order, id, checkChapter(p, { auto: getAutoLink() }));

const norm = (s: string) => s.trim().toLowerCase();

/** Work out which chapters of an existing course each imported chapter replaces. */
export function planSync(existing: Chapter[], incoming: ParsedChapter[]): SyncPlan {
  const used = new Set<string>();
  const updated: SyncPlan['updated'] = [];
  const added: ParsedChapter[] = [];
  for (const p of incoming) {
    const match =
      (p.lichessChapterId && existing.find((e) => !used.has(e.id) && e.lichessChapterId === p.lichessChapterId)) ||
      existing.find((e) => !used.has(e.id) && norm(e.title) === norm(p.title));
    if (match) {
      used.add(match.id);
      updated.push({ parsed: p, existing: match });
    } else added.push(p);
  }
  return { added, updated, removed: existing.filter((e) => !used.has(e.id)) };
}

export async function createCourse(name: string, chapters: ParsedChapter[], sourceUrl?: string): Promise<string> {
  const now = Date.now();
  const course: Course = {
    id: newId(),
    name,
    sourceUrl,
    lichessStudyId: chapters.find((c) => c.lichessStudyId)?.lichessStudyId,
    createdAt: now,
    updatedAt: now,
  };
  await db.transaction('rw', db.courses, db.chapters, async () => {
    await db.courses.add(course);
    await db.chapters.bulkAdd(chapters.map((p, i) => build(p, course.id, i, newId())));
  });
  return course.id;
}

/**
 * Replace a course's chapters with a new import. Matched chapters keep their id,
 * so anything tied to them (training progress, from phase 2) survives.
 */
export async function applySync(courseId: string, incoming: ParsedChapter[], sourceUrl?: string): Promise<SyncResult> {
  const existing = await chaptersOf(courseId);
  const plan = planSync(existing, incoming);
  const idFor = new Map(plan.updated.map((u) => [u.parsed, u.existing.id]));
  const built = incoming.map((p, i) => build(p, courseId, i, idFor.get(p) ?? newId()));
  const before = new Set(plan.updated.flatMap((u) => (u.existing.issues ?? []).map((x) => `${u.existing.id}|${x.key}`)));
  const after = new Set(built.flatMap((c) => (c.issues ?? []).map((x) => `${c.id}|${x.key}`)));
  const fixed = [...before].filter((k) => !after.has(k)).length;
  await db.transaction('rw', db.courses, db.chapters, async () => {
    await db.chapters.bulkDelete(plan.removed.map((r) => r.id));
    await db.chapters.bulkPut(built);
    await db.courses.update(courseId, { updatedAt: Date.now(), ...(sourceUrl ? { sourceUrl } : {}) });
  });
  return { ...plan, fixed, open: after.size };
}
