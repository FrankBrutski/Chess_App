import type { Chapter, Course, Section, StudySource } from './model';

export const TIER_NAMES = ['Main', 'Secondary', 'Tertiary'];
export const tierName = (t: number) => TIER_NAMES[t - 1] ?? `Tier ${t}`;
export const TIER_CHOICES = [1, 2, 3, 4, 5];

export const LICHESS_STUDY_URL = /^https:\/\/lichess\.org\/study\/[A-Za-z0-9]{8}$/;

/**
 * Sections are optional. Combs in no section are a plain list at the top of the hive (no header); this
 * name is only used where a choice needs a label (Move…, the section pickers, Train).
 */
export const UNSECTIONED = 'No section';
/** Training scope value for a hive's Unsectioned combs (a real section id is never this). */
export const UNSECTIONED_SCOPE = '~unsectioned';

/** Is this comb in the given training-scope section? (UNSECTIONED_SCOPE = not in any section of its hive.) */
export function inSection(c: Chapter, section: string, hive?: Course): boolean {
  if (section !== UNSECTIONED_SCOPE) return c.sectionId === section;
  return !c.sectionId || !hive?.sections.some((s) => s.id === c.sectionId);
}

const STUDY_ID = /^[A-Za-z0-9]{8}$/;

/** Add a study link to a hive's sources (once). A whole-study link replaces single-chapter links of that study. */
export function addSource(sources: StudySource[] | undefined, src: StudySource): StudySource[] {
  const list = [...(sources ?? [])];
  if (!STUDY_ID.test(src.studyId) || (src.chapterId && !STUDY_ID.test(src.chapterId))) return list;
  if (list.some((s) => s.studyId === src.studyId && (!s.chapterId || s.chapterId === src.chapterId))) return list;
  const kept = src.chapterId ? list : list.filter((s) => s.studyId !== src.studyId);
  return [...kept, src.chapterId ? { studyId: src.studyId, chapterId: src.chapterId } : { studyId: src.studyId }];
}

/**
 * Bring a hive (and its combs) up to date. Pure and safe to run more than once, so it is used both by the
 * database upgrade and when restoring old backup files.
 * - Before tiers, a course was one study with no sections: it gets one section holding its combs.
 * - Study links used to live on sections; they move to the hive (sync is for the whole hive), and each comb
 *   remembers its study so a sync only removes chapters of that study.
 * - A comb whose section is gone is Unsectioned ('').
 */
export function migrateHive(course: Partial<Course> & { id: string; name: string }, chapters: Chapter[], index: number, newId: () => string) {
  const c = course as Course;
  const mine = chapters.filter((ch) => ch.courseId === c.id);
  if (!c.color) c.color = mine[0]?.orientation ?? 'white';
  if (!c.tier) c.tier = 1;
  if (c.order === undefined) c.order = index;
  let sources = Array.isArray(c.sources) ? c.sources.filter((s) => s && STUDY_ID.test(s.studyId) && (!s.chapterId || STUDY_ID.test(s.chapterId))) : [];
  const studyOf = (url?: string, id?: string) => (url && LICHESS_STUDY_URL.test(url) ? url.slice(-8) : id && STUDY_ID.test(id) ? id : undefined);
  if (!Array.isArray(c.sections)) {
    // Very old course: one study, no sections.
    const section: Section = { id: newId(), name: c.name };
    c.sections = [section];
    for (const ch of mine) ch.sectionId = section.id;
  }
  const legacy = studyOf(c.sourceUrl, c.lichessStudyId);
  if (legacy) {
    sources = addSource(sources, { studyId: legacy });
    for (const ch of mine) if (!ch.lichessStudyId && ch.lichessChapterId) ch.lichessStudyId = legacy;
  }
  delete c.sourceUrl;
  delete c.lichessStudyId;
  c.sections = c.sections.map((s) => {
    const study = studyOf(s.sourceUrl, s.lichessStudyId);
    if (study) {
      sources = addSource(sources, { studyId: study });
      for (const ch of mine) if (ch.sectionId === s.id && !ch.lichessStudyId && ch.lichessChapterId) ch.lichessStudyId = study;
    }
    const { sourceUrl: _u, lichessStudyId: _l, ...rest } = s;
    return rest;
  });
  if (sources.length) c.sources = sources;
  else delete c.sources;
  const valid = new Set(c.sections.map((s) => s.id));
  for (const ch of mine) if (!ch.sectionId || !valid.has(ch.sectionId)) ch.sectionId = '';
  return c;
}

/** Hives grouped for the library: by colour, then tier, then manual order. */
export function groupHives(hives: Course[]) {
  const groups: { color: 'white' | 'black'; tiers: { tier: number; hives: Course[] }[] }[] = [];
  for (const color of ['white', 'black'] as const) {
    const mine = hives.filter((h) => h.color === color);
    const tiers = [...new Set(mine.map((h) => h.tier))].sort((a, b) => a - b);
    if (tiers.length) {
      groups.push({
        color,
        tiers: tiers.map((tier) => ({ tier, hives: mine.filter((h) => h.tier === tier).sort((a, b) => a.order - b.order) })),
      });
    }
  }
  return groups;
}

/** Swap an item with its neighbour; returns the new order of ids (or null at an edge). */
export function moveInList<T>(items: T[], index: number, dir: -1 | 1): T[] | null {
  const j = index + dir;
  if (j < 0 || j >= items.length) return null;
  const out = [...items];
  [out[index], out[j]] = [out[j], out[index]];
  return out;
}
