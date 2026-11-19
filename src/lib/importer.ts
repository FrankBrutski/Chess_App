import { db, newId, chaptersOfSection } from './db';
import type { Chapter, Course, Section, StudySource } from './model';
import { toChapter, type ParsedChapter } from './pgn';
import { checkChapter } from './checker';
import { getAutoLink } from './prefs';
import { addSource } from './hives';

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

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Work out which existing combs each imported chapter replaces. Matching is by Lichess chapter id; a title only
 * matches when one side has no chapter id (a plain PGN). `elsewhere` (when syncing) is every comb outside the hive:
 * a chapter you moved to another hive is found there by its chapter id and updated where it now lives.
 *
 * `removeMissing` lists the studies being synced: a comb of one of those studies that is not in the import is
 * removed. Combs from other studies, and from plain PGN files, are never removed.
 */
export function planSync(existing: Chapter[], incoming: ParsedChapter[], removeMissing: RemoveScope | false = false, elsewhere: Chapter[] = []): SyncPlan {
  const used = new Set<string>();
  const updated: SyncPlan['updated'] = [];
  const added: ParsedChapter[] = [];
  for (const p of incoming) {
    const match =
      (p.lichessChapterId && existing.find((e) => !used.has(e.id) && e.lichessChapterId === p.lichessChapterId)) ||
      existing.find((e) => !used.has(e.id) && (!p.lichessChapterId || !e.lichessChapterId) && norm(e.title) === norm(p.title));
    const moved = !match && p.lichessChapterId ? elsewhere.find((e) => !used.has(e.id) && e.lichessChapterId === p.lichessChapterId) : undefined;
    const found = match || moved;
    if (found) {
      used.add(found.id);
      updated.push({ parsed: p, existing: found });
    } else added.push(p);
  }
  const removable = (e: Chapter) => !!removeMissing && !!e.lichessStudyId && removeMissing.some(
    (s) => s.studyId === e.lichessStudyId && (!s.chapterId || s.chapterId === e.lichessChapterId),
  );
  return { added, updated, removed: existing.filter((e) => !used.has(e.id) && removable(e)) };
}

/** Which studies (or single chapters) a sync covers; see planSync. */
export type RemoveScope = StudySource[];

/** The studies a set of imported chapters came from (for a re-upload of a Lichess PGN file). */
export const studiesIn = (incoming: ParsedChapter[]): StudySource[] =>
  [...new Set(incoming.map((p) => p.lichessStudyId).filter((x): x is string => !!x))].map((studyId) => ({ studyId }));

export interface NewHive {
  name: string;
  color: 'white' | 'black';
  tier: number;
}

export async function createHive(h: NewHive): Promise<Course> {
  const now = Date.now();
  const sameGroup = await db.courses.filter((c) => c.color === h.color && c.tier === h.tier).count();
  const hive: Course = {
    id: newId(),
    name: h.name.trim() || 'New hive',
    color: h.color,
    tier: h.tier,
    order: sameGroup,
    sections: [],
    createdAt: now,
    updatedAt: now,
  };
  await db.courses.add(hive);
  return hive;
}

export interface ImportTarget {
  hiveId: string;
  /** Where new combs go: an existing section, a new one with newSectionName, or '' / undefined = Unsectioned. */
  sectionId?: string;
  newSectionName?: string;
  /** Lichess link this import came from; saved on the hive so Sync can fetch it again. */
  source?: StudySource;
  /**
   * Sync the whole hive: chapters of `removeScope` that are gone from the import are removed, new
   * chapters land in Unsectioned with a NEW tag, and combs you moved to another hive are updated there.
   * Without it, an import only adds and updates, never removes.
   */
  sync?: { removeScope: RemoveScope };
}

/**
 * Import chapters into a hive. Matched combs keep their id, section and position (so training progress,
 * names, line order and skipped lines survive) and every new comb plays from the hive's colour.
 */
export async function importInto(target: ImportTarget, incoming: ParsedChapter[]): Promise<SyncResult & { sectionId: string }> {
  const hive = await db.courses.get(target.hiveId);
  if (!hive) throw new Error('That hive no longer exists.');
  const sections = [...hive.sections];
  let sectionId = target.sectionId && sections.some((s) => s.id === target.sectionId) ? target.sectionId : '';
  if (!target.sync && target.newSectionName?.trim()) {
    const section: Section = { id: newId(), name: target.newSectionName.trim() };
    sections.push(section);
    sectionId = section.id;
  }
  if (target.sync) sectionId = '';
  const sources = target.source ? addSource(hive.sources, target.source) : hive.sources;

  const existing = await db.chapters.where('courseId').equals(hive.id).toArray();
  const elsewhere = target.sync ? await combsOutsideHive(hive.id) : [];
  const plan = planSync(existing, incoming, target.sync?.removeScope ?? false, elsewhere);
  const auto = getAutoLink();
  let next = existing.filter((c) => (c.sectionId ?? '') === sectionId).reduce((m, c) => Math.max(m, c.order + 1), 0);
  const keepFor = new Map(plan.updated.map((u) => [u.parsed, u.existing]));
  const built = incoming.map((p) => {
    const old = keepFor.get(p);
    // A comb you already have is updated in place: same hive, section, position and colour.
    const chapter = toChapter(
      p,
      old?.courseId ?? hive.id,
      old ? old.sectionId ?? '' : sectionId,
      old ? old.order : next++,
      old?.id ?? newId(),
      checkChapter(p, { auto }),
      old?.orientation ?? hive.color,
    );
    if (!p.lichessStudyId && old?.lichessStudyId) chapter.lichessStudyId = old.lichessStudyId;
    // Your line names and drill choices are tied to stable line ids, so they carry over to the new version.
    Object.assign(chapter, keepSettings(old));
    if (!old && target.sync) chapter.fresh = true;
    return chapter;
  });
  const before = new Set(plan.updated.flatMap((u) => (u.existing.issues ?? []).map((x) => `${u.existing.id}|${x.key}`)));
  const after = new Set(built.flatMap((c) => (c.issues ?? []).map((x) => `${c.id}|${x.key}`)));
  const fixed = [...before].filter((k) => !after.has(k)).length;
  await db.transaction('rw', db.courses, db.chapters, async () => {
    await db.chapters.bulkDelete(plan.removed.map((r) => r.id));
    await db.chapters.bulkPut(built);
    await db.courses.update(hive.id, { sections, ...(sources?.length ? { sources } : {}), updatedAt: Date.now() });
  });
  return { ...plan, fixed, open: after.size, sectionId };
}

/** Combs from Lichess in other hives (to find ones you moved elsewhere). */
export const combsOutsideHive = (hiveId: string) =>
  db.chapters.filter((c) => c.courseId !== hiveId && !!c.lichessChapterId).toArray();

function keepSettings(old: Chapter | undefined): Partial<Chapter> {
  if (!old) return {};
  const out: Partial<Chapter> = {};
  if (old.lineNames) out.lineNames = old.lineNames;
  if (old.lineOrder) out.lineOrder = old.lineOrder;
  if (old.skipLines?.length) out.skipLines = old.skipLines;
  if (old.skip) out.skip = true;
  if (old.fresh) out.fresh = true;
  return out;
}

/** Move a comb to another section ('' = Unsectioned) or hive. Its id is kept, so its progress comes with it. */
export async function moveComb(chapterId: string, hiveId: string, sectionId: string) {
  const hive = await db.courses.get(hiveId);
  if (!hive || (sectionId && !hive.sections.some((s) => s.id === sectionId))) throw new Error('That section no longer exists.');
  const order = (await chaptersOfSection(hiveId, sectionId)).reduce((m, c) => Math.max(m, c.order + 1), 0);
  await db.chapters
    .where('id')
    .equals(chapterId)
    .modify((c) => {
      c.courseId = hiveId;
      c.sectionId = sectionId;
      c.order = order;
      c.orientation = hive.color;
      if (sectionId) delete c.fresh;
    });
}

/**
 * Make a section hold exactly these combs of its hive (+ Section, or Choose combs). Combs keep their order
 * within the section and new ones are added in reading order; combs taken out go to Unsectioned. With no
 * sectionId, a new section is created at the end. Returns the section id.
 */
export async function setSectionCombs(hiveId: string, sectionId: string | undefined, name: string, combIds: string[]): Promise<string> {
  return db.transaction('rw', db.courses, db.chapters, async () => {
    const hive = await db.courses.get(hiveId);
    if (!hive) throw new Error('That hive no longer exists.');
    let id = sectionId;
    let sections = hive.sections;
    const clean = name.trim() || 'New section';
    if (!id || !sections.some((s) => s.id === id)) {
      id = newId();
      sections = [...sections, { id, name: clean }];
    } else sections = sections.map((s) => (s.id === id ? { ...s, name: clean } : s));
    const rank = new Map(sections.map((s, i) => [s.id, i]));
    const all = (await db.chapters.where('courseId').equals(hiveId).toArray()).sort(
      (a, b) => (rank.get(a.sectionId) ?? -1) - (rank.get(b.sectionId) ?? -1) || a.order - b.order,
    );
    const want = new Set(combIds);
    const inside = all.filter((c) => c.sectionId === id && want.has(c.id));
    const joining = all.filter((c) => c.sectionId !== id && want.has(c.id));
    const leaving = all.filter((c) => c.sectionId === id && !want.has(c.id));
    let loose = all.filter((c) => !c.sectionId || !rank.has(c.sectionId)).reduce((m, c) => Math.max(m, c.order + 1), 0);
    const changes: Chapter[] = [];
    [...inside, ...joining].forEach((c, i) => {
      const { fresh: _f, ...rest } = c;
      changes.push({ ...rest, sectionId: id!, order: i });
    });
    for (const c of leaving) changes.push({ ...c, sectionId: '', order: loose++ });
    await db.chapters.bulkPut(changes);
    await db.courses.update(hiveId, { sections, updatedAt: Date.now() });
    return id;
  });
}

/** Delete a section but keep its combs: they move to Unsectioned with their progress and settings. */
export async function deleteSection(hiveId: string, sectionId: string) {
  await db.transaction('rw', db.courses, db.chapters, async () => {
    const hive = await db.courses.get(hiveId);
    if (!hive) return;
    const all = await db.chapters.where('courseId').equals(hiveId).toArray();
    const valid = new Set(hive.sections.filter((s) => s.id !== sectionId).map((s) => s.id));
    let loose = all.filter((c) => !c.sectionId || (!valid.has(c.sectionId) && c.sectionId !== sectionId)).reduce((m, c) => Math.max(m, c.order + 1), 0);
    const moving = all.filter((c) => c.sectionId === sectionId).sort((a, b) => a.order - b.order);
    await db.chapters.bulkPut(moving.map((c) => ({ ...c, sectionId: '', order: loose++ })));
    await db.courses.update(hiveId, { sections: hive.sections.filter((s) => s.id !== sectionId), updatedAt: Date.now() });
  });
}
