import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { navigate } from '../router';
import { HexMark } from '../components/HexMark';
import { loadTrainData } from '../lib/training';
import { userKeys } from '../lib/srs';
import { groupHives, moveInList, tierName } from '../lib/hives';
import type { Course } from '../lib/model';

export function Library() {
  const hives = useLiveQuery(() => db.courses.toArray(), []);
  const counts = useLiveQuery(async () => {
    const m = new Map<string, number>();
    await db.chapters.each((c) => m.set(c.courseId, (m.get(c.courseId) ?? 0) + 1));
    return m;
  }, []);
  const [reorder, setReorder] = useState(false);
  // Due moves in lines you drill (skipped lines, combs, sections and hives don't count).
  const due = useLiveQuery(async () => {
    const d = await loadTrainData({ hive: '', section: '', comb: '', mainHivesOnly: false, mainLinesOnly: false });
    const now = Date.now();
    return new Set(d.lines.flatMap(userKeys).filter((k) => (d.cells.get(k)?.due ?? Infinity) <= now)).size;
  }, []);

  const move = async (list: Course[], i: number, dir: -1 | 1) => {
    const next = moveInList(list, i, dir);
    if (!next) return;
    await db.transaction('rw', db.courses, async () => {
      for (const [k, h] of next.entries()) await db.courses.update(h.id, { order: k });
    });
  };

  const groups = groupHives(hives ?? []);

  return (
    <div className="page">
      <header className="page-header">
        <h1 className="brand"><HexMark /> Apiary</h1>
        {(hives?.length ?? 0) > 1 && (
          <button type="button" className="icon-btn small-text" onClick={() => setReorder(!reorder)}>{reorder ? 'Done' : 'Reorder'}</button>
        )}
        <button type="button" className="icon-btn" onClick={() => navigate('/settings')} aria-label="Settings">⚙</button>
      </header>
      {(hives?.length ?? 0) > 0 && (
        <button type="button" className="primary wide train-cta" onClick={() => navigate('/train')}>
          Train{due ? ` · ${due} due` : ''}
        </button>
      )}
      {hives?.length === 0 && (
        <div className="empty">
          <p>No hives yet.</p>
          <p className="muted">
            A hive is one repertoire, like your King's Gambit as White. Import a Lichess study by link, or upload a PGN.
          </p>
        </div>
      )}
      {groups.map((g) => (
        <section key={g.color} className="color-group">
          <h2 className="color-head">
            <span className={`color-dot ${g.color}`} aria-hidden="true" /> As {g.color === 'white' ? 'White' : 'Black'}
          </h2>
          {g.tiers.map((t) => (
            <div key={t.tier} className="tier-group">
              <h3 className="tier-head">{tierName(t.tier)}</h3>
              <ul className="card-list">
                {t.hives.map((h, i) => (
                  <li key={h.id} className="comb-row">
                    <button type="button" className="card" onClick={() => navigate(`/course/${h.id}`)}>
                      <span className="card-title"><HexMark small /> {h.name}</span>
                      <span className="card-sub">
                        {h.sections.length} section{h.sections.length === 1 ? '' : 's'} · {counts?.get(h.id) ?? 0} combs
                      </span>
                    </button>
                    {reorder && (
                      <div className="comb-tools">
                        <button type="button" onClick={() => move(t.hives, i, -1)} disabled={i === 0} aria-label="Move up">▲</button>
                        <button type="button" onClick={() => move(t.hives, i, 1)} disabled={i === t.hives.length - 1} aria-label="Move down">▼</button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
      <button type="button" className="wide" onClick={() => navigate('/import')}>
        Import a study
      </button>
    </div>
  );
}
