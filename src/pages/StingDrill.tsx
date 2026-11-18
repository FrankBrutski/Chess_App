import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Key } from 'chessground/types';
import type { MoveNode, RootNode, Shape, Sting, TreeNode } from '../lib/model';
import { db, addHoney } from '../lib/db';
import { navigate } from '../router';
import { destsOf, positionOf, sanOfBoardMove } from '../lib/boardMove';
import { moveNumber } from '../lib/tree';
import { learnCell, reviewCell, type Cell } from '../lib/srs';
import { evaluate } from '../lib/engine';
import { cellKey, honeyFor, judgeFirst, judgeLater, planDrill, scoreFor } from '../lib/stingDrill';
import { editNode, playMove } from '../lib/stingTree';
import { getLadder, getMissPolicy, getStingEngineCheck, getStingHoney, getStingNew } from '../lib/prefs';
import { Board } from '../components/Board';
import { StingMark } from '../components/HexMark';
import { ShotImage } from '../components/ShotImage';
import { Icon, Toolbar } from '../components/Toolbar';

type Feedback = { kind: 'good' | 'bad' | 'info' | 'done'; text: string } | undefined;
type Outcome = { kind: 'best' | 'also' | 'extra'; mistakes: number; honey?: number; extraSan?: string; extraFen?: string };

/** Score for the side that just moved, in the position after its move. Checkmate needs no engine. */
async function scoreAfter(fen: string): Promise<number | undefined> {
  const moverWhite = fen.split(' ')[1] === 'b';
  if (positionOf(fen)?.isCheckmate()) return 100_000;
  return scoreFor(await evaluate(fen), moverWhite);
}

/** Drill Ready Stings: find the win from the puzzle position. */
export function StingDrill() {
  const [plan, setPlan] = useState<Sting[]>();
  const [cells, setCells] = useState<Map<string, Cell>>();
  const [qi, setQi] = useState(0);
  const [tally, setTally] = useState({ solved: 0, honey: 0, missed: 0 });

  useEffect(() => {
    void (async () => {
      const [cards, cellList] = await Promise.all([db.stings.where('status').equals('ready').toArray(), db.cells.where('key').startsWith('sting:').toArray()]);
      const m = new Map(cellList.map((c) => [c.key, c]));
      setCells(m);
      setPlan(planDrill(cards, m, Date.now(), getStingNew()));
    })();
  }, []);

  if (!plan || !cells) return <div className="page"><p className="muted">Loading…</p></div>;
  const card = plan[qi];

  return (
    <div className="page drill-page with-toolbar">
      <header className="page-header">
        <button type="button" className="icon-btn" onClick={() => navigate('/stings/ready')} aria-label="Back to Stings">‹</button>
        <h1 className="brand"><StingMark /> Drill</h1>
        <span className="muted small">{card ? `${qi + 1}/${plan.length}` : ''}</span>
      </header>
      {plan.length === 0 ? (
        <div className="empty">
          <p>Nothing to drill right now.</p>
          <p className="muted">Ready cards come back when they're due. Mark more cards Ready to add new ones.</p>
          <button type="button" onClick={() => navigate('/stings')}>Back to Stings</button>
        </div>
      ) : !card ? (
        <div className="empty">
          <p><b>Session done.</b></p>
          <p>{tally.solved} solved first try · {tally.missed} to see again · 🍯 {tally.honey} honey</p>
          <button type="button" className="primary" onClick={() => navigate('/stings')}>Back to Stings</button>
        </div>
      ) : (
        <DrillCard
          key={card.id}
          card={card}
          onDone={async (o) => {
            const now = Date.now();
            const key = cellKey(card.id);
            const prev = cells.get(key);
            const ok = o.mistakes === 0;
            const next = prev ? reviewCell(prev, ok, now, getLadder(), getMissPolicy()) : ok ? learnCell(key, now, getLadder()) : { ...learnCell(key, now, getLadder()), lapses: 1 };
            await db.cells.put(next);
            cells.set(key, next);
            if (o.honey) await addHoney(o.honey);
            setTally((t) => ({ solved: t.solved + (ok ? 1 : 0), missed: t.missed + (ok ? 0 : 1), honey: t.honey + (o.honey ?? 0) }));
          }}
          onNext={() => setQi((i) => i + 1)}
        />
      )}
    </div>
  );
}

function DrillCard({ card, onDone, onNext }: { card: Sting; onDone: (o: Outcome) => Promise<void>; onNext: () => void }) {
  const root = card.root as RootNode;
  const userWhite = root.fen.split(' ')[1] === 'w';
  const userColor = userWhite ? 'white' : 'black';
  const [at, setAt] = useState<TreeNode>(root); // position on the board
  const [line, setLine] = useState<MoveNode>(); // the tagged line you're on
  const [feedback, setFeedback] = useState<Feedback>({ kind: 'info', text: `${userWhite ? 'White' : 'Black'} to move. Find the win.` });
  // Read inside timers and async steps, so kept in refs as well as state.
  const [mistakes, setMistakesState] = useState(0);
  const missRef = useRef(0);
  const setMistakes = (f: (m: number) => number) => { missRef.current = f(missRef.current); setMistakesState(missRef.current); };
  const [hint, setHint] = useState<Shape[]>([]);
  const [resetKey, setResetKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>();
  const [flipped, setFlipped] = useState(false);
  const [shown, setShown] = useState<{ fen: string; uci?: string }>(); // a refutation or the solution being shown
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const toMove = at.fen.split(' ')[1] === 'w' ? 'white' : 'black';
  const yourTurn = !outcome && !busy && !shown && toMove === userColor;
  const movable = useMemo(() => (yourTurn ? { color: userColor as 'white' | 'black', dests: destsOf(at.fen) } : undefined), [yourTurn, at, userColor]);
  const best = root.children.find((c) => c.tag === 'best')!;

  const finish = async (o: Outcome) => {
    setOutcome(o);
    let honey = 0;
    if (o.mistakes === 0) {
      if (o.kind === 'best') honey = honeyFor('best', getStingHoney());
      else {
        setFeedback({ kind: 'info', text: 'Checking with Stockfish…' });
        const played = await scoreAfter(o.kind === 'also' ? line!.fen : o.extraFen!);
        const bestScore = o.kind === 'also' ? await scoreAfter(best.fen) : undefined;
        honey = honeyFor(o.kind, getStingHoney(), { played, best: bestScore });
      }
    }
    const done = { ...o, honey };
    setOutcome(done);
    await onDone(done);
    const tail = honey ? ` 🍯 +${honey}` : '';
    setFeedback(
      o.mistakes
        ? { kind: 'done', text: `Solved after ${o.mistakes} miss${o.mistakes === 1 ? '' : 'es'}. It comes back soon.` }
        : o.kind === 'best'
          ? { kind: 'good', text: `Solved!${tail}` }
          : o.kind === 'also'
            ? { kind: 'good', text: `Also wins. Your main line was ${moveNumber(best.ply)}${best.san}.${tail}` }
            : { kind: 'good', text: `Not in your notes, but it wins.${tail} Your main line was ${moveNumber(best.ply)}${best.san}.` },
    );
  };

  /** Play the opponent's answers along the line until it's your move or the line ends. */
  const advance = (from: MoveNode, start: MoveNode) => {
    const kind = start.tag === 'also' ? 'also' : 'best';
    const reply = from.children[0];
    if (!reply) { void finish({ kind, mistakes: missRef.current }); return; }
    setBusy(true);
    timer.current = window.setTimeout(() => {
      setBusy(false);
      setAt(reply);
      if (!reply.children[0]) void finish({ kind, mistakes: missRef.current });
    }, 500);
  };

  const onMove = async (orig: Key, dest: Key) => {
    const san = sanOfBoardMove(at.fen, orig, dest);
    if (!san) return;
    setHint([]);
    if (at === root) {
      const j = judgeFirst(root, san);
      if (j.kind === 'best' || j.kind === 'also') {
        setLine(j.node);
        setAt(j.node);
        setFeedback({ kind: 'good', text: `${moveNumber(j.node.ply)}${j.node.san} ✓` });
        advance(j.node, j.node);
        return;
      }
      if (j.kind === 'refute') {
        setMistakes((m) => m + 1);
        const reply = j.node.children[0];
        setShown({ fen: reply?.fen ?? j.node.fen, uci: reply?.uci ?? j.node.uci });
        setFeedback({ kind: 'bad', text: `${j.node.san} fails${reply ? ` to ${reply.san}` : ''}. ${j.node.comments.join(' ')}`.trim() });
        return;
      }
      // Not in your notes: maybe it still wins.
      if (getStingEngineCheck()) {
        setBusy(true);
        setFeedback({ kind: 'info', text: `${san}: not in your notes. Checking with Stockfish…` });
        const after = playMove(root, 'root', san);
        const fen = after ? (after.root.children.find((c) => c.id === after.id)?.fen ?? '') : '';
        const score = fen ? await scoreAfter(fen) : undefined;
        setBusy(false);
        if (score !== undefined && score > 400) {
          await finish({ kind: 'extra', mistakes: missRef.current, extraSan: san, extraFen: fen });
          return;
        }
      }
      setMistakes((m) => m + 1);
      setResetKey((k) => k + 1);
      setFeedback({ kind: 'bad', text: `${san} isn't it. Try again${mistakes ? ', or tap Hint' : ''}.` });
      return;
    }
    const j = judgeLater(at, san);
    if (j.ok) {
      setAt(j.node);
      setFeedback({ kind: 'good', text: `${moveNumber(j.node.ply)}${j.node.san} ✓` });
      advance(j.node, line ?? j.node);
      return;
    }
    setMistakes((m) => m + 1);
    setResetKey((k) => k + 1);
    const note = j.side?.comments.join(' ');
    setFeedback({ kind: 'bad', text: `${san} isn't the move here.${note ? ` ${note}` : ''} Try again.` });
  };

  const showHint = () => {
    const target = at === root ? best : at.children[0];
    if (!target) return;
    setHint(hint.length ? [{ color: 'blue', orig: target.uci.slice(0, 2), dest: target.uci.slice(2, 4) }] : [{ color: 'blue', orig: target.uci.slice(0, 2) }]);
    setMistakes((m) => Math.max(m, 1)); // a hint counts as a miss for scheduling
  };

  const addAsAlso = async () => {
    if (!outcome?.extraSan) return;
    const res = playMove(root, 'root', outcome.extraSan);
    if (!res) return;
    await db.stings.update(card.id, { root: editNode(res.root, res.id, { tag: 'also' }), updatedAt: Date.now() });
    setFeedback({ kind: 'good', text: `Added ${outcome.extraSan} as an Also wins line.` });
    setOutcome({ ...outcome, extraSan: undefined });
  };

  const src = card.source;
  return (
    <div className="stack drill">
      <Board
        fen={shown?.fen ?? at.fen}
        orientation={flipped ? ((card.orientation ?? userColor) === 'white' ? 'black' : 'white') : card.orientation ?? userColor}
        lastMove={shown?.uci ?? (at === root ? undefined : (at as MoveNode).uci)}
        hintShapes={hint}
        movable={movable}
        onMove={(o, d) => void onMove(o, d)}
        resetKey={resetKey}
      />
      {feedback && <div className={`feedback fb-${feedback.kind}`}><span>{feedback.text}</span></div>}
      <Toolbar fixed items={shown ? [
        { label: 'Try again', icon: Icon.retry, primary: true, onClick: () => { setShown(undefined); setAt(root); setFeedback({ kind: 'info', text: 'Try again from the start.' }); } },
        { label: 'Flip', icon: Icon.flip, onClick: () => setFlipped(!flipped) },
      ] : outcome ? [
        ...(outcome.extraSan ? [{ label: 'Add as Also', icon: Icon.lines, onClick: () => void addAsAlso() }] : []),
        { label: 'Open card', icon: Icon.eye, onClick: () => navigate(`/sting/${card.id}`) },
        { label: 'Flip', icon: Icon.flip, onClick: () => setFlipped(!flipped) },
        { label: 'Next card', icon: Icon.skip, primary: true, onClick: onNext },
      ] : [
        { label: 'Hint', icon: Icon.hint, onClick: showHint, disabled: !yourTurn },
        {
          label: 'Show move', icon: Icon.eye, disabled: !yourTurn || at !== root,
          onClick: () => { setMistakes((m) => Math.max(m, 1)); setAt(best); setLine(best); setFeedback({ kind: 'info', text: `The move was ${moveNumber(best.ply)}${best.san}. Play on from here.` }); advance(best, best); },
        },
        { label: 'Flip', icon: Icon.flip, onClick: () => setFlipped(!flipped) },
      ]} />
      {outcome && (
        <div className="muted small center">
          {card.title && <p><b>{card.title}</b></p>}
          {src && <p>{[src.white && src.black ? `${src.white} – ${src.black}` : '', src.event, src.timeControl, src.date].filter(Boolean).join(' · ')}</p>}
          {card.shotId && <ShotImage shotId={card.shotId} className="setup-shot" alt="Board from the screenshot" />}
        </div>
      )}
    </div>
  );
}

/** For the Stings page and Home: how many cards a drill would give right now. */
export function useDrillCount() {
  return useLiveQuery(async () => {
    const [cards, cellList] = await Promise.all([db.stings.where('status').equals('ready').toArray(), db.cells.where('key').startsWith('sting:').toArray()]);
    const m = new Map(cellList.map((c) => [c.key, c]));
    return planDrill(cards, m, Date.now(), getStingNew()).length;
  }, []);
}
