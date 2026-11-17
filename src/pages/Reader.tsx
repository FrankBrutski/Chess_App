import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { parseFen } from 'chessops/fen';
import { Chess } from 'chessops/chess';
import { chessgroundDests } from 'chessops/compat';
import { parseSquare } from 'chessops/util';
import { makeSan } from 'chessops/san';
import type { Key } from 'chessground/types';
import { db, chaptersOf } from '../lib/db';
import type { MoveNode, Shape, TreeNode } from '../lib/model';
import { indexTree, docOrder, pathTo, moveNumber, isWhiteMove } from '../lib/tree';
import { annotateChapter } from '../lib/annotations';
import { Board } from '../components/Board';
import { ChapterText, type Ghost } from '../components/ChapterText';
import { navigate } from '../router';
import { getAutoLink, getBoldNotation } from '../lib/prefs';

const strip = (san: string) => san.replace(/[+#!?]/g, '');

function positionOf(fen: string) {
  const setup = parseFen(fen);
  if (setup.isErr) return undefined;
  const pos = Chess.fromSetup(setup.value);
  return pos.isErr ? undefined : pos.value;
}

type Feedback = { kind: 'good' | 'bad' | 'info' | 'done'; text: string } | undefined;

export function Reader({ chapterId, startNodeId }: { chapterId: string; startNodeId?: string }) {
  const chapter = useLiveQuery(() => db.chapters.get(chapterId), [chapterId]);
  const siblings = useLiveQuery(async () => (chapter ? chaptersOf(chapter.courseId) : []), [chapter?.courseId]);
  const course = useLiveQuery(async () => (chapter ? db.courses.get(chapter.courseId) : undefined), [chapter?.courseId]);

  const idx = useMemo(() => (chapter ? indexTree(chapter.root) : undefined), [chapter]);
  const order = useMemo(() => (chapter ? docOrder(chapter.root) : []), [chapter]);
  const orderIndex = useMemo(() => new Map(order.map((id, i) => [id, i])), [order]);
  const annotations = useMemo(() => (chapter ? annotateChapter(chapter.root, { auto: getAutoLink() }) : new Map()), [chapter]);

  const [currentId, setCurrentId] = useState('root');
  const [ghost, setGhost] = useState<Ghost>();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [play, setPlay] = useState<{ frontier: string } | undefined>();
  const [feedback, setFeedback] = useState<Feedback>();
  const [hint, setHint] = useState<Shape[]>([]);
  const [resetKey, setResetKey] = useState(0);
  const textRef = useRef<HTMLDivElement>(null);

  // Reset when switching chapters (or jumping to a spot from the issues list).
  useEffect(() => {
    setCurrentId(startNodeId ?? 'root');
    setGhost(undefined);
    setPlay(undefined);
    setFeedback(undefined);
    setCollapsed(new Set());
    if (!startNodeId) textRef.current?.scrollTo({ top: 0 });
  }, [chapterId, startNodeId]);

  const node: TreeNode | undefined = idx?.byId.get(currentId) ?? chapter?.root;
  const userColor = chapter?.orientation ?? 'white';

  // ----- Visibility in play-along: show everything up to (not including) the next main move -----
  const isVisible = useCallback(
    (id: string) => {
      if (!play || !idx) return true;
      const f = idx.byId.get(play.frontier);
      const next = f?.children[0];
      if (!next) return true;
      const cut = orderIndex.get(next.id) ?? Infinity;
      return (orderIndex.get(id) ?? 0) < cut;
    },
    [play, idx, orderIndex],
  );

  // ----- Navigation -----
  const select = useCallback((id: string) => {
    setGhost(undefined);
    setHint([]);
    setCurrentId(id);
  }, []);

  const stepBack = useCallback(() => {
    if (ghost) {
      if (ghost.index > 0) setGhost({ ...ghost, index: ghost.index - 1 });
      else { setGhost(undefined); setCurrentId(ghost.baseId); }
      return;
    }
    const parent = idx?.parent.get(currentId);
    if (parent) setCurrentId(parent.id);
  }, [ghost, idx, currentId]);

  const stepForward = useCallback(() => {
    if (ghost) {
      if (ghost.index < ghost.line.length - 1) setGhost({ ...ghost, index: ghost.index + 1 });
      return;
    }
    const next = node?.children[0];
    if (!next) return;
    if (play && currentId === play.frontier) return; // in play-along you make the move yourself
    if (!isVisible(next.id)) return;
    setCurrentId(next.id);
  }, [ghost, node, play, currentId, isVisible]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); stepBack(); }
      if (e.key === 'ArrowRight') { e.preventDefault(); stepForward(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stepBack, stepForward]);

  // Keep the current move in view.
  useEffect(() => {
    const el = textRef.current?.querySelector('[data-active], [data-current]') as HTMLElement | null;
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [currentId, ghost, play?.frontier]);

  // ----- Play-along -----
  const startPlay = () => {
    setGhost(undefined);
    setHint([]);
    setPlay({ frontier: currentId });
    setFeedback({ kind: 'info', text: 'Play along: make your moves on the board. The text follows you.' });
  };
  const stopPlay = () => {
    setPlay(undefined);
    setFeedback(undefined);
    setHint([]);
  };

  // Auto-play the opponent's moves.
  useEffect(() => {
    if (!play || !idx) return;
    const f = idx.byId.get(play.frontier);
    const next = f?.children[0];
    if (!f) return;
    if (!next) {
      setFeedback({ kind: 'done', text: 'End of this line. Pick a variation in the text to keep exploring, or restart.' });
      return;
    }
    const isUserMove = (isWhiteMove(next.ply) ? 'white' : 'black') === userColor;
    if (isUserMove) return;
    const t = setTimeout(() => {
      setPlay({ frontier: next.id });
      setCurrentId(next.id);
    }, 550);
    return () => clearTimeout(t);
  }, [play, idx, userColor]);

  const viewing = !!play && (currentId !== play.frontier || !!ghost);
  const frontierNode = play ? idx?.byId.get(play.frontier) : undefined;
  const expected = frontierNode?.children[0];
  const awaitingUser =
    !!play && !viewing && !!expected && (isWhiteMove(expected.ply) ? 'white' : 'black') === userColor;

  const movable = useMemo(() => {
    if (!awaitingUser || !frontierNode) return undefined;
    const pos = positionOf(frontierNode.fen);
    if (!pos) return undefined;
    return { color: userColor, dests: chessgroundDests(pos) as Map<Key, Key[]> };
  }, [awaitingUser, frontierNode, userColor]);

  const onUserMove = useCallback(
    (orig: Key, dest: Key) => {
      if (!frontierNode || !expected) return;
      const pos = positionOf(frontierNode.fen);
      const from = parseSquare(orig);
      let to = parseSquare(dest);
      if (pos === undefined || from === undefined || to === undefined) return;
      // chessground reports castling as king-to-destination; chessops wants king-to-rook.
      const piece = pos.board.get(from);
      if (piece?.role === 'king' && Math.abs(from - to) === 2) to = to > from ? to + 1 : to - 2;
      const promo = /=([QRBN])/.exec(expected.san)?.[1];
      const role = promo ? ({ Q: 'queen', R: 'rook', B: 'bishop', N: 'knight' } as const)[promo as 'Q'] : undefined;
      const isPromo = piece?.role === 'pawn' && (dest[1] === '8' || dest[1] === '1');
      const san = makeSan(pos, { from, to, promotion: isPromo ? role ?? 'queen' : undefined });
      if (strip(san) === strip(expected.san)) {
        setHint([]);
        setFeedback({ kind: 'good', text: `${moveNumber(expected.ply)}${expected.san} ✓` });
        setPlay({ frontier: expected.id });
        setCurrentId(expected.id);
        return;
      }
      const alt = frontierNode.children.find((c) => strip(c.san) === strip(san));
      setFeedback({
        kind: 'bad',
        text: alt
          ? `${san} is covered in the text as a side line. Try the repertoire move.`
          : `${san} isn't the repertoire move. Try again or tap Hint.`,
      });
      // Put the piece back.
      setResetKey((k) => k + 1);
    },
    [frontierNode, expected],
  );

  const showHint = () => {
    if (!expected) return;
    setHint([{ color: 'blue', orig: expected.uci.slice(0, 2) }]);
    if (hint.length) setHint([{ color: 'blue', orig: expected.uci.slice(0, 2), dest: expected.uci.slice(2, 4) }]);
  };

  if (chapter === undefined || !idx || !node) return <div className="page"><p className="muted">Loading…</p></div>;
  if (chapter === null) return <div className="page"><p>Chapter not found.</p></div>;

  const boardFen = ghost ? ghost.line[ghost.index].fen : node.fen;
  const lastMove = ghost ? ghost.line[ghost.index].uci : (node as MoveNode).uci;
  const shapes = ghost ? [] : node.shapes;
  const branches = !ghost && !play && node.children.length > 1 ? node.children : [];
  const chIndex = siblings?.findIndex((c) => c.id === chapter.id) ?? -1;
  const prevCh = chIndex > 0 ? siblings![chIndex - 1] : undefined;
  const nextCh = siblings && chIndex >= 0 && chIndex < siblings.length - 1 ? siblings[chIndex + 1] : undefined;
  const pathLen = currentId === 'root' ? 0 : pathTo(idx, currentId).length;

  return (
    <div className="reader">
      <header className="reader-header">
        <button type="button" className="icon-btn" onClick={() => navigate(`/course/${chapter.courseId}`)} aria-label="Back to course">
          ‹
        </button>
        <div className="reader-title">
          <div className="reader-course">{course?.name}</div>
          <div className="reader-chapter">{chapter.title}</div>
        </div>
        <div className="reader-chapnav">
          <button type="button" className="icon-btn" disabled={!prevCh} onClick={() => prevCh && navigate(`/read/${prevCh.id}`)} aria-label="Previous chapter">⟨</button>
          <button type="button" className="icon-btn" disabled={!nextCh} onClick={() => nextCh && navigate(`/read/${nextCh.id}`)} aria-label="Next chapter">⟩</button>
        </div>
      </header>

      <div className="reader-body">
        <div className="board-pane">
          <Board
            fen={boardFen}
            orientation={chapter.orientation}
            lastMove={lastMove}
            shapes={shapes}
            hintShapes={hint}
            movable={movable}
            onMove={onUserMove}
            resetKey={resetKey}
            check={/[+#]$/.test(ghost ? ghost.line[ghost.index].san : (node as MoveNode).san ?? '')}
          />
          {ghost && (
            <div className="ghost-bar">
              <span>Line from the text</span>
              <button type="button" className="link-btn" onClick={() => { setCurrentId(ghost.baseId); setGhost(undefined); }}>
                Back to the main text
              </button>
            </div>
          )}
          {feedback && (
            <div className={`feedback fb-${feedback.kind}`}>
              <span>{feedback.text}</span>
            </div>
          )}
          {viewing && (
            <div className="ghost-bar">
              <span>Looking around</span>
              <button type="button" className="link-btn" onClick={() => { setGhost(undefined); setCurrentId(play!.frontier); }}>
                Back to your move
              </button>
            </div>
          )}
          <div className="controls">
            <button type="button" onClick={() => select('root')} disabled={!!play} aria-label="Start">⏮</button>
            <button type="button" onClick={stepBack} disabled={!ghost && pathLen === 0} aria-label="Back">◀</button>
            <button type="button" onClick={stepForward} aria-label="Forward">▶</button>
            {play ? (
              <>
                <button type="button" onClick={showHint} disabled={!awaitingUser}>Hint</button>
                <button type="button" className="primary" onClick={stopPlay}>Stop</button>
              </>
            ) : (
              <button type="button" className="primary" onClick={startPlay} disabled={!node.children.length}>
                Play along
              </button>
            )}
          </div>
          {branches.length > 0 && (
            <div className="branches">
              {branches.map((b) => (
                <button key={b.id} type="button" className="branch-btn" onClick={() => select(b.id)}>
                  {moveNumber(b.ply)}{b.san}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="text-pane" ref={textRef}>
          <ChapterText
            root={chapter.root}
            annotations={annotations}
            currentId={currentId}
            ghost={ghost}
            isVisible={isVisible}
            collapsed={collapsed}
            onToggle={(id) =>
              setCollapsed((s) => {
                const n = new Set(s);
                if (n.has(id)) n.delete(id);
                else n.add(id);
                return n;
              })
            }
            onSelect={(id) => select(id)}
            onGhost={(g) => { setHint([]); setGhost(g); }}
            boldNotation={getBoldNotation()}
          />
          {play && feedback?.kind === 'done' && (
            <div className="done-actions">
              <button type="button" onClick={() => { select('root'); setPlay({ frontier: 'root' }); setFeedback(undefined); }}>
                Restart chapter
              </button>
              <button type="button" onClick={stopPlay}>Back to reading</button>
            </div>
          )}
          <div className="text-end-spacer" />
        </div>
      </div>
    </div>
  );
}
