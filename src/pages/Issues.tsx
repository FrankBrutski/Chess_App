import { useLiveQuery } from 'dexie-react-hooks';
import { db, chaptersOf } from '../lib/db';
import { navigate } from '../router';
import { IssueList } from '../components/IssueList';
import { checkChapter } from '../lib/checker';
import { getAutoLink, getLineOrder } from '../lib/prefs';
import type { Chapter, Issue } from '../lib/model';
import { lineThrough, splitLines, type SplitOptions } from '../lib/lines';

const lineOpts = (c: Chapter): SplitOptions => ({ names: c.lineNames, order: getLineOrder(), custom: c.lineOrder });

/**
 * Re-run the checks that only need the saved moves and notes, so the list has today's wording
 * and detail without a re-sync. Moves the import could not read are not saved, so those stay as stored.
 */
function freshIssues(c: Chapter): Issue[] {
  const kept = (c.issues ?? []).filter((i) => i.kind === 'unreadable-move' || i.kind === 'empty-chapter');
  try {
    const now = checkChapter({ title: c.title, orientation: c.orientation, root: c.root, unreadable: [] }, { auto: getAutoLink(), lines: lineOpts(c) });
    return [...kept, ...now.filter((i) => i.kind !== 'empty-chapter')];
  } catch {
    return c.issues ?? [];
  }
}

/** Open just the line the issue is on (the same line its "Line n" names), at the move. */
function lineLink(c: Chapter, nodeId?: string): string {
  const lines = splitLines(c.root, c.orientation, lineOpts(c));
  const line = nodeId && nodeId !== 'root' ? lineThrough(lines, nodeId) : lines[0];
  if (!line) return `/read/${c.id}/${nodeId ?? ''}`;
  return `/line/${c.id}/${encodeURIComponent(line.id)}${nodeId && nodeId !== 'root' ? `/${nodeId}` : ''}`;
}

export function IssuesPage({ courseId }: { courseId: string }) {
  const course = useLiveQuery(() => db.courses.get(courseId), [courseId]);
  const chapters = useLiveQuery(() => chaptersOf(courseId), [courseId]);
  const withIssues = (chapters ?? []).map((c) => ({ c, issues: freshIssues(c) })).filter((x) => x.issues.length);

  return (
    <div className="page">
      <header className="page-header">
        <button type="button" className="icon-btn" onClick={() => navigate(`/course/${courseId}`)} aria-label="Back">‹</button>
        <h1>Import issues</h1>
        <span />
      </header>
      <p className="muted small">
        {course?.name}. Fix these in Lichess, then sync or upload again; fixed issues drop off this list.
      </p>
      {chapters && withIssues.length === 0 && <p>No open issues.</p>}
      {withIssues.map(({ c, issues }) => (
        <section key={c.id} className="stack">
          <h2>{c.title}</h2>
          <IssueList issues={issues} onOpen={(i) => navigate(lineLink(c, i.nodeId))} />
        </section>
      ))}
    </div>
  );
}
