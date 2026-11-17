import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { navigate } from '../router';
import { ShotImage } from '../components/ShotImage';
import { CropBoard } from '../components/CropBoard';
import { StingSetup } from '../components/StingSetup';
import { Board } from '../components/Board';
import { deleteSting, saveCrop, SOURCE_KINDS, STATUS_LABEL } from '../lib/stings';
import { getStingsNewestFirst } from '../lib/prefs';
import type { Sting } from '../lib/model';

/**
 * One Sting card. An Inbox card goes: crop the board → set up the position (→ In progress).
 * After that the card shows its position and source, with Edit to change them.
 */
export function StingCard({ id }: { id: string }) {
  const card = useLiveQuery(() => db.stings.get(id), [id]);
  const shot = useLiveQuery(() => (card?.shotId ? db.shots.get(card.shotId) : undefined), [card?.shotId]);
  // The queue to step through: the list you came from, in the same order.
  // It stays the same list while you step through it, even after a card moves on to In progress.
  const [queueStatus, setQueueStatus] = useState<Sting['status']>();
  useEffect(() => { if (card && !queueStatus) setQueueStatus(card.status); }, [card, queueStatus]);
  const status = queueStatus ?? card?.status;
  const listed = useLiveQuery(async () => (status ? db.stings.where('status').equals(status).sortBy('createdAt') : []), [status]);
  const queue = useMemo(() => {
    if (!listed || !card) return listed;
    const list = listed.some((c) => c.id === card.id) ? listed : [...listed, card].sort((a, b) => a.createdAt - b.createdAt);
    return getStingsNewestFirst() ? [...list].reverse() : list;
  }, [listed, card]);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  if (card === undefined) return <div className="page" />;
  if (!card) return <div className="page"><p>Card not found.</p><button type="button" onClick={() => navigate('/stings')}>Back to Stings</button></div>;

  const back = (status ?? card.status) === 'inbox' ? '/stings' : `/stings/${status ?? card.status}`;
  const i = queue?.findIndex((c) => c.id === card.id) ?? -1;
  const prev = i > 0 ? queue![i - 1] : undefined;
  const next = queue && i >= 0 && i < queue.length - 1 ? queue[i + 1] : undefined;
  const step = !card.cropped && card.status === 'inbox' ? 'crop' : !card.fen || editing ? 'setup' : 'view';
  const kind = SOURCE_KINDS.find((k) => k.id === card.source?.kind)?.label;
  const src = card.source;

  return (
    <div className="page">
      <header className="page-header">
        <button type="button" className="icon-btn" onClick={() => navigate(back)} aria-label="Back to Stings">‹</button>
        <h1>{card.title ?? (step === 'crop' ? 'Crop the board' : step === 'setup' ? 'Set up the position' : STATUS_LABEL[card.status])}</h1>
        <span className="muted small">{queue && i >= 0 ? `${i + 1}/${queue.length}` : ''}</span>
      </header>

      {step === 'crop' && (shot ? <CropBoard key={shot.id} blob={shot.blob} onDone={(img) => saveCrop(card.id, img)} /> : <ShotImage shotId={card.shotId} className="shot-full" />)}

      {step === 'setup' && <StingSetup key={card.id} card={card} onSaved={() => setEditing(false)} />}

      {step === 'view' && card.fen && (
        <div className="stack">
          <Board fen={card.fen} orientation={card.orientation ?? (card.fen.split(' ')[1] === 'b' ? 'black' : 'white')} />
          <p className="center"><b>{card.fen.split(' ')[1] === 'b' ? 'Black' : 'White'} to move</b></p>
          {(kind || src?.timeControl || src?.white || src?.event || src?.date) && (
            <p className="muted small center">
              {[kind, src?.timeControl, src?.platform, src?.white && src?.black ? `${src.white} – ${src.black}` : src?.white || src?.black, src?.event, src?.date, src?.note].filter(Boolean).join(' · ')}
            </p>
          )}
          <p className="muted small center">Exploring lines and marking the best move comes in the next update.</p>
          <div className="row">
            <button type="button" onClick={() => setEditing(true)}>Edit position</button>
          </div>
          {card.shotId && <ShotImage shotId={card.shotId} className="setup-shot" alt="Board from the screenshot" />}
        </div>
      )}

      <div className="row" style={{ marginTop: 16 }}>
        <button type="button" className="wide" disabled={!prev} onClick={() => prev && navigate(`/sting/${prev.id}`)}>‹ Previous</button>
        <button type="button" className="wide" disabled={!next} onClick={() => next && navigate(`/sting/${next.id}`)}>{step === 'crop' ? 'Skip ›' : 'Next ›'}</button>
      </div>
      <div className="stack" style={{ marginTop: 24 }}>
        {!confirming ? (
          <button type="button" className="danger-link" onClick={() => setConfirming(true)}>Delete this card</button>
        ) : (
          <div className="confirm">
            <span>Delete this card and its screenshot from this phone?</span>
            <button
              type="button"
              className="danger"
              onClick={async () => {
                await deleteSting(card.id);
                navigate(next ? `/sting/${next.id}` : prev ? `/sting/${prev.id}` : back);
              }}
            >
              Delete
            </button>
            <button type="button" onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        )}
      </div>
    </div>
  );
}
