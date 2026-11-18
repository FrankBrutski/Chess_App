import { useLiveQuery } from 'dexie-react-hooks';
import { Icon } from '../components/Toolbar';
import { db } from '../lib/db';
import { navigate } from '../router';
import { HexMark, StingMark } from '../components/HexMark';
import { loadTrainData } from '../lib/training';
import { userKeys } from '../lib/srs';
import { stingCounts } from '../lib/stings';
import { planDrill } from '../lib/stingDrill';
import { getStingNew } from '../lib/prefs';

/** The front door: openings and tactics are two separate parts of the app. */
export function Home() {
  const hives = useLiveQuery(() => db.courses.count(), []);
  const due = useLiveQuery(async () => {
    const d = await loadTrainData({ hive: '', section: '', comb: '', mainHivesOnly: false, mainLinesOnly: false });
    const now = Date.now();
    return new Set(d.lines.flatMap(userKeys).filter((k) => (d.cells.get(k)?.due ?? Infinity) <= now)).size;
  }, []);
  const stings = useLiveQuery(stingCounts, []);
  const drill = useLiveQuery(async () => {
    const [cards, cellList] = await Promise.all([db.stings.where('status').equals('ready').toArray(), db.cells.where('key').startsWith('sting:').toArray()]);
    return planDrill(cards, new Map(cellList.map((c) => [c.key, c])), Date.now(), getStingNew()).length;
  }, []);

  return (
    <div className="page home">
      <header className="page-header">
        <h1 className="brand"><HexMark /> Apiary</h1>
        <button type="button" className="icon-btn" onClick={() => navigate('/settings')} aria-label="Settings">{Icon.settings}</button>
      </header>
      <div className="doors">
        <button type="button" className="door" onClick={() => navigate('/openings')}>
          <span className="door-icon" aria-hidden="true"><HexMark /></span>
          <span className="door-title">Opening trainer</span>
          <span className="door-sub">Hives · your repertoire</span>
          <span className="door-stat">
            {hives === 0 ? 'Import a study to start' : `${hives ?? 0} hive${hives === 1 ? '' : 's'}${due ? ` · ${due} due` : ''}`}
          </span>
        </button>
        <button type="button" className="door" onClick={() => navigate('/stings')}>
          <span className="door-icon" aria-hidden="true"><StingMark /></span>
          <span className="door-title">Tactics</span>
          <span className="door-sub">Stings · positions to find</span>
          <span className="door-stat">
            {stings
              ? stings.inbox + stings.progress + stings.ready === 0
                ? 'Add screenshots to start'
                : [drill && `${drill} to drill`, stings.inbox && `${stings.inbox} in Inbox`, stings.progress && `${stings.progress} in progress`, !drill && stings.ready && `${stings.ready} ready`].filter(Boolean).join(' · ')
              : ''}
          </span>
        </button>
      </div>
    </div>
  );
}
