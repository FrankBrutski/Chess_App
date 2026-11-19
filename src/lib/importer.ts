import { db, newId, chaptersOfSection } from './db';
import type { Chapter, Course, Section } from './model';
import { toChapter, type ParsedChapter } from './pgn';
import { checkChapter } from './checker';
import { getAutoLink } from './prefs';
import { LICHESS_STUDY_URL } from './hives';

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
 * Work out which combs of a section each imported chapter replaces. `elsewhere` (when syncing) is every
 * comb outside the section: a chapter you moved to another section or hive is found there by its Lichess
 * chapter id and updated where it now lives, instead of coming back as a second copy.
 */
export function planSync(existing: Chapter[], incoming: ParsedChapter[], removeMissing = true, elsewhere: Chapter[] = []): SyncPlan {
  const used = new Set<string>();
  const updated: SyncPlan['updated'] = [];
  const added: ParsedChapter[] = [];
  for (const p of incoming) {
    const match =
      (p.lichessChapterId && existing.find((e) => !used.has(e.id) && e.lichessChapterId === p.lichessChapterId)) ||
      existing.find((e) => !used.has(e.id) && norm(e.title) === norm(p.title));
    const moved = !match && p.lichessChapterId ? elsewhere.find((e) => !used.has(e.id) && e.lichessChapterId === p.lichessChapterId) : undefined;
    const found = match || moved;
    if (found) {
      used.add(found.id);
      updated.push({ parsed: p, existing: found });
    } else added.push(p);
  }
  return { added, updated, removed: removeMissing ? existing.filter((e) => !used.has(e.id)) : [] };
}

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
  /** An existing section, or a new one with this name. */
  sectionId?: string;
  newSectionName?: string;
  /** Lichess study link, stored on the section so it can be synced later. */
  sourceUrl?: string;
  lichessStudyId?: string;
  /**
   * true = this is a sync/re-upload of the section: combs missing from the
   * import are removed. false = add to the section, never removing anything.
   */
  replace: boolean;
}

/**
 * Import chapters into a hive section. Matched combs keep their id (so training
 * progress tied to them survives) and every comb plays from the hive's colour.
 */
export async function importInto(target: ImportTarget, incoming: ParsedChapter[]): Promise<SyncResult & { sectionId: string }> {
  const hive = await db.courses.get(target.hiveId);
  if (!hive) throw new Error('That hive no longer exists.');
  let section = hive.sections.find((s) => s.id === target.sectionId);
  const sections = [...hive.sections];
  if (!section) {
    section = { id: newId(), name: target.newSectionName?.trim() || 'New section' };
    sections.push(section);
  }
  if (target.sourceUrl && LICHESS_STUDY_URL.test(target.sourceUrl)) {
    section = { ...section, sourceUrl: target.sourceUrl, lichessStudyId: target.lichessStudyId };
  }
  const finalSection: Section = section;
  const nextSections = sections.map((s) => (s.id === finalSection.id ? finalSection : s));

  const existing = await chaptersOfSection(finalSection.id);
  const elsewhere = target.replace ? await combsOutside(finalSection.id) : [];
  const plan = planSync(existing, incoming, target.replace, elsewhere);
  const idFor = new Map(plan.updated.map((u) => [u.parsed, u.existing.id]));
  const orderFor = new Map(plan.updated.map((u) => [u.parsed, u.existing.order]));
  const auto = getAutoLink();
  let next = existing.reduce((m, c) => Math.max(m, c.order + 1), 0);
  const keepFor = new Map(plan.updated.map((u) => [u.parsed, u.existing]));
  const built = incoming.map((p, i) => {
    const old = keepFor.get(p);
    // A comb you moved out of this section is updated in place: same hive, section, position and colour.
    const away = old && old.sectionId !== finalSection.id ? old : undefined;
    return {
      ...toChapter(
        p,
        away?.courseId ?? hive.id,
        away?.sectionId ?? finalSection.id,
        away ? away.order : target.replace ? i : orderFor.get(p) ?? next++,
        idFor.get(p) ?? newId(),
        checkChapter(p, { auto }),
        away?.orientation ?? hive.color,
      ),
      // Your line names and drill choices are tied to stable line ids, so they carry over to the new version.
      ...keepSettings(old),
    };
  });
  const before = new Set(plan.updated.flatMap((u) => (u.existing.issues ?? []).map((x) => `${u.existing.id}|${x.key}`)));
  const after = new Set(built.flatMap((c) => (c.issues ?? []).map((x) => `${c.id}|${x.key}`)));
  const fixed = [...before].filter((k) => !after.has(k)).length;
  await db.transaction('rw', db.courses, db.chapters, async () => {
    await db.chapters.bulkDelete(plan.removed.map((r) => r.id));
    await db.chapters.bulkPut(built);
    await db.courses.update(hive.id, { sections: nextSections, updatedAt: Date.now() });
  });
  return { ...plan, fixed, open: after.size, sectionId: finalSection.id };
}

/** Combs from Lichess that live outside this section (to find ones you moved elsewhere). */
export const combsOutside = (sectionId: string) =>
  db.chapters.filter((c) => c.sectionId !== sectionId && !!c.lichessChapterId).toArray();

function keepSettings(old: Chapter | undefined): Partial<Chapter> {
  if (!old) return {};
  const out: Partial<Chapter> = {};
  if (old.lineNames) out.lineNames = old.lineNames;
  if (old.lineOrder) out.lineOrder = old.lineOrder;
  if (old.skipLines?.length) out.skipLines = old.skipLines;
  if (old.skip) out.skip = true;
  return out;
}

/** Move a comb to another section or hive. Its id is kept, so its progress comes with it. */
export async function moveComb(chapterId: string, hiveId: string, sectionId: string) {
  const hive = await db.courses.get(hiveId);
  if (!hive || !hive.sections.some((s) => s.id === sectionId)) throw new Error('That section no longer exists.');
  const order = (await chaptersOfSection(sectionId)).reduce((m, c) => Math.max(m, c.order + 1), 0);
  await db.chapters
    .where('id')
    .equals(chapterId)
    .modify((c) => {
      c.courseId = hiveId;
      c.sectionId = sectionId;
      c.order = order;
      c.orientation = hive.color;
    });
}
