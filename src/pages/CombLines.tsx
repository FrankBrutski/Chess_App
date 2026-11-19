import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { navigate } from '../router';
import { moveNumber } from '../lib/tree';
import { getLineOrder } from '../lib/prefs';
import { splitLines, type Line } from '../lib/lines';
import { combSkipped } from '../lib/training';
import { lineState, userKeys, type Cell, type LineState, type TrainLine } from '../lib/srs';

/** A comb's lines, one wall-to-wall row each. Tapping a line opens it in the reader; backing out returns here. */
export function CombLines({ chapterId }: { chapterId: string }) {
  const chapter = useLiveQuery(() => db.chapters.get(chapterId), [chapterId]);
  const course = useLiveQuery(async () => (chapter ? db.courses.get(chapter.courseId) : undefined), [chapter?.courseId]);
  const cells = useLiveQuery(async () => new Map<string, Cell>((await db.cells.toArray()).map((c) => [c.key, c])), []);
  const lines = useMemo(
    () => (chapter ? splitLines(chapter.root, chapter.orientation, { names: chapter.lineNames, order: getLineOrder() }) : []),
    [chapter],
  );
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<string>();
  const [menu, setMenu] = useState<string>();

  if (chapter === undefined) return <div className="page"><p className="muted">Loading…</p></div>;
  if (chapter === null) return <div className="page"><p>Comb not found.</p></div>;

  const skipped = new Set(chapter.skipLines ?? []);
  const combOff = course ? combSkipped(chapter, [course]) : !!chapter.skip;
  const now = Date.now();
  const drill = (l: Line): TrainLine | undefined =>
    l.trainable && !skipped.has(l.id) && !combOff
      ? { chapterId: chapter.id, hiveId: chapter.courseId, combTitle: chapter.title, color: chapter.orientation, line: l }
      : undefined;
  const states = lines.map((l): LineState | undefined => { const t = drill(l); return t && cells ? lineState(t, cells, now) : undefined; });
  const drilled = states.filter((s) => s !== undefined).length;
  const learned = states.filter((s) => s && s !== 'new').length;
  const fresh = states.filter((s) => s === 'new').length;
  // Your moves due for review in this comb (a move shared by several lines counts once).
  const due = new Set(
    lines.flatMap((l) => { const t = drill(l); return t ? userKeys(t) : []; }).filter((k) => (cells?.get(k)?.due ?? Infinity) <= now),
  ).size;

  const needle = q.trim().toLowerCase().replace(/…/g, '...');
  const matches = (l: Line) => {
    if (!needle) return true;
    const moves = l.nodes.map((n) => `${moveNumber(n.ply)}${n.san}`).join(' ');
    const sans = l.nodes.map((n) => n.san).join(' ');
    return [l.name, l.label, `line ${l.number}`, moves, sans].some((t) => t.toLowerCase().replace(/…/g, '...').includes(needle));
  };

  const rename = (l: Line, name: string) =>
    db.chapters.where('id').equals(chapter.id).modify((c) => {
      const names = { ...(c.lineNames ?? {}) };
      if (name.trim() && name.trim() !== l.label) names[l.id] = name.trim();
      else delete names[l.id];
      c.lineNames = names;
    });
  const toggleDrill = (l: Line) =>
    db.chapters.where('id').equals(chapter.id).modify((c) => {
      const s = new Set(c.skipLines ?? []);
      if (s.has(l.id)) s.delete(l.id);
      else s.add(l.id);
      c.skipLines = [...s];
    });

  return (
    <div className="page">
      <header className="page-header">
        <button type="button" className="icon-btn" onClick={() => navigate(`/course/${chapter.courseId}`)} aria-label="Back to hive">‹</button>
        <div className="reader-title">
          {course?.name && <span className="reader-hive">{course.name}</span>}
          <h1 className="comb-heading">{chapter.title}</h1>
        </div>
        <span className="icon-btn" aria-hidden="true" />
      </header>
      <p className="muted small hive-sub">
        {lines.length} line{lines.length === 1 ? '' : 's'}
        {drilled ? ` · ${learned} of ${drilled} learned` : ' · not drilled'}
      </p>
      {drilled > 0 && (
        <div className="progress-bar" role="progressbar" aria-label="Lines learned" aria-valuemin={0} aria-valuemax={drilled} aria-valuenow={learned}>
          <i style={{ width: `${(learned / drilled) * 100}%` }} />
        </div>
      )}

      {drilled > 0 && (
        <div className="hive-actions comb-actions">
          {due > 0 ? (
            <button type="button" className="review-btn" onClick={() => navigate(`/train/comb/${chapter.id}/review`)}>Review ({due})</button>
          ) : <span />}
          <button type="button" className="learn-btn" disabled={!fresh} onClick={() => navigate(`/train/comb/${chapter.id}/learn`)}>
            {fresh ? 'Learn' : 'All learned'}
          </button>
        </div>
      )}

      {lines.length > 6 && (
        <input
          type="search"
          className="wide"
          placeholder="Find a line: name or moves (e.g. Nf6 Ng5)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Find a line"
        />
      )}

      <ol className="comb-lines line-rows" aria-label={`Lines in ${chapter.title}`}>
        {lines.filter(matches).map((l) => {
          const s = states[lines.indexOf(l)];
          return (
            <li key={l.id}>
              {editing === l.id ? (
                <form
                  className="line-edit"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void rename(l, String(new FormData(e.currentTarget).get('name') ?? ''));
                    setEditing(undefined);
                  }}
                >
                  <div className="row">
                    <input name="name" defaultValue={l.name} autoFocus aria-label={`Name for line ${l.number}`} />
                    <button type="submit">Save</button>
                  </div>
                  <p className="muted small">Leave it empty to use the moves. In Lichess you can also write [Line: name] in the comment on the move where the line branches.</p>
                </form>
              ) : (
                <div className="line-row-wrap">
                  <button type="button" className="comb-line" onClick={() => navigate(`/line/${chapter.id}/${encodeURIComponent(l.id)}`)}>
                    <span className={`line-dot${s ? ` dot-${s}` : ''}`} aria-hidden="true">{l.number}</span>
                    <span className="comb-line-text">
                      <span className="card-title">{l.name}</span>
                      <span className="card-sub">
                        {!l.trainable ? 'reading only' : skipped.has(l.id) ? 'not drilled' : s === 'learned' ? 'learned' : s === 'due' ? 'due for review' : s === 'new' ? 'not learned yet' : 'not drilled'}
                        {l.name !== l.label ? ` · ${l.label}` : ''}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="more-btn"
                    onClick={() => setMenu(menu === l.id ? undefined : l.id)}
                    aria-expanded={menu === l.id}
                    aria-label={`More for line ${l.number}`}
                  >
                    ⋯
                  </button>
                </div>
              )}
              {menu === l.id && editing !== l.id && (
                <div className="line-menu">
                  <button type="button" onClick={() => { setMenu(undefined); setEditing(l.id); }}>Rename</button>
                  {l.trainable && (
                    <button type="button" onClick={() => { setMenu(undefined); void toggleDrill(l); }}>
                      {skipped.has(l.id) ? 'Drill this line' : 'Skip this line'}
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
        {lines.filter(matches).length === 0 && <li className="muted small line-edit">No line matches.</li>}
      </ol>
    </div>
  );
}
