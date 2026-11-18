import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Key } from 'chessground/types';
import { db } from '../lib/db';
import { navigate } from '../router';
import { getLineOrder } from '../lib/prefs';
import { buildIndex, leftBook, lookup, movesFromText, nearest, normalizeFen, playMoves, type Hit, type PlayedPosition } from '../lib/positions';
import { stripLineMarker, fmtMove } from '../lib/lines';
import { tierName } from '../lib/hives';
import { destsOf, sanOfBoardMove } from '../lib/boardMove';
import { moveNumber } from '../lib/tree';
import { Board } from '../components/Board';
import { PositionSetup, START_FEN, setupFenOf } from '../components/PositionSetup';
import { HexMark } from '../components/HexMark';
import { guessBoard } from '../lib/crop';
import { readShot, readingNote } from '../lib/readShot';

const START = START_FEN;

/** Plain text of a study note: no [Line: …] marker, no angle brackets. */
const plain = (t: string) => stripLineMarker(t).replace(/[<>]/g, '');

type Mode = 'setup' | 'play' | 'paste';

export function MasterBoard() {
  const hives = useLiveQuery(() => db.courses.toArray(), []);
  const chapters = useLiveQuery(() => db.chapters.toArray(), []);
  const index = useMemo(() => (hives && chapters ? buildIndex(hives, chapters, { order: getLineOrder() }) : undefined), [hives, chapters]);

  const [mode, setMode] = useState<Mode>('setup');
  const [board, setBoard] = useState(START.split(' ')[0]);
  const [turn, setTurn] = useState<'w' | 'b'>('w');
  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  const [msg, setMsg] = useState<string>();
  const [note, setNote] = useState<string>();
  // A game or move sequence (Play / Paste): positions and which one is shown.
  const [game, setGame] = useState<PlayedPosition[]>();
  const [at, setAt] = useState(0);
  const [pasted, setPasted] = useState('');
  const [shot, setShot] = useState<string>();
  const [shotOpen, setShotOpen] = useState(true);

  useEffect(() => () => { if (shot) URL.revokeObjectURL(shot); }, [shot]);

  const setupFen = setupFenOf(board, turn);
  const currentFen = (mode !== 'setup' && game ? game[at]?.fen : undefined) ?? setupFen;
  const checked = useMemo(() => normalizeFen(currentFen), [currentFen]);
  const fen = 'fen' in checked ? checked.fen : undefined;
  const hits = useMemo(() => (index && fen ? lookup(index, fen) : []), [index, fen]);
  const book = useMemo(() => (index && game && mode !== 'setup' && !hits.length ? leftBook(index, game.slice(0, at + 1)) : undefined), [index, game, at, hits, mode]);
  const near = useMemo(() => (index && fen && !hits.length && !book ? nearest(index, fen) : []), [index, fen, hits, book]);

  const loadFen = (text: string) => {
    const r = normalizeFen(text);
    if ('error' in r) { setMsg(r.error); return false; }
    const [b, t] = r.fen.split(' ');
    setBoard(b);
    setTurn(t as 'w' | 'b');
    setMsg(undefined);
    return true;
  };

  /** Find the board in a screenshot and read its pieces into Set up (on the phone, no network). */
  const readPicture = async (f: Blob) => {
    setMsg(undefined);
    setNote('Reading the pieces…');
    try {
      const img = await createImageBitmap(f);
      const r = await readShot(img, await guessBoard(img));
      img.close();
      setGame(undefined);
      setMode('setup');
      setBoard(r.board);
      setTurn(r.turn);
      setOrientation(r.orientation);
      setNote(readingNote(r));
    } catch {
      setNote(undefined);
      setMsg("Couldn't read that picture. Set the position up by hand.");
    }
  };

  const startPlay = (from: string) => {
    setGame([{ fen: from, ply: 0 }]);
    setAt(0);
    setMode('play');
  };

  const onPlayMove = (orig: Key, dest: Key) => {
    if (!game) return;
    const pos = game[at];
    const san = sanOfBoardMove(pos.fen, orig, dest);
    if (!san) return;
    const r = playMoves(pos.fen, [san]);
    const next = r.positions[1];
    if (!next) return;
    const list = [...game.slice(0, at + 1), { ...next, ply: pos.ply + 1 }];
    setGame(list);
    setAt(list.length - 1);
  };

  const doPaste = () => {
    const text = pasted.trim();
    if (!text) return;
    if (/^[^\s]+\/[^\s]+\/[^\s]+\/[^\s]+\/[^\s]+\/[^\s]+\/[^\s]+\/[^\s]+(\s|$)/.test(text)) {
      if (loadFen(text)) { setGame(undefined); setMode('setup'); }
      return;
    }
    const fenHeader = /\[FEN\s+"([^"]+)"\]/.exec(text)?.[1];
    const start = fenHeader && 'fen' in normalizeFen(fenHeader) ? (normalizeFen(fenHeader) as { fen: string }).fen : START;
    const r = playMoves(start, movesFromText(text));
    if (r.positions.length <= 1) { setMsg(r.error ?? 'No moves found.'); return; }
    setMsg(r.error ? `${r.error} Showing the moves before it.` : undefined);
    setGame(r.positions);
    setAt(r.positions.length - 1);
  };


  return (
    <div className="page board-page">
      <header className="page-header">
        <button type="button" className="icon-btn" onClick={() => navigate('/openings')} aria-label="Back">‹</button>
        <h1 className="brand"><HexMark /> Master board</h1>
        <label className="icon-btn small-text shot-btn" title="Read a position from a screenshot and pin it above the board (stays on this phone, not saved)">
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              if (shot) URL.revokeObjectURL(shot);
              setShot(URL.createObjectURL(f));
              setShotOpen(true);
              void readPicture(f);
            }}
          />
          Screenshot
        </label>
      </header>

      {shot && (
        <div className={`shot${shotOpen ? '' : ' closed'}`}>
          {shotOpen && <img src={shot} alt="Your screenshot" />}
          <div className="row">
            <button type="button" className="link-btn small" onClick={() => setShotOpen(!shotOpen)}>{shotOpen ? 'Hide screenshot' : 'Show screenshot'}</button>
            <button type="button" className="link-btn small" onClick={() => { URL.revokeObjectURL(shot); setShot(undefined); }}>Remove</button>
          </div>
        </div>
      )}

      <div className="segmented" role="tablist">
        {(['setup', 'play', 'paste'] as Mode[]).map((m) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} className={mode === m ? 'on' : ''}
            onClick={() => { setMode(m); if (m === 'play' && !game) startPlay(START); }}>
            {m === 'setup' ? 'Set up' : m === 'play' ? 'Play moves' : 'Paste'}
          </button>
        ))}
      </div>

      {mode === 'setup' && (
        <PositionSetup
          board={board}
          turn={turn}
          orientation={orientation}
          onBoard={setBoard}
          onTurn={setTurn}
          onOrientation={setOrientation}
          onError={setMsg}
          extra={<button type="button" onClick={() => fen && startPlay(fen)} disabled={!fen}>Play from here</button>}
        />
      )}

      {mode !== 'setup' && game && (
        <>
          {mode === 'paste' && (
            <div className="stack">
              <textarea rows={4} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Paste a FEN, a PGN, or moves like 1. e4 e5 2. f4" aria-label="FEN or moves" />
              <button type="button" className="primary wide" onClick={doPaste}>Look up</button>
            </div>
          )}
          <Board
            fen={game[at].fen}
            orientation={orientation}
            lastMove={undefined}
            movable={mode === 'play' && at === game.length - 1 ? { color: game[at].fen.split(' ')[1] === 'w' ? 'white' : 'black', dests: destsOf(game[at].fen) } : undefined}
            onMove={onPlayMove}
          />
          <div className="controls">
            <button type="button" onClick={() => setAt(0)} aria-label="Start">⏮</button>
            <button type="button" onClick={() => setAt(Math.max(0, at - 1))} aria-label="Back">◀</button>
            <button type="button" onClick={() => setAt(Math.min(game.length - 1, at + 1))} aria-label="Forward">▶</button>
            <button type="button" onClick={() => setOrientation(orientation === 'white' ? 'black' : 'white')}>Flip</button>
            {mode === 'play' && <button type="button" onClick={() => startPlay(START)}>Reset</button>}
          </div>
          <p className="game-moves">
            {game.slice(1).map((p, i) => (
              <button key={i} type="button" className={`mv mv-main${i + 1 === at ? ' current' : ''}`} onClick={() => setAt(i + 1)}>
                {(p.ply % 2 === 1 || i === 0) && <span className="mv-num">{moveNumber(p.ply)}</span>}{p.san}
              </button>
            ))}
          </p>
        </>
      )}
      {mode === 'paste' && !game && (
        <div className="stack">
          <textarea rows={4} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Paste a FEN, a PGN, or moves like 1. e4 e5 2. f4" aria-label="FEN or moves" />
          <button type="button" className="primary wide" onClick={doPaste}>Look up</button>
        </div>
      )}
      {note && mode === 'setup' && <p className="small">{note}</p>}
      {msg && <p className="small bad-text">{msg}</p>}

      <section className="results" aria-live="polite">
        {!index ? (
          <p className="muted">Loading your repertoire…</p>
        ) : 'error' in checked ? (
          <p className="muted small">{mode === 'setup' ? `Not a legal position yet: ${checked.error.replace(/^That position isn't legal /, '')}` : checked.error}</p>
        ) : hits.length ? (
          <>
            <h2 className="results-head good-text">In your repertoire: {hits.length} place{hits.length === 1 ? '' : 's'}</h2>
            {hits.map((h, i) => <HitCard key={i} hit={h} />)}
          </>
        ) : book ? (
          <>
            <h2 className="results-head">Not in your repertoire</h2>
            <p className="small">
              You left your prep after <b>{fmtSan(game![book.at])}</b>
              {book.played ? <> with <b>{book.played}</b></> : null}. Here is what you know from that position:
            </p>
            {book.hits.map((h, i) => <HitCard key={i} hit={h} />)}
          </>
        ) : (
          <>
            <h2 className="results-head">Not in your repertoire</h2>
            {near.length ? (
              <>
                <p className="small muted">Closest positions you know:</p>
                {near.map(({ hit, distance }, i) => <HitCard key={i} hit={hit} note={`${distance} square${distance === 1 ? '' : 's'} different`} />)}
              </>
            ) : (
              <p className="small muted">Nothing close in your hives. Try Play moves from the start to see where you leave your prep.</p>
            )}
          </>
        )}
      </section>
    </div>
  );
}

const fmtSan = (p: PlayedPosition) => (p.san ? `${moveNumber(p.ply)}${p.san}` : 'the start');

function HitCard({ hit, note }: { hit: Hit; note?: string }) {
  const { hive, chapter, node, line, lineCount, next, yourMove, rightsDiffer } = hit;
  const main = next[0];
  const notes = [
    ...('comments' in node ? node.comments : []),
    ...(yourMove && main ? [...main.startingComments, ...main.comments] : []),
  ].map(plain).filter(Boolean);
  const open = () => navigate(`/line/${chapter.id}/${encodeURIComponent(line.id)}/${node.id}`);
  return (
    <div className="hit">
      <div className="hit-head">
        <span className="hit-hive">{hive.name} <span className="muted small">({hive.color === 'white' ? 'White' : 'Black'}, {tierName(hive.tier)})</span></span>
        {note && <span className="tag">{note}</span>}
      </div>
      <div className="hit-place">
        {chapter.title} · <b>Line {line.number}</b>: {line.name}
        {lineCount > 1 && <span className="muted small"> (and {lineCount - 1} more line{lineCount === 2 ? '' : 's'})</span>}
      </div>
      {main ? (
        yourMove ? (
          <div className="hit-move">Your move: <b>{fmtMove(main)}</b>{next.length > 1 && <span className="muted small"> (also in the study: {next.slice(1).map(fmtMove).join(', ')})</span>}</div>
        ) : (
          <div className="hit-move">Their move. You've prepared for: <b>{next.map(fmtMove).join(', ')}</b></div>
        )
      ) : (
        <div className="hit-move muted">This is the end of the line.</div>
      )}
      {notes.length > 0 && <p className="hit-note">{notes.join(' ')}</p>}
      {rightsDiffer && <p className="small muted">Castling or en passant rights differ from the study's position.</p>}
      <button type="button" className="link-btn" onClick={open}>Open line {line.number} at this move ›</button>
    </div>
  );
}
