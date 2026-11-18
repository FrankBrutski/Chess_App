import { useEffect, useMemo, useState } from 'react';
import { db } from '../lib/db';
import { readShot, readingNote } from '../lib/readShot';
import type { Sting, SourceKind, StingSource } from '../lib/model';
import { PositionSetup, START_FEN, setupFenOf } from './PositionSetup';
import { ShotImage } from './ShotImage';
import { movesFromText, normalizeFen, playMoves, type PlayedPosition } from '../lib/positions';
import { moveNumber } from '../lib/tree';
import { savePosition, SOURCE_KINDS, TIME_CONTROLS } from '../lib/stings';

/** Set up a card's position next to its board crop, plus optional title and source. */
export function StingSetup({ card, onSaved }: { card: Sting; onSaved: () => void }) {
  const initial = card.fen ?? START_FEN;
  const [board, setBoard] = useState(initial.split(' ')[0]);
  const [turn, setTurn] = useState<'w' | 'b'>(initial.split(' ')[1] === 'b' ? 'b' : 'w');
  const [orientation, setOrientation] = useState<'white' | 'black'>(card.orientation ?? (turn === 'b' ? 'black' : 'white'));
  const [title, setTitle] = useState(card.title ?? '');
  const [source, setSource] = useState<StingSource>(card.source ?? {});
  const [msg, setMsg] = useState<string>();
  const [pasted, setPasted] = useState('');
  const [game, setGame] = useState<PlayedPosition[]>();
  const [shotOpen, setShotOpen] = useState(true);
  const [saving, setSaving] = useState(false);

  const [reading, setReading] = useState(false);

  /** Fill the board from the screenshot (on the phone, no network). */
  const readPicture = async () => {
    if (!card.shotId) return;
    setReading(true);
    try {
      const shot = await db.shots.get(card.shotId);
      if (!shot) return;
      const img = await createImageBitmap(shot.blob);
      const r = await readShot(img);
      img.close();
      setBoard(r.board);
      setTurn(r.turn);
      setOrientation(r.orientation);
      setMsg(readingNote(r));
    } catch {
      setMsg("Couldn't read that picture. Set the position by hand.");
    } finally {
      setReading(false);
    }
  };
  // A new card: read the pieces straight away.
  useEffect(() => {
    if (!card.fen && card.shotId) void readPicture();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id]);

  const fen = setupFenOf(board, turn);
  const checked = useMemo(() => normalizeFen(fen), [fen]);
  const setSrc = (patch: Partial<StingSource>) => setSource((s) => ({ ...s, ...patch }));

  const loadGame = () => {
    const text = pasted.trim();
    if (!text) return;
    if (/^\S+\/\S+\/\S+\/\S+\/\S+\/\S+\/\S+\/\S+(\s|$)/.test(text)) {
      const r = normalizeFen(text);
      if ('error' in r) return setMsg(r.error);
      const [b, t] = r.fen.split(' ');
      setBoard(b);
      setTurn(t as 'w' | 'b');
      setMsg(undefined);
      return;
    }
    const fenHeader = /\[FEN\s+"([^"]+)"\]/.exec(text)?.[1];
    const startN = fenHeader ? normalizeFen(fenHeader) : undefined;
    const r = playMoves(startN && 'fen' in startN ? startN.fen : START_FEN, movesFromText(text));
    if (r.positions.length <= 1) return setMsg(r.error ?? 'No moves found.');
    setMsg(r.error ? `${r.error} Showing the moves before it.` : 'Tap the move the puzzle starts after.');
    setGame(r.positions);
    // Fill in what the PGN headers say.
    const h = (k: string) => new RegExp(`\\[${k}\\s+"([^"]*)"\\]`).exec(text)?.[1];
    setSrc({
      white: source.white || h('White'),
      black: source.black || h('Black'),
      event: source.event || h('Event'),
      date: source.date || h('UTCDate')?.replace(/\./g, '-') || h('Date')?.replace(/\./g, '-'),
      url: source.url || (h('Site')?.startsWith('https://') ? h('Site') : undefined),
    });
  };

  const pick = (p: PlayedPosition) => {
    const [b, t] = p.fen.split(' ');
    setBoard(b);
    setTurn(t as 'w' | 'b');
    setOrientation(t === 'b' ? 'black' : 'white');
  };

  const save = async () => {
    if ('error' in checked) return setMsg(checked.error);
    setSaving(true);
    const clean = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v !== '')) as StingSource;
    await savePosition(card.id, checked.fen, { title: title.trim() || undefined, source: clean, orientation });
    setSaving(false);
    onSaved();
  };

  return (
    <div className="stack">
      {card.shotId && (
        <div>
          {shotOpen && <ShotImage shotId={card.shotId} className="setup-shot" alt="Board from the screenshot" />}
          <div className="row">
            <button type="button" className="link-btn small" onClick={() => setShotOpen(!shotOpen)}>
              {shotOpen ? 'Hide screenshot' : 'Show screenshot'}
            </button>
            <button type="button" className="link-btn small" disabled={reading} onClick={() => void readPicture()}>
              {reading ? 'Reading the pieces…' : 'Read pieces from the screenshot'}
            </button>
          </div>
        </div>
      )}

      <PositionSetup
        board={board}
        turn={turn}
        orientation={orientation}
        onBoard={setBoard}
        onTurn={(t) => { setTurn(t); }}
        onOrientation={setOrientation}
        onError={setMsg}
      />

      <details className="source-box">
        <summary>Paste a FEN or a game</summary>
        <div className="stack">
          <textarea rows={3} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="A FEN, or a game PGN / moves like 1. e4 e5 2. Nf3" aria-label="FEN or game" />
          <button type="button" onClick={loadGame}>Load</button>
          {game && (
            <p className="game-moves">
              {game.slice(1).map((p, i) => (
                <button key={i} type="button" className="mv mv-main" onClick={() => pick(p)}>
                  {(p.ply % 2 === 1 || i === 0) && <span className="mv-num">{moveNumber(p.ply)}</span>}{p.san}
                </button>
              ))}
            </p>
          )}
        </div>
      </details>

      {msg && <p className="small">{msg}</p>}
      {'error' in checked && <p className="small bad-text">Not a legal position yet: {checked.error.replace(/^That position isn't legal /, '')}</p>}

      <label className="field">
        <span>Title (optional)</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Knight fork wins the queen" />
      </label>

      <details className="source-box" open={!!card.source?.kind}>
        <summary>Source (optional)</summary>
        <div className="stack">
          <div className="chips" role="radiogroup" aria-label="Where it's from">
            {SOURCE_KINDS.map((k) => (
              <button key={k.id} type="button" role="radio" aria-checked={source.kind === k.id}
                className={`chip${source.kind === k.id ? ' on' : ''}`}
                onClick={() => setSrc({ kind: source.kind === k.id ? undefined : (k.id as SourceKind) })}>
                {k.label}
              </button>
            ))}
          </div>
          <div className="chips" role="radiogroup" aria-label="Time control">
            {TIME_CONTROLS.map((t) => (
              <button key={t} type="button" role="radio" aria-checked={source.timeControl === t}
                className={`chip${source.timeControl === t ? ' on' : ''}`}
                onClick={() => setSrc({ timeControl: source.timeControl === t ? undefined : t })}>
                {t}
              </button>
            ))}
          </div>
          <div className="row">
            <label className="field"><span>White</span><input value={source.white ?? ''} onChange={(e) => setSrc({ white: e.target.value })} /></label>
            <label className="field"><span>Black</span><input value={source.black ?? ''} onChange={(e) => setSrc({ black: e.target.value })} /></label>
          </div>
          <div className="row">
            <label className="field"><span>Platform</span><input value={source.platform ?? ''} onChange={(e) => setSrc({ platform: e.target.value })} placeholder="Lichess, Chess.com…" /></label>
            <label className="field"><span>Date</span><input type="date" value={source.date ?? ''} onChange={(e) => setSrc({ date: e.target.value })} /></label>
          </div>
          <label className="field"><span>Event, video or book</span><input value={source.event ?? ''} onChange={(e) => setSrc({ event: e.target.value })} /></label>
          <label className="field"><span>Notes</span><input value={source.note ?? ''} onChange={(e) => setSrc({ note: e.target.value })} /></label>
        </div>
      </details>

      <button type="button" className="primary wide" disabled={saving || 'error' in checked} onClick={() => void save()}>
        {saving ? 'Saving…' : card.status === 'inbox' ? 'Save position' : 'Save changes'}
      </button>
    </div>
  );
}
