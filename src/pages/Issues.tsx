import { useLiveQuery } from 'dexie-react-hooks';
import { db, chaptersOf } from '../lib/db';
import { navigate } from '../router';
import { IssueList } from '../components/IssueList';

export function IssuesPage({ courseId }: { courseId: string }) {
  const course = useLiveQuery(() => db.courses.get(courseId), [courseId]);
  const chapters = useLiveQuery(() => chaptersOf(courseId), [courseId]);
  const withIssues = chapters?.filter((c) => c.issues?.length) ?? [];

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
      {withIssues.map((c) => (
        <section key={c.id} className="stack">
          <h2>{c.title}</h2>
          <IssueList issues={c.issues!} onOpen={(i) => navigate(`/read/${c.id}/${i.nodeId}`)} />
        </section>
      ))}
    </div>
  );
}
