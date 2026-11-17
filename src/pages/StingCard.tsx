import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { navigate } from '../router';
import { ShotImage } from '../components/ShotImage';
import { deleteSting, STATUS_LABEL } from '../lib/stings';
import { getStingsNewestFirst } from '../lib/prefs';

/** One Sting card. For now: the screenshot, stepping through the queue, and delete. */
export function StingCard({ id }: { id: string }) {
  const card = useLiveQuery(() => db.stings.get(id), [id]);
  const queue = useLiveQuery(async () => {
    if (!card) return [];
    const list = await db.stings.where('status').equals(card.status).sortBy('createdAt');
    return getStingsNewestFirst() ? list.reverse() : list; // same order as the list you came from
  }, [card?.status]);
  const [confirming, setConfirming] = useState(false);

  if (card === undefined && queue === undefined) return <div className="page" />;
  if (!card) return <div className="page"><p>Card not found.</p><button type="button" onClick={() => navigate('/stings')}>Back to Stings</button></div>;

  const back = card.status === 'inbox' ? '/stings' : `/stings/${card.status}`;
  const i = queue?.findIndex((c) => c.id === card.id) ?? -1;
  const prev = i > 0 ? queue![i - 1] : undefined;
  const next = queue && i >= 0 && i < queue.length - 1 ? queue[i + 1] : undefined;

  return (
    <div className="page">
      <header className="page-header">
        <button type="button" className="icon-btn" onClick={() => navigate(back)} aria-label="Back to Stings">‹</button>
        <h1>{card.title ?? STATUS_LABEL[card.status]}</h1>
        <span className="muted small">{queue && i >= 0 ? `${i + 1}/${queue.length}` : ''}</span>
      </header>
      <ShotImage shotId={card.shotId} className="shot-full" alt="Screenshot" />
      <p className="muted small center">
        Added {new Date(card.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}.
        {card.status === 'inbox' && ' Setting up the position from the screenshot comes in the next update.'}
      </p>
      <div className="row">
        <button type="button" className="wide" disabled={!prev} onClick={() => prev && navigate(`/sting/${prev.id}`)}>‹ Previous</button>
        <button type="button" className="wide primary" disabled={!next} onClick={() => next && navigate(`/sting/${next.id}`)}>Next ›</button>
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
