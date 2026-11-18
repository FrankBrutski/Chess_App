import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { navigate } from '../router';
import { HexMark } from '../components/HexMark';
import { loadTrainData } from '../lib/training';
import { lineState, userKeys } from '../lib/srs';
import { groupHives, moveInList, tierName } from '../lib/hives';
import type { Course } from '../lib/model';

export function Library() {
  const hives = useLiveQuery(() => db.courses.toArray(), []);
  const counts = useLiveQuery(async () => {
    // Read only the courseId index, not every comb's move tree.
    const m = new Map<string, number>();
    for (const id of (await db.chapters.orderBy('courseId').keys()) as string[]) m.set(id, (m.get(id) ?? 0) + 1);
    return m;
  }, []);
  const [reorder, setReorder] = useState(false);
  // Due moves in lines you drill (skipped lines, combs, sections and hives don't count).
  // Per hive: lines learned / drillable lines, and moves due.
  const stats = useLiveQuery(async () => {
    const d = await loadTrainData({ hive: '', section: '', comb: '', mainHivesOnly: false, mainLinesOnly: false });
    const now = Date.now();
    const isDue = (k: string) => (d.cells.get(k)?.due ?? Infinity) <= now;
    const per = new Map<string, { lines: number; learned: number; due: number; fresh: number }>();
    const dueKeys = new Map<string, Set<string>>();
    for (const t of d.lines) {
      const s = per.get(t.hiveId) ?? { lines: 0, learned: 0, due: 0, fresh: 0 };
      s.lines++;
      if (lineState(t, d.cells, now) === 'new') s.fresh++;
      else s.learned++;
      per.set(t.hiveId, s);
      const set = dueKeys.get(t.hiveId) ?? new Set<string>();
      for (const k of userKeys(t)) if (isDue(k)) set.add(k);
      dueKeys.set(t.hiveId, set);
    }
    for (const [id, set] of dueKeys) per.get(id)!.due = set.size;
    return { per, due: new Set(d.lines.flatMap(userKeys).filter(isDue)).size };
  }, []);
  const due = stats?.due;

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
        <button type="button" className="icon-btn" onClick={() => navigate('/')} aria-label="Home">‹</button>
        <h1 className="brand"><HexMark /> Openings</h1>
        {(hives?.length ?? 0) > 1 && (
          <button type="button" className="icon-btn small-text" onClick={() => setReorder(!reorder)}>{reorder ? 'Done' : 'Reorder'}</button>
        )}
        <button type="button" className="icon-btn small-text" onClick={() => navigate('/board')} aria-label="Master board" title="Master board: look up a position">Board</button>
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
                {t.hives.map((h, i) => {
                  const st = stats?.per.get(h.id);
                  const pct = st?.lines ? (st.learned / st.lines) * 100 : 0;
                  return (
                    <li key={h.id} className="hive-item">
                      <div className="hive-card">
                        <button type="button" className="hive-open" onClick={() => navigate(`/course/${h.id}`)}>
                          <span className="hive-name"><HexMark small /> {h.name}</span>
                          <span className="card-sub">
                            {counts?.get(h.id) ?? 0} comb{counts?.get(h.id) === 1 ? '' : 's'}{h.sections.length > 1 ? ` in ${h.sections.length} sections` : ''}{h.skip ? ' · not drilled' : ''}
                          </span>
                          <span className="hive-progress">
                            <span className="hive-count"><b>{st?.learned ?? 0}</b> / {st?.lines ?? 0} lines learned</span>
                            <span className="bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
                          </span>
                        </button>
                        {!reorder && (st?.lines ?? 0) > 0 && (
                          <div className="hive-actions">
                            {st!.due > 0 ? (
                              <button type="button" className="review-btn" onClick={() => navigate(`/train/hive/${h.id}/review`)}>Review ({st!.due})</button>
                            ) : <span />}
                            <button type="button" className="learn-btn" disabled={!st!.fresh} onClick={() => navigate(`/train/hive/${h.id}/learn`)}>
                              {st!.fresh ? 'Learn' : 'All learned'}
                            </button>
                          </div>
                        )}
                      </div>
                      {reorder && (
                        <div className="comb-tools">
                          <button type="button" onClick={() => move(t.hives, i, -1)} disabled={i === 0} aria-label="Move up">▲</button>
                          <button type="button" onClick={() => move(t.hives, i, 1)} disabled={i === t.hives.length - 1} aria-label="Move down">▼</button>
                        </div>
                      )}
                    </li>
                  );
                })}
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
