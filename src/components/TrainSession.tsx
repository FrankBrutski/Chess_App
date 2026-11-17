import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Key } from 'chessground/types';
import type { Chapter, Shape } from '../lib/model';
import { annotateChapter } from '../lib/annotations';
import { isUserMove } from '../lib/lines';
import { learnCell, retryFrontier, reviewCell, type Cell, type TrainLine } from '../lib/srs';
import { db, addHoney } from '../lib/db';
import { destsOf, sanOfBoardMove, stripSan } from '../lib/boardMove';
import { moveNumber } from '../lib/tree';
import {
  getAutoLink, getBoldNotation, getHoneyLearn, getHoneyReview, getLadder, getMissPolicy, getRetryBack,
  getReviewNotes, getShowNewMoves,
} from '../lib/prefs';
import { Board } from './Board';
import { LineText } from './LineText';
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
}

type Feedback = { kind: 'good' | 'bad' | 'info' | 'done'; text: string } | undefined;

interface Tally { honey: number; right: number; wrong: number; learned: number; lines: number }

export function TrainSession({ mode, items, chapters, cells: startCells, onExit }: Props) {
  const ladder = useMemo(getLadder, []);
  const policy = useMemo(getMissPolicy, []);
  const retryBack = useMemo(getRetryBack, []);
  const showNotes = mode === 'learn' || getReviewNotes();
  const showNew = mode === 'learn' && getShowNewMoves();

  const cells = useRef(new Map(startCells));
  const [qi, setQi] = useState(0);
  const item = items[qi];
  const t = item?.t;
  const chapter = t ? chapters.get(t.chapterId) : undefined;
  const nodes = t?.line.nodes ?? [];
  const annotations = useMemo(() => (chapter ? annotateChapter(chapter.root, { auto: getAutoLink() }) : new Map()), [chapter]);

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
  const [feedback, setFeedback] = useState<Feedback>();
  const [hint, setHint] = useState<Shape[]>([]);
  const [resetKey, setResetKey] = useState(0);
  const [lineDone, setLineDone] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Keys already answered in this line (first try counts). */
  const answered = useRef(new Map<string, boolean>());
  /** During a retry, every one of your moves up to and including this index is asked again. */
  const [retryUntil, setRetryUntil] = useState(-1);
  const [tally, setTally] = useState<Tally>({ honey: 0, right: 0, wrong: 0, learned: 0, lines: 0 });

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
    answered.current = new Map();
    setFeedback(
      t
        ? { kind: 'info', text: mode === 'learn' ? `Learn: ${askSet.size} new move${askSet.size === 1 ? '' : 's'}. Play your moves; the notes follow you.` : `Review: ${askSet.size} move${askSet.size === 1 ? '' : 's'} due in this line.` }
        : undefined,
    );
  }

  const next = nodes[frontier + 1];
  const isAsked = (i: number) => {
    const n = nodes[i];
    if (!n || !t || !isUserMove(n, t.color)) return false;
    return i <= retryUntil || askSet.has(n.key);
  };
  const awaiting = !!next && !lineDone && isAsked(frontier + 1) && viewIdx === undefined && !busy;

  // Play the opponent's moves and your moves that aren't being asked.
  useEffect(() => {
    if (!t || lineDone || busy || shownQi !== qi) return;
    if (!next) {
      void finishLine();
      return;
    }
    if (isAsked(frontier + 1)) {
      if (showNew && !cells.current.has(next.key) && !answered.current.has(next.key)) {
        setHint([{ color: 'green', orig: next.uci.slice(0, 2), dest: next.uci.slice(2, 4) }]);
      }
      return;
    }
    const delay = isUserMove(next, t.color) ? 300 : 500;
    const timer = setTimeout(() => { setFrontier((f) => f + 1); setViewIdx(undefined); }, delay);
    return () => clearTimeout(timer);
  }, [frontier, qi, shownQi, lineDone, busy, retryUntil]); // eslint-disable-line react-hooks/exhaustive-deps

  const finishLine = async () => {
    if (!t) return;
    setLineDone(true);
    setHint([]);
    const now = Date.now();
    let honey = 0;
    let learned = 0;
    if (mode === 'learn') {
      const fresh = [...askSet].filter((k) => !cells.current.has(k)).map((k) => learnCell(k, now, ladder));
      fresh.forEach((c) => cells.current.set(c.key, c));
      await db.cells.bulkPut(fresh);
      learned = fresh.length;
      honey = learned * getHoneyLearn();
      await addHoney(honey);
    }
    setTally((s) => ({ ...s, honey: s.honey + honey, learned: s.learned + learned, lines: s.lines + 1 }));
    setFeedback({
      kind: 'done',
      text: mode === 'learn' ? `Line learned: +${honey} honey. First review in ${fmtWait(ladder[0])}.` : `Line reviewed.`,
    });
  };

  const record = async (key: string, correct: boolean) => {
    if (mode !== 'review' || !askSet.has(key) || answered.current.has(key)) return;
    answered.current.set(key, correct);
    const c = cells.current.get(key);
    if (!c) return;
    const updated = reviewCell(c, correct, Date.now(), ladder, policy);
    cells.current.set(key, updated);
    await db.cells.put(updated);
    const honey = correct ? getHoneyReview() : 0;
    if (honey) await addHoney(honey);
    setTally((s) => ({ ...s, honey: s.honey + honey, right: s.right + (correct ? 1 : 0), wrong: s.wrong + (correct ? 0 : 1) }));
  };

  const fenAt = (i: number) => (i < 0 ? chapter?.root.fen ?? '' : nodes[i].fen);

  const onMove = useCallback(
    (orig: Key, dest: Key) => {
      if (!awaiting || !next) return;
      const san = sanOfBoardMove(fenAt(frontier), orig, dest, next.san);
      if (!san) return;
      const i = frontier + 1;
      if (stripSan(san) === stripSan(next.san)) {
        setHint([]);
        void record(next.key, true);
        if (mode === 'learn') answered.current.set(next.key, true);
        if (i >= retryUntil) setRetryUntil(-1);
        setFeedback({ kind: 'good', text: `${moveNumber(next.ply)}${next.san} ✓` });
        setFrontier(i);
        return;
      }
      // Wrong: show the move, then replay from a couple of your moves back.
      void record(next.key, false);
      answered.current.set(next.key, false);
      setTally((s) => (mode === 'learn' ? { ...s, wrong: s.wrong + 1 } : s));
      setFeedback({ kind: 'bad', text: `${san} isn't it. The move is ${moveNumber(next.ply)}${next.san}.` });
      setHint([{ color: 'green', orig: next.uci.slice(0, 2), dest: next.uci.slice(2, 4) }]);
      setResetKey((k) => k + 1);
      setBusy(true);
      setTimeout(() => {
        setHint([]);
        setRetryUntil(i);
        setFrontier(retryFrontier(t!, i, retryBack));
        setFeedback({ kind: 'info', text: retryBack ? `Again from ${retryBack} of your moves back.` : 'Try it again.' });
        setBusy(false);
      }, 1600);
    },
    [awaiting, next, frontier, retryUntil, mode, retryBack, t], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const showMe = () => {
    if (!next) return;
    if (mode === 'review') void record(next.key, false);
    setHint([{ color: 'green', orig: next.uci.slice(0, 2), dest: next.uci.slice(2, 4) }]);
  };

  if (shownQi !== qi) return null;
  if (!t || !chapter) {
    return (
      <div className="page">
        <h1>{mode === 'learn' ? 'Learning done' : 'Review done'}</h1>
        <Summary tally={tally} mode={mode} />
        <button type="button" className="primary wide" onClick={onExit}>Back to training</button>
      </div>
    );
  }

  const shownIdx = viewIdx ?? frontier;
  const boardFen = ghost ? ghost.line[ghost.index].fen : fenAt(shownIdx);
  const lastMove = ghost ? ghost.line[ghost.index].uci : shownIdx >= 0 ? nodes[shownIdx].uci : undefined;
  const currentId = shownIdx >= 0 ? nodes[shownIdx].id : 'root';

  return (
    <div className="reader train">
      <header className="reader-header">
        <button type="button" className="icon-btn" onClick={onExit} aria-label="End session" title="End session">✕</button>
        <div className="reader-title">
          <div className="reader-course">
            {mode === 'learn' ? 'Learn' : 'Review'} · line {qi + 1} of {items.length} · {tally.honey} honey
          </div>
          <div className="reader-chapter">{t.combTitle}: {t.line.name}</div>
        </div>
        <span className="icon-btn" aria-hidden="true" />
      </header>
      <div className="reader-body">
        <div className="board-pane">
          <Board
            fen={boardFen}
            orientation={t.color}
            lastMove={lastMove}
            shapes={!ghost && shownIdx >= 0 && (lineDone || mode === 'learn') ? nodes[shownIdx].shapes : []}
            hintShapes={hint}
            movable={awaiting ? { color: t.color, dests: destsOf(fenAt(frontier)) } : undefined}
            onMove={onMove}
            resetKey={resetKey}
            check={/[+#]$/.test(ghost ? ghost.line[ghost.index].san : shownIdx >= 0 ? nodes[shownIdx].san : '')}
          />
          {feedback && <div className={`feedback fb-${feedback.kind}`}><span>{feedback.text}</span></div>}
          {(viewIdx !== undefined || ghost) && !lineDone && (
            <div className="ghost-bar">
              <span>Looking around</span>
              <button type="button" className="link-btn" onClick={() => { setViewIdx(undefined); setGhost(undefined); }}>Back to your move</button>
            </div>
          )}
          <div className="controls">
            {lineDone ? (
              <button type="button" className="primary" onClick={() => setQi(qi + 1)}>
                {qi + 1 < items.length ? 'Next line' : 'Finish'}
              </button>
            ) : (
              <>
                <button type="button" onClick={showMe} disabled={!awaiting}>Show me</button>
                <button type="button" onClick={() => setQi(qi + 1)} title="Skip this line">Skip</button>
              </>
            )}
          </div>
        </div>
        <div className="text-pane">
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
            />
          ) : (
            <p className="muted small">Notes are hidden during reviews (Settings → Training). They show when the line is done.</p>
          )}
          {lineDone && <Summary tally={tally} mode={mode} />}
          <div className="text-end-spacer" />
        </div>
      </div>
    </div>
  );
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
