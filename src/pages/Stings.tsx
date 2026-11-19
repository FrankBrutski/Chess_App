import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { navigate } from '../router';
import { StingMark } from '../components/HexMark';
import { ShotImage } from '../components/ShotImage';
import { addScreenshots, deleteSting, STATUS_LABEL } from '../lib/stings';
import type { StingStatus } from '../lib/model';
import { getStingsNewestFirst, setStingsNewestFirst } from '../lib/prefs';
import { useDrillCount } from './StingDrill';

const TABS: StingStatus[] = ['inbox', 'progress', 'ready'];

/** Tactics home: capture screenshots fast into the Inbox, finish them later. */
export function StingsPage({ tab: tabParam }: { tab?: string }) {
  const tab: StingStatus = TABS.includes(tabParam as StingStatus) ? (tabParam as StingStatus) : 'inbox';
  const [newestFirst, setNewestFirstState] = useState(getStingsNewestFirst);
  const setNewestFirst = (on: boolean) => { setNewestFirstState(on); setStingsNewestFirst(on); };
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<{ done: number; total: number }>();
  const [note, setNote] = useState<string>();
  const fileRef = useRef<HTMLInputElement>(null);
  const drill = useDrillCount();

  const counts = useLiveQuery(async () => {
    const all = await db.stings.orderBy('status').keys();
    const c: Record<StingStatus, number> = { inbox: 0, progress: 0, ready: 0 };
    for (const k of all as StingStatus[]) c[k]++;
    return c;
  }, []);
  const cards = useLiveQuery(async () => {
    const list = await db.stings.where('status').equals(tab).sortBy('createdAt');
    return newestFirst ? list.reverse() : list;
  }, [tab, newestFirst]);

  const onFiles = async (files: FileList | null) => {
    const list = [...(files ?? [])];
    if (!list.length) return;
    setNote(undefined);
    setBusy({ done: 0, total: list.length });
    const res = await addScreenshots(list, undefined, (done) => setBusy({ done, total: list.length }));
    setBusy(undefined);
    if (fileRef.current) fileRef.current.value = '';
    setNote(
      `Added ${res.added} screenshot${res.added === 1 ? '' : 's'} to the Inbox.` +
        (res.failed.length ? ` Couldn't read ${res.failed.length}: ${res.failed.slice(0, 3).join(', ')}${res.failed.length > 3 ? '…' : ''}.` : ''),
    );
    if (tab !== 'inbox') navigate('/stings');
  };

  return (
    <div className="page">
      <header className="page-header">
        <h1 className="brand"><StingMark /> Tactics</h1>
      </header>

      {(counts?.ready ?? 0) > 0 && (
        <button type="button" className="primary wide drill-cta" onClick={() => navigate('/stings/drill')}>
          {drill ? `Drill · ${drill} card${drill === 1 ? '' : 's'}` : 'Drill · nothing due'}
        </button>
      )}
      <label className={`primary-file${busy ? ' busy' : ''}${(counts?.ready ?? 0) > 0 ? ' secondary' : ''}`}>
        <input ref={fileRef} type="file" accept="image/*" multiple disabled={!!busy} onChange={(e) => void onFiles(e.target.files)} />
        {busy ? `Adding ${busy.done} of ${busy.total}…` : 'Add screenshots'}
      </label>
      {note && <p className="muted small center">{note}</p>}

      <div className="segmented" role="tablist" aria-label="Card status">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className={tab === t ? 'on' : undefined}
            onClick={() => navigate(t === 'inbox' ? '/stings' : `/stings/${t}`)}
          >
            {STATUS_LABEL[t]}{counts ? ` ${counts[t]}` : ''}
          </button>
        ))}
      </div>

      {cards && cards.length > 1 && (
        <div className="row list-tools">
          <button type="button" className="link-btn" onClick={() => setNewestFirst(!newestFirst)}>
            {newestFirst ? 'Newest first' : 'Oldest first'}
          </button>
          <button type="button" className="link-btn" onClick={() => setEditing(!editing)}>{editing ? 'Done' : 'Delete…'}</button>
        </div>
      )}

      {cards?.length === 0 && (
        <div className="empty">
          {tab === 'inbox' ? (
            <>
              <p>The Inbox is empty.</p>
              <p className="muted">
                Tap Add screenshots and pick as many as you like from Photos. Each one becomes a card here. Only the
                images you pick are read, and they stay on this phone.
              </p>
            </>
          ) : tab === 'progress' ? (
            <p className="muted">Cards whose position you've set up wait here while you add lines and notes.</p>
          ) : (
            <p className="muted">Finished cards with a best line land here, ready to drill.</p>
          )}
        </div>
      )}

      <ul className="shot-grid">
        {cards?.map((c) => (
          <li key={c.id}>
            <button type="button" className="shot-card" onClick={() => !editing && navigate(`/sting/${c.id}`)} aria-label={c.title ?? 'Open card'}>
              <ShotImage shotId={c.shotId} className="shot-thumb" />
              {c.title && <span className="shot-title">{c.title}</span>}
            </button>
            {editing && (
              <button type="button" className="shot-delete" onClick={() => void deleteSting(c.id)} aria-label="Delete this card">✕</button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
