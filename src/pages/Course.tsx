import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, chaptersOf, deleteCourse } from '../lib/db';
import { navigate } from '../router';
import { getLichessEnabled } from '../lib/prefs';
import { countMoves } from '../lib/tree';
import type { Chapter } from '../lib/model';

/** Only ever link out to lichess.org (a restored backup file could contain anything). */
const isLichessUrl = (u: string) => /^https:\/\/lichess\.org\//.test(u);

const chapterMoves = (c: Chapter) => c.root.children.reduce((n, m) => n + countMoves(m), 0);

export function CoursePage({ courseId }: { courseId: string }) {
  const course = useLiveQuery(() => db.courses.get(courseId), [courseId]);
  const chapters = useLiveQuery(() => chaptersOf(courseId), [courseId]);
  const [confirming, setConfirming] = useState(false);

  const issueCount = chapters?.reduce((n, c) => n + (c.issues?.length ?? 0), 0) ?? 0;

  if (course === undefined) return <div className="page"><p className="muted">Loading…</p></div>;
  if (course === null) return <div className="page"><p>Course not found.</p></div>;

  return (
    <div className="page">
      <header className="page-header">
        <button type="button" className="icon-btn" onClick={() => navigate('/')} aria-label="Back">‹</button>
        <h1>{course.name}</h1>
        <span />
      </header>
      <ol className="card-list chapters">
        {chapters?.map((c) => (
          <li key={c.id}>
            <button type="button" className="card" onClick={() => navigate(`/read/${c.id}`)}>
              <span className="card-title">{c.title}</span>
              <span className="card-sub">
                {chapterMoves(c)} moves · as {c.orientation}
                {c.issues?.length ? ` · ${c.issues.length} issue${c.issues.length === 1 ? '' : 's'}` : ''}
              </span>
            </button>
          </li>
        ))}
      </ol>
      <div className="stack">
        {issueCount > 0 && (
          <button type="button" className="wide issues-link" onClick={() => navigate(`/issues/${course.id}`)}>
            Import issues ({issueCount})
          </button>
        )}
        {course.sourceUrl && getLichessEnabled() && (
          <button type="button" className="primary wide" onClick={() => navigate(`/import/${course.id}`)}>
            Sync from Lichess or upload a new version
          </button>
        )}
        {!(course.sourceUrl && getLichessEnabled()) && (
          <button type="button" className="wide" onClick={() => navigate(`/import/${course.id}`)}>
            Upload a new version
          </button>
        )}
        {course.sourceUrl && isLichessUrl(course.sourceUrl) && (
          <a className="muted small" href={course.sourceUrl} target="_blank" rel="noreferrer">
            Open the study on Lichess
          </a>
        )}
        {!confirming ? (
          <button type="button" className="danger-link" onClick={() => setConfirming(true)}>Delete course</button>
        ) : (
          <div className="confirm">
            <span>Delete “{course.name}” from this device?</span>
            <button type="button" className="danger" onClick={async () => { await deleteCourse(course.id); navigate('/'); }}>
              Delete
            </button>
            <button type="button" onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        )}
      </div>
    </div>
  );
}
