import type { Chapter, Course, Section } from './model';

export const TIER_NAMES = ['Main', 'Secondary', 'Tertiary'];
export const tierName = (t: number) => TIER_NAMES[t - 1] ?? `Tier ${t}`;
export const TIER_CHOICES = [1, 2, 3, 4, 5];

export const LICHESS_STUDY_URL = /^https:\/\/lichess\.org\/study\/[A-Za-z0-9]{8}$/;

/**
 * Bring a hive (and its combs) from an older format up to date: before tiers,
 * a course was one study with no sections. Pure, so it is used both by the
 * database upgrade and when restoring old backup files.
 */
export function migrateHive(course: Partial<Course> & { id: string; name: string }, chapters: Chapter[], index: number, newId: () => string) {
  const c = course as Course;
  const mine = chapters.filter((ch) => ch.courseId === c.id);
  if (!c.color) c.color = mine[0]?.orientation ?? 'white';
  if (!c.tier) c.tier = 1;
  if (c.order === undefined) c.order = index;
  if (!Array.isArray(c.sections) || c.sections.length === 0) {
    const section: Section = { id: newId(), name: c.name };
    if (c.sourceUrl && LICHESS_STUDY_URL.test(c.sourceUrl)) section.sourceUrl = c.sourceUrl;
    if (c.lichessStudyId) section.lichessStudyId = c.lichessStudyId;
    c.sections = [section];
  }
  delete c.sourceUrl;
  delete c.lichessStudyId;
  const valid = new Set(c.sections.map((s) => s.id));
  for (const ch of mine) {
    if (!ch.sectionId || !valid.has(ch.sectionId)) ch.sectionId = c.sections[0].id;
  }
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
