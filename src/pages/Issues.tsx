import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, chaptersOf } from '../lib/db';
import { navigate } from '../router';
import { IssueList } from '../components/IssueList';
import { checkChapter } from '../lib/checker';
import { getAutoLink, getLineOrder } from '../lib/prefs';
import type { Chapter, Issue } from '../lib/model';
import { lineThrough, splitLines, type Line, type SplitOptions } from '../lib/lines';
import { ISSUE_TYPES, issueType, type IssueType } from '../lib/issueTypes';

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
function lineFor(lines: Line[], nodeId?: string): Line | undefined {
  return nodeId && nodeId !== 'root' ? lineThrough(lines, nodeId) : lines[0];
}

function lineLink(c: Chapter, lines: Line[], nodeId?: string): string {
  const line = lineFor(lines, nodeId);
  if (!line) return `/read/${c.id}/${nodeId ?? ''}`;
  return `/line/${c.id}/${encodeURIComponent(line.id)}${nodeId && nodeId !== 'root' ? `/${nodeId}` : ''}`;
}

export function IssuesPage({ courseId }: { courseId: string }) {
  const course = useLiveQuery(() => db.courses.get(courseId), [courseId]);
  const chapters = useLiveQuery(() => chaptersOf(courseId), [courseId]);
  const [type, setType] = useState<IssueType | 'all'>('all');
  const withIssues = (chapters ?? [])
    .map((c) => ({ c, issues: freshIssues(c), lines: splitLines(c.root, c.orientation, lineOpts(c)) }))
    .filter((x) => x.issues.length);
  const all = withIssues.flatMap((x) => x.issues);
  const counts = new Map<IssueType, number>();
  for (const i of all) counts.set(issueType(i), (counts.get(issueType(i)) ?? 0) + 1);
  const shownType = type !== 'all' && counts.has(type) ? type : 'all';
  const chips = ISSUE_TYPES.filter((t) => counts.has(t.id));

  return (
    <div className="page">
      <header className="page-header">
        <button type="button" className="icon-btn" onClick={() => navigate(`/course/${courseId}`)} aria-label="Back">‹</button>
        <h1>Import issues</h1>
        <span />
      </header>
      {chips.length > 1 && (
        <div className="chips issue-filter" role="radiogroup" aria-label="Issue type">
          {[{ id: 'all' as const, label: 'All', n: all.length }, ...chips.map((t) => ({ ...t, n: counts.get(t.id)! }))].map((t) => (
            <button key={t.id} type="button" role="radio" aria-checked={shownType === t.id}
              className={`chip${shownType === t.id ? ' on' : ''}`} onClick={() => setType(t.id)}>
              {t.label}<span className="n">{t.n}</span>
            </button>
          ))}
        </div>
      )}
      <p className="muted small">
        {course?.name}. Fix these in Lichess, then sync or upload again; fixed issues drop off this list.
      </p>
      {chapters && withIssues.length === 0 && <p>No open issues.</p>}
      {withIssues.map(({ c, issues, lines }) => {
        const num = (i: Issue) => lineFor(lines, i.nodeId)?.number ?? 0;
        const shown = (shownType === 'all' ? issues : issues.filter((i) => issueType(i) === shownType)).sort((x, y) => num(x) - num(y));
        if (!shown.length) return null;
        return (
          <section key={c.id} className="stack">
            <h2>{c.title}</h2>
            <IssueList
              issues={shown}
              onOpen={(i) => navigate(lineLink(c, lines, i.nodeId))}
              lineOf={(i) => {
                const l = i.kind === 'empty-chapter' ? undefined : lineFor(lines, i.nodeId);
                return l && `Line ${l.number}${l.name !== 'Main line' || l.number !== 1 ? ` · ${l.name}` : ''}`;
              }}
            />
          </section>
        );
      })}
    </div>
  );
}
