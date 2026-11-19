import { useLiveQuery } from 'dexie-react-hooks';
import { db, today } from '../lib/db';
import { loadTrainData } from '../lib/training';
import { lineState, userKeys } from '../lib/srs';
import { stingCounts } from '../lib/stings';

/** Your progress at a glance: honey, hives, combs and lines learned, moves due, tactics. */
export function Profile() {
  const honeyToday = useLiveQuery(async () => (await db.honey.get(today()))?.amount ?? 0, []);
  const honeyTotal = useLiveQuery(async () => (await db.honey.toArray()).reduce((n, h) => n + h.amount, 0), []);
  const stings = useLiveQuery(stingCounts, []);
  const stingsLearned = useLiveQuery(() => db.cells.where('key').startsWith('sting:').count(), []);
  const s = useLiveQuery(async () => {
    const [d, hives] = await Promise.all([
      loadTrainData({ hive: '', section: '', comb: '', mainHivesOnly: false, mainLinesOnly: false }),
      db.courses.toArray(),
    ]);
    const now = Date.now();
    const per = new Map<string, { lines: number; learned: number }>();
    const combs = new Map<string, boolean>(); // comb id → has a learned line
    let learned = 0;
    for (const t of d.lines) {
      const ok = lineState(t, d.cells, now) !== 'new';
      if (ok) learned++;
      const h = per.get(t.hiveId) ?? { lines: 0, learned: 0 };
      h.lines++;
      if (ok) h.learned++;
      per.set(t.hiveId, h);
      combs.set(t.chapterId, (combs.get(t.chapterId) ?? false) || ok);
    }
    const due = new Set(d.lines.flatMap(userKeys).filter((k) => (d.cells.get(k)?.due ?? Infinity) <= now)).size;
    const rows = hives
      .sort((a, b) => (a.color === b.color ? a.tier - b.tier || a.order - b.order : a.color === 'white' ? -1 : 1))
      .map((h) => ({ id: h.id, name: h.name, ...(per.get(h.id) ?? { lines: 0, learned: 0 }) }));
    return { hives: hives.length, lines: d.lines.length, learned, combs: combs.size, combsStarted: [...combs.values()].filter(Boolean).length, due, rows };
  }, []);

  return (
    <div className="page">
      <header className="page-header">
        <span className="icon-btn" aria-hidden="true" />
        <h1>Profile</h1>
        <span className="icon-btn" aria-hidden="true" />
      </header>
      <p className="honey-line">
        <span className="honey-pot" aria-hidden="true">🍯</span> {honeyToday ?? 0} honey today · {honeyTotal ?? 0} in all
      </p>
      <div className="stat-grid">
        <div><b>{s?.hives ?? 0}</b><span>hives</span></div>
        <div><b>{s?.combsStarted ?? 0} / {s?.combs ?? 0}</b><span>combs started</span></div>
        <div><b>{s?.learned ?? 0} / {s?.lines ?? 0}</b><span>lines learned</span></div>
        <div><b>{s?.due ?? 0}</b><span>moves due now</span></div>
      </div>
      {!!s?.rows.length && (
        <>
          <h3 className="tier-head">By hive</h3>
          <ul className="stat-rows">
            {s.rows.map((r) => (
              <li key={r.id}><span>{r.name}</span><span className="muted">{r.learned} / {r.lines} lines</span></li>
            ))}
          </ul>
        </>
      )}
      <h3 className="tier-head">Tactics</h3>
      <ul className="stat-rows">
        <li><span>Stings ready to drill</span><span className="muted">{stings?.ready ?? 0}</span></li>
        <li><span>Stings learned</span><span className="muted">{stingsLearned ?? 0}</span></li>
      </ul>
    </div>
  );
}
