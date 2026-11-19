import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Key } from 'chessground/types';
import type { Chapter, Shape } from '../lib/model';
import { annotateChapter } from '../lib/annotations';
import { isUserMove, splitLines } from '../lib/lines';
import { learnCell, quizHoney, retryFrontier, reviewCell, reviewHoney, type Cell, type TrainLine } from '../lib/srs';
import { db, addHoney } from '../lib/db';
import { destsOf, sanOfBoardMove, stripSan } from '../lib/boardMove';
import {
  getAutoLink, getBoldNotation, getEngineOn, getLadder, getLineOrder, getMissPolicy, getMoveSeconds, getQuizTries,
  getRetryBack, getReviewNotes, getShowNewMoves, setEngineOn,
} from '../lib/prefs';
import { navigate } from '../router';
import { Board } from './Board';
import { LineText } from './LineText';
import { EnginePanel } from './EnginePanel';
import { Icon, Toolbar } from './Toolbar';
import type { Ghost } from './ChapterText';

export interface SessionItem {
  t: TrainLine;
  /** Review: the move keys to ask. Learn: undefined (new moves are asked). */
  ask?: Set<string>;
}

interface Props {
  mode: 'learn' | 'review';
  items: SessionItem[];
  chapters: Map<string, Chapter>;
  cells: Map<string, Cell>;
  onExit: () => void;
  /** Label for the button on the done screen (default: Back to training). */
  exitLabel?: string;
}

interface Tally { honey: number; right: number; wrong: number; learned: number; lines: number }

/**
 * The trainer. Learn plays each new line `tries` times in a row (Quiz 1/3, 2/3, 3/3); a clean
 * try n pays n honey per new move, and a miss starts the line over at try 1. Review asks the due
 * moves once; a right move pays more the further up the ladder it is.
 */
export function TrainSession({ mode, items, chapters, cells: startCells, onExit, exitLabel }: Props) {
  const ladder = useMemo(getLadder, []);
  const policy = useMemo(getMissPolicy, []);
  const retryBack = useMemo(getRetryBack, []);
  const tries = useMemo(getQuizTries, []);
  const moveSecs = useMemo(getMoveSeconds, []);
  const showNotes = mode === 'learn' || getReviewNotes();
  const showNew = mode === 'learn' && getShowNewMoves();

  const cells = useRef(new Map(startCells));
  const [qi, setQi] = useState(0);
  const item = items[qi];
  const t = item?.t;
  const chapter = t ? chapters.get(t.chapterId) : undefined;
  const nodes = t?.line.nodes ?? [];
  const annotations = useMemo(() => (chapter ? annotateChapter(chapter.root, { auto: getAutoLink() }) : new Map()), [chapter]);
  const hive = useLiveQuery(async () => (t ? db.courses.get(t.hiveId) : undefined), [t?.hiveId]);
  const lineCount = useMemo(
    () => (chapter ? splitLines(chapter.root, chapter.orientation, { names: chapter.lineNames, order: getLineOrder(), custom: chapter.lineOrder }).length : 0),
    [chapter],
  );

  // Which of your moves this line asks for.
  const askSet = useMemo(() => {
    if (!t) return new Set<string>();
    if (item.ask) return item.ask;
    return new Set(nodes.filter((n) => isUserMove(n, t.color) && !cells.current.has(n.key)).map((n) => n.key));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qi]);

  const [frontier, setFrontier] = useState(-1);
  const [viewIdx, setViewIdx] = useState<number>();
  const [ghost, setGhost] = useState<Ghost>();
  const [hint, setHint] = useState<Shape[]>([]);
  const [resetKey, setResetKey] = useState(0);
  const [lineDone, setLineDone] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Learn: the immediate try (1..tries) being played. */
  const [tryNo, setTryNo] = useState(1);
  const [doneText, setDoneText] = useState('');
  /** Review keys already answered (first try counts). */
  const answered = useRef(new Map<string, boolean>());
  /** Learn: new moves you have played right at least once (their arrow stops showing). */
  const seen = useRef(new Set<string>());
  /** Review: during a retry, every one of your moves up to and including this index is asked again. */
  const [retryUntil, setRetryUntil] = useState(-1);
  const [tally, setTally] = useState<Tally>({ honey: 0, right: 0, wrong: 0, learned: 0, lines: 0 });
  const [paused, setPaused] = useState(false);
  const [engineOn, setEngineOnState] = useState(getEngineOn);
  const toggleEngine = () => { setEngineOn(!engineOn); setEngineOnState(!engineOn); };

  // Reset per-line state as soon as the line changes (during render, so no effect sees the old line's position).
  const [shownQi, setShownQi] = useState(-1);
  if (shownQi !== qi) {
    setShownQi(qi);
    setFrontier(-1);
    setViewIdx(undefined);
    setGhost(undefined);
    setHint([]);
    setLineDone(false);
    setRetryUntil(-1);
    setBusy(false);
    setTryNo(1);
    setDoneText('');
    answered.current = new Map();
    seen.current = new Set();
  }

  const next = nodes[frontier + 1];
  const isAsked = (i: number) => {
    const n = nodes[i];
    if (!n || !t || !isUserMove(n, t.color)) return false;
    return i <= retryUntil || askSet.has(n.key);
  };
  const awaiting = !!next && !lineDone && isAsked(frontier + 1) && viewIdx === undefined && !ghost && !busy;
  // Stable props for the board: the clock re-renders this screen several times a second, and a new
  // object would reset the board (dropping a piece you have just tapped).
  const movable = useMemo(
    () => (awaiting && t ? { color: t.color, dests: destsOf(frontier < 0 ? chapter?.root.fen ?? '' : nodes[frontier].fen) } : undefined),
    [awaiting, frontier, qi, tryNo], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Play the opponent's moves and your moves that aren't being asked.
  useEffect(() => {
    if (!t || lineDone || busy || shownQi !== qi) return;
    if (!next) {
      void finishTry();
      return;
    }
    if (isAsked(frontier + 1)) {
      if (showNew && !seen.current.has(next.key)) {
        setHint([{ color: 'green', orig: next.uci.slice(0, 2), dest: next.uci.slice(2, 4) }]);
      }
      return;
    }
    const delay = isUserMove(next, t.color) ? 300 : 500;
    const timer = setTimeout(() => { setFrontier((f) => f + 1); setViewIdx(undefined); }, delay);
    return () => clearTimeout(timer);
  }, [frontier, qi, shownQi, lineDone, busy, retryUntil, tryNo]); // eslint-disable-line react-hooks/exhaustive-deps

  // The move clock: runs while a quiz move is waiting, unless paused or the engine is open.
  const [left, setLeft] = useState(moveSecs);
  const timing = moveSecs > 0 && awaiting && !paused && !engineOn;
  useEffect(() => { setLeft(moveSecs); }, [frontier, qi, tryNo, resetKey, moveSecs]);
  useEffect(() => {
    if (!timing) return;
    let last = Date.now();
    const id = setInterval(() => {
      const now = Date.now();
      const dt = Math.min(1000, now - last) / 1000; // time spent in the background doesn't count
      last = now;
      setLeft((l) => Math.max(0, l - dt));
    }, 200);
    return () => clearInterval(id);
  }, [timing]);
  useEffect(() => {
    if (timing && left <= 0) miss(false);
  }, [left, timing]); // eslint-disable-line react-hooks/exhaustive-deps

  /** End of a pass through the line. Learn: pay this try, then go again or save the moves. */
  const finishTry = async () => {
    if (!t) return;
    setHint([]);
    if (mode === 'review') {
      setLineDone(true);
      setTally((s) => ({ ...s, lines: s.lines + 1 }));
      setDoneText('Line reviewed.');
      return;
    }
    const honey = askSet.size * quizHoney(tryNo);
    if (honey) await addHoney(honey);
    setTally((s) => ({ ...s, honey: s.honey + honey }));
    if (tryNo < tries && askSet.size > 0) {
      setBusy(true);
      setTimeout(() => {
        setTryNo((n) => n + 1);
        setFrontier(-1);
        setViewIdx(undefined);
        setGhost(undefined);
        setBusy(false);
      }, 700);
      return;
    }
    setLineDone(true);
    const now = Date.now();
    const fresh = [...askSet].filter((k) => !cells.current.has(k)).map((k) => learnCell(k, now, ladder));
    fresh.forEach((c) => cells.current.set(c.key, c));
    await db.cells.bulkPut(fresh);
    setTally((s) => ({ ...s, learned: s.learned + fresh.length, lines: s.lines + 1 }));
    setDoneText(fresh.length ? `Line learned. First review in ${fmtWait(ladder[0])}.` : 'Line played.');
  };

  const record = async (key: string, correct: boolean) => {
    if (mode !== 'review' || !askSet.has(key) || answered.current.has(key)) return;
    answered.current.set(key, correct);
    const c = cells.current.get(key);
    if (!c) return;
    const honey = correct ? reviewHoney(c, tries) : 0;
    const updated = reviewCell(c, correct, Date.now(), ladder, policy);
    cells.current.set(key, updated);
    await db.cells.put(updated);
    if (honey) await addHoney(honey);
    setTally((s) => ({ ...s, honey: s.honey + honey, right: s.right + (correct ? 1 : 0), wrong: s.wrong + (correct ? 0 : 1) }));
  };

  const fenAt = (i: number) => (i < 0 ? chapter?.root.fen ?? '' : nodes[i].fen);

  /** A wrong move, or the clock ran out: show the move, then go again. */
  const miss = (played: boolean) => {
    if (!next || !t) return;
    const i = frontier + 1;
    void record(next.key, false);
    if (mode === 'learn') setTally((s) => ({ ...s, wrong: s.wrong + 1 }));
    setHint([{ color: 'green', orig: next.uci.slice(0, 2), dest: next.uci.slice(2, 4) }]);
    if (played) setResetKey((k) => k + 1);
    setBusy(true);
    setTimeout(() => {
      setHint([]);
      setLeft(moveSecs);
      if (mode === 'learn') {
        // Learn: the line starts over and the honey goes back to try 1.
        setTryNo(1);
        setFrontier(-1);
      } else {
        setRetryUntil(i);
        setFrontier(retryFrontier(t, i, retryBack));
      }
      setBusy(false);
    }, 1600);
  };

  const onMove = useCallback(
    (orig: Key, dest: Key) => {
      if (!awaiting || !next) return;
      const san = sanOfBoardMove(fenAt(frontier), orig, dest, next.san);
      if (!san) return;
      const i = frontier + 1;
      if (stripSan(san) === stripSan(next.san)) {
        setHint([]);
        void record(next.key, true);
        seen.current.add(next.key);
        if (i >= retryUntil) setRetryUntil(-1);
        setFrontier(i);
        return;
      }
      miss(true);
    },
    [awaiting, next, frontier, retryUntil, mode, retryBack, t, tryNo], // eslint-disable-line react-hooks/exhaustive-deps
  );

  if (shownQi !== qi) return null;
  if (!t || !chapter) {
    return (
      <div className="page">
        <h1>{mode === 'learn' ? 'Learning done' : 'Review done'}</h1>
        <Summary tally={tally} mode={mode} />
        <button type="button" className="primary wide" onClick={onExit}>{exitLabel ?? 'Back to training'}</button>
      </div>
    );
  }

  const shownIdx = viewIdx ?? frontier;
  const boardFen = ghost ? ghost.line[ghost.index].fen : fenAt(shownIdx);
  const lastMove = ghost ? ghost.line[ghost.index].uci : shownIdx >= 0 ? nodes[shownIdx].uci : undefined;
  const currentId = shownIdx >= 0 ? nodes[shownIdx].id : 'root';
  const toPlay = t.color === 'white' ? 'White to play' : 'Black to play';

  return (
    <div className="reader train">
      <header className="reader-header">
        <button type="button" className="icon-btn" onClick={onExit} aria-label="End session" title="End session">✕</button>
        <h1 className="reader-hive-title">{hive?.name ?? t.combTitle}</h1>
        <span className="train-honey" title="Honey this session">🍯 {tally.honey}</span>
      </header>
      <div className="reader-body">
        <div className="board-pane">
          <Board
            fen={boardFen}
            orientation={t.color}
            lastMove={lastMove}
            shapes={!ghost && shownIdx >= 0 && (lineDone || mode === 'learn') ? nodes[shownIdx].shapes : NO_SHAPES}
            hintShapes={hint}
            movable={movable}
            onMove={onMove}
            resetKey={resetKey}
            check={/[+#]$/.test(ghost ? ghost.line[ghost.index].san : shownIdx >= 0 ? nodes[shownIdx].san : '')}
          />
          {moveSecs > 0 && !lineDone && (
            <div className={`move-timer${paused ? ' paused' : ''}${left < 10 ? ' low' : ''}`} role="timer" aria-label="Time for this move">
              <div className="move-timer-track"><i style={{ width: `${(left / moveSecs) * 100}%` }} /></div>
              <span>{paused ? 'Paused' : fmtClock(left)}</span>
            </div>
          )}
          {(viewIdx !== undefined || ghost) && !lineDone && (
            <div className="ghost-bar">
              <span>{ghost?.source === 'engine' ? 'Engine line' : 'Looking around'}</span>
              <button type="button" className="link-btn" onClick={() => { setViewIdx(undefined); setGhost(undefined); }}>Back to your move</button>
            </div>
          )}
          {engineOn && (
            <EnginePanel
              fen={boardFen}
              paused={false}
              onPlayLine={(line) => setGhost({ line, index: 0, baseId: currentId, source: 'engine' })}
            />
          )}
        </div>
        <div className="text-pane sheet">
          <div className="sheet-handle" aria-hidden="true" />
          <div className="sheet-title">
            <h2>{t.combTitle}</h2>
            <p><span className="line-num">Line {t.line.number}/{lineCount}</span> {t.line.name}</p>
          </div>
          {lineDone ? (
            <div className="train-done">
              <p>{doneText}</p>
              <Summary tally={tally} mode={mode} />
              <button type="button" className="primary wide" onClick={() => setQi(qi + 1)}>
                {qi + 1 < items.length ? 'Next line' : 'Finish'}
              </button>
            </div>
          ) : (
            <p className="quiz-line">
              <b>{mode === 'learn' ? `Quiz ${tryNo}/${tries}` : 'Review'}</b>
              <span className="muted"> · {toPlay}{mode === 'learn' ? ` · +${quizHoney(tryNo)} 🍯 a move` : ''}</span>
              {items.length > 1 && <span className="muted"> · line {qi + 1} of {items.length}</span>}
            </p>
          )}
          {showNotes || lineDone ? (
            <LineText
              key={`${qi}`}
              root={chapter.root}
              line={t.line}
              lines={[t.line]}
              annotations={annotations}
              currentId={ghost ? '' : currentId}
              ghost={ghost}
              visibleUpTo={lineDone ? undefined : frontier}
              onSelect={(id) => {
                const i = nodes.findIndex((n) => n.id === id);
                setGhost(undefined);
                setViewIdx(i === frontier ? undefined : i);
              }}
              onGhost={(g) => setGhost(g)}
              onOpenLine={() => {}}
              boldNotation={getBoldNotation()}
              hideBranches
              hideTrunk
            />
          ) : (
            <p className="muted small">Notes are hidden during reviews (Settings → Training). They show when the line is done.</p>
          )}
          <div className="text-end-spacer" />
        </div>
      </div>
      <Toolbar
        items={[
          { label: 'Engine', icon: Icon.engine, onClick: toggleEngine, pressed: engineOn, title: 'Stockfish evaluation (runs on this phone). Stops the clock.' },
          { label: 'Read', icon: Icon.read, onClick: () => navigate(`/line/${t.chapterId}/${encodeURIComponent(t.line.id)}`), title: 'Leave the quiz and read this line' },
          {
            label: paused ? 'Resume' : 'Pause',
            icon: paused ? Icon.play : Icon.pause,
            onClick: () => setPaused(!paused),
            disabled: moveSecs === 0 || lineDone,
            pressed: paused,
            title: 'Pause the move clock',
          },
        ]}
      />
    </div>
  );
}

const NO_SHAPES: Shape[] = [];

function fmtClock(s: number) {
  const n = Math.ceil(s);
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
}

function fmtWait(ms: number) {
  const h = ms / 3_600_000;
  return h < 24 ? `${Math.round(h)} hours` : `${Math.round(h / 24)} days`;
}

function Summary({ tally, mode }: { tally: Tally; mode: 'learn' | 'review' }) {
  return (
    <p className="session-summary">
      {tally.lines} line{tally.lines === 1 ? '' : 's'} ·{' '}
      {mode === 'learn' ? `${tally.learned} moves learned` : `${tally.right} right, ${tally.wrong} missed`} · {tally.honey} honey
    </p>
  );
}
