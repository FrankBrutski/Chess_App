import { db } from './db';
import type { Chapter, Course } from './model';
import { splitLines } from './lines';
import { inSection } from './hives';
import type { Cell, TrainLine } from './srs';
import { getLineOrder, type TrainScope } from './prefs';

export interface TrainData {
  hives: Course[];
  chapters: Map<string, Chapter>;
  /** Drillable lines in scope, in study order (hive, section, comb, line). */
  lines: TrainLine[];
  cells: Map<string, Cell>;
}

/** Hives and combs the scope covers, in study order. */
export function inScope(hives: Course[], chapters: Chapter[], s: TrainScope): Chapter[] {
  const hiveOk = (h: Course) => {
    if (s.hive === 'white' || s.hive === 'black') return h.color === s.hive && (!s.mainHivesOnly || h.tier === 1);
    if (s.hive) return h.id === s.hive;
    return !s.mainHivesOnly || h.tier === 1;
  };
  const sorted = [...hives].sort((a, b) => (a.color === b.color ? 0 : a.color === 'white' ? -1 : 1) || a.tier - b.tier || a.order - b.order);
  const out: Chapter[] = [];
  for (const h of sorted) {
    if (!hiveOk(h)) continue;
    const rank = new Map(h.sections.map((x, i) => [x.id, i]));
    out.push(
      ...chapters
        .filter((c) => c.courseId === h.id && (!s.section || inSection(c, s.section, h)) && (!s.comb || c.id === s.comb))
        .sort((a, b) => (rank.get(a.sectionId) ?? -1) - (rank.get(b.sectionId) ?? -1) || a.order - b.order),
    );
  }
  return out;
}

/** Is this comb switched off for drilling (by itself, its section or its hive)? */
export function combSkipped(c: Chapter, hives: Map<string, Course> | Course[]): boolean {
  const h = Array.isArray(hives) ? hives.find((x) => x.id === c.courseId) : hives.get(c.courseId);
  return !!(c.skip || h?.skip || h?.sections.find((s) => s.id === c.sectionId)?.skip);
}

export function trainLinesOf(chapters: Chapter[], mainLinesOnly: boolean, hives: Course[] = []): TrainLine[] {
  return chapters.filter((c) => !combSkipped(c, hives)).flatMap((c) =>
    splitLines(c.root, c.orientation, { names: c.lineNames, order: getLineOrder(), custom: c.lineOrder })
      .filter((l) => l.trainable && !c.skipLines?.includes(l.id) && (!mainLinesOnly || l.id === 'main'))
      .map((line) => ({ chapterId: c.id, hiveId: c.courseId, combTitle: c.title, color: c.orientation, line })),
  );
}

export async function loadTrainData(scope: TrainScope): Promise<TrainData> {
  const [hives, all, cellList] = await Promise.all([db.courses.toArray(), db.chapters.toArray(), db.cells.toArray()]);
  const chosen = inScope(hives, all, scope);
  return {
    hives,
    chapters: new Map(chosen.map((c) => [c.id, c])),
    lines: trainLinesOf(chosen, scope.mainLinesOnly, hives),
    cells: new Map(cellList.map((c) => [c.key, c])),
  };
}
