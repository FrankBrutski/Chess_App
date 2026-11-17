import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, today } from '../lib/db';
import { navigate } from '../router';
import { getScope, setScope, type TrainScope } from '../lib/prefs';
import { loadTrainData, type TrainData } from '../lib/training';
import { lineState, planLearn, planReview, userKeys } from '../lib/srs';
import { groupHives, tierName } from '../lib/hives';
import { TrainSession, type SessionItem } from '../components/TrainSession';
import { HexMark } from '../components/HexMark';

/** Route presets: #/train/hive/<id>, #/train/section/<hiveId>/<sectionId>, #/train/comb/<chapterId>. */
export function TrainPage({ kind, a, b }: { kind?: string; a?: string; b?: string }) {
  const [scope, setScopeState] = useState<TrainScope>(() => {
    const s = getScope();
    if (kind === 'hive' && a) return { ...s, hive: a, section: '', comb: '' };
    if (kind === 'section' && a && b) return { ...s, hive: a, section: b, comb: '' };
    return s;
  });
  const [combPreset] = useState(kind === 'comb' ? a : undefined);
  const update = (s: TrainScope) => { setScopeState(s); setScope(s); };

  const hives = useLiveQuery(() => db.courses.toArray(), []);
  // Only the combs of the chosen section (for the Comb picker), not every comb's tree.
  const combs = useLiveQuery(
    async () => (scope.section ? (await db.chapters.where('sectionId').equals(scope.section).toArray()).sort((x, y) => x.order - y.order) : []),
    [scope.section],
  );
  const honeyToday = useLiveQuery(async () => (await db.honey.get(today()))?.amount ?? 0, []);
  const honeyTotal = useLiveQuery(async () => (await db.honey.toArray()).reduce((n, h) => n + h.amount, 0), []);
  const [data, setData] = useState<TrainData>();
  const [session, setSession] = useState<{ mode: 'learn' | 'review'; items: SessionItem[] }>();
  const [reload, setReload] = useState(0);
  const [learnCount, setLearnCount] = useState(5);

  // A comb link fills in its hive and section.
  useEffect(() => {
    if (!combPreset) return;
    void db.chapters.get(combPreset).then((c) => c && update({ ...getScope(), hive: c.courseId, section: c.sectionId, comb: c.id }));
  }, [combPreset]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let live = true;
    void loadTrainData(scope).then((d) => live && setData(d));
    return () => { live = false; };
  }, [scope, reload]);

  const now = Date.now();
  const stats = useMemo(() => {
    if (!data) return undefined;
    const states = data.lines.map((t) => lineState(t, data.cells, now));
    const keys = new Set(data.lines.flatMap(userKeys));
    const due = [...keys].filter((k) => (data.cells.get(k)?.due ?? Infinity) <= now).length;
    const upcoming = [...keys].map((k) => data.cells.get(k)?.due).filter((d): d is number => d !== undefined && d > now).sort((x, y) => x - y)[0];
    return {
      lines: data.lines.length,
      fresh: states.filter((s) => s === 'new').length,
      learned: states.filter((s) => s !== 'new').length,
      due,
      upcoming,
    };
  }, [data, now]);

  if (session && data) {
    return (
      <TrainSession
        mode={session.mode}
        items={session.items}
        chapters={data.chapters}
        cells={data.cells}
        onExit={() => { setSession(undefined); setReload((r) => r + 1); }}
      />
    );
  }

  const hive = hives?.find((h) => h.id === scope.hive);
  const sections = hive?.sections ?? [];
  const scopeText =
    [
      hive?.name ?? (scope.hive === 'white' ? 'All White hives' : scope.hive === 'black' ? 'All Black hives' : 'All hives'),
      sections.find((x) => x.id === scope.section)?.name,
      combs?.find((c) => c.id === scope.comb)?.title,
    ]
      .filter(Boolean)
      .join(' › ') +
    (!hive && scope.mainHivesOnly ? ' · main hives' : '') +
    (scope.mainLinesOnly ? ' · main lines' : '');
  const startLearn = () => data && setSession({ mode: 'learn', items: planLearn(data.lines, data.cells).slice(0, learnCount).map((t) => ({ t })) });
  const startReview = () => data && setSession({ mode: 'review', items: planReview(data.lines, data.cells, Date.now()) });

  return (
    <div className="page">
      <header className="page-header">
        <button type="button" className="icon-btn" onClick={() => navigate('/openings')} aria-label="Back">‹</button>
        <h1 className="brand"><HexMark /> Train</h1>
        <button type="button" className="icon-btn" onClick={() => navigate('/settings')} aria-label="Settings">⚙</button>
      </header>

      <p className="honey-line">
        <span className="honey-pot" aria-hidden="true">🍯</span> {honeyToday ?? 0} honey today · {honeyTotal ?? 0} in all
      </p>

      <details className="scope-box">
        <summary>
          <span className="muted">Training</span> <b>{scopeText}</b>
        </summary>
      <div className="stack">
        <label className="field">
          <span>Hive</span>
          <select value={scope.hive} onChange={(e) => update({ ...scope, hive: e.target.value, section: '', comb: '' })}>
            <option value="">All hives</option>
            <option value="white">All White hives</option>
            <option value="black">All Black hives</option>
            {groupHives(hives ?? []).map((g) => (
              <optgroup key={g.color} label={`As ${g.color === 'white' ? 'White' : 'Black'}`}>
                {g.tiers.flatMap((t) => t.hives.map((h) => <option key={h.id} value={h.id}>{h.name} ({tierName(h.tier)})</option>))}
              </optgroup>
            ))}
          </select>
        </label>
        {hive && (
          <label className="field">
            <span>Section</span>
            <select value={scope.section} onChange={(e) => update({ ...scope, section: e.target.value, comb: '' })}>
              <option value="">All sections</option>
              {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        )}
        {scope.section && (
          <label className="field">
            <span>Comb</span>
            <select value={scope.comb} onChange={(e) => update({ ...scope, comb: e.target.value })}>
              <option value="">All combs</option>
              {(combs ?? []).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </label>
        )}
        {!hive && (
          <label className="check">
            <input type="checkbox" checked={scope.mainHivesOnly} onChange={(e) => update({ ...scope, mainHivesOnly: e.target.checked })} />
            <span>Main hives only</span>
          </label>
        )}
        <label className="check">
          <input type="checkbox" checked={scope.mainLinesOnly} onChange={(e) => update({ ...scope, mainLinesOnly: e.target.checked })} />
          <span>Main line of each comb only</span>
        </label>
      </div>
      </details>

      {stats && (
        <div className="train-stats">
          <div><b>{stats.due}</b><span>moves due</span></div>
          <div><b>{stats.fresh}</b><span>new lines</span></div>
          <div><b>{stats.learned}</b><span>of {stats.lines} lines learned</span></div>
        </div>
      )}

      <div className="stack">
        {!!stats?.due && (
          <button type="button" className="primary wide" onClick={startReview}>
            Review {stats.due} due move{stats.due === 1 ? '' : 's'}
          </button>
        )}
        <div className="row learn-row">
          <button type="button" className={`wide${stats?.due ? '' : ' primary'}`} disabled={!stats?.fresh} onClick={startLearn}>
            {stats?.fresh ? 'Learn new lines' : 'No new lines here'}
          </button>
          <select value={learnCount} onChange={(e) => setLearnCount(+e.target.value)} aria-label="New lines per session" title="New lines per session">
            {[1, 3, 5, 10, 20].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        {!stats?.due && (
          <p className="muted small center">
            {stats?.upcoming ? `Next review ${whenText(stats.upcoming)}.` : 'Nothing to review yet.'}
          </p>
        )}
      </div>
      <p className="muted small">
        Lines you play a second-choice move in are for reading only and aren't drilled. Change the review ladder and
        what a miss does in Settings → Training.
      </p>
    </div>
  );
}

function whenText(t: number) {
  const mins = Math.round((t - Date.now()) / 60000);
  if (mins < 60) return `in ${Math.max(1, mins)} min`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `in ${hrs} h`;
  return `on ${new Date(t).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`;
}
