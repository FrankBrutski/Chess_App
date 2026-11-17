import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { navigate } from '../router';

export function Library() {
  const courses = useLiveQuery(() => db.courses.orderBy('updatedAt').reverse().toArray(), []);
  const counts = useLiveQuery(async () => {
    const m = new Map<string, number>();
    await db.chapters.each((c) => m.set(c.courseId, (m.get(c.courseId) ?? 0) + 1));
    return m;
  }, []);

  return (
    <div className="page">
      <header className="page-header">
        <h1>Repertoire</h1>
        <button type="button" className="icon-btn" onClick={() => navigate('/settings')} aria-label="Settings">⚙</button>
      </header>
      {courses?.length === 0 && (
        <div className="empty">
          <p>No courses yet.</p>
          <p className="muted">Import a Lichess study by link, or upload a PGN file you downloaded from Lichess.</p>
        </div>
      )}
      <ul className="card-list">
        {courses?.map((c) => (
          <li key={c.id}>
            <button type="button" className="card" onClick={() => navigate(`/course/${c.id}`)}>
              <span className="card-title">{c.name}</span>
              <span className="card-sub">
                {counts?.get(c.id) ?? 0} chapters{c.sourceUrl ? ' · linked to Lichess' : ''}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="primary wide" onClick={() => navigate('/import')}>
        Import a study
      </button>
    </div>
  );
}
