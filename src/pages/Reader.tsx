import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { turnOf } from '../lib/fen';
import type { MoveNode, TreeNode } from '../lib/model';
import { indexTree, pathTo, moveNumber } from '../lib/tree';
import { annotateChapter } from '../lib/annotations';
import { Board } from '../components/Board';
import { ChapterText, type Ghost } from '../components/ChapterText';
import { navigate } from '../router';
import { buildIndex, lookup } from '../lib/positions';
import { getFlipReader, getAutoLink, getBoldNotation, getEngineOn, getLineOrder, getShowMarkers, setEngineOn } from '../lib/prefs';
import { EnginePanel } from '../components/EnginePanel';
import { LineText } from '../components/LineText';
import { Icon, Toolbar } from '../components/Toolbar';
import { splitLines, type Line } from '../lib/lines';
import { destsOf, positionOf, sanOfBoardMove, stripSan } from '../lib/boardMove';
import { parseSan, makeSanAndPlay } from 'chessops/san';
import { makeFen } from 'chessops/fen';
import { makeUci } from 'chessops/util';
import type { Key } from 'chessground/types';
import type { GhostMove } from '../lib/commentMoves';

export function Reader({ chapterId, startNodeId, lineId, lineNodeId }: { chapterId: string; startNodeId?: string; lineId?: string; lineNodeId?: string }) {
  const chapter = useLiveQuery(() => db.chapters.get(chapterId), [chapterId]);
  const course = useLiveQuery(async () => (chapter ? db.courses.get(chapter.courseId) : undefined), [chapter?.courseId]);

  const idx = useMemo(() => (chapter ? indexTree(chapter.root) : undefined), [chapter]);
  const annotations = useMemo(() => (chapter ? annotateChapter(chapter.root, { auto: getAutoLink() }) : new Map()), [chapter]);
  const lines = useMemo(() => (chapter ? splitLines(chapter.root, chapter.orientation, { names: chapter.lineNames, order: getLineOrder(), custom: chapter.lineOrder }) : []), [chapter]);
  // Line view (one line at a time, Chessable style) is the default; "Whole study" shows the full tree.
  const [mode, setMode] = useState<'line' | 'study'>(startNodeId ? 'study' : 'line');
  const [lineKey, setLineKey] = useState(lineId ?? 'main');
  const flipped = getFlipReader();
  // Transpositions: the same position elsewhere in your repertoire.
  const showMarkers = getShowMarkers();
  const allHives = useLiveQuery(() => (showMarkers ? db.courses.toArray() : []), [showMarkers]);
  const allCombs = useLiveQuery(() => (showMarkers ? db.chapters.toArray() : []), [showMarkers]);
  const posIndex = useMemo(() => (allHives && allCombs && showMarkers ? buildIndex(allHives, allCombs, { order: getLineOrder() }) : undefined), [allHives, allCombs, showMarkers]);
  const line: Line | undefined = mode === 'line' ? lines.find((l) => l.id === lineKey) ?? lines.find((l) => l.id === 'main') ?? lines[0] : undefined;
  const lineIndex = useMemo(() => new Map(line?.nodes.map((n, i) => [n.id, i]) ?? []), [line]);

  const [currentId, setCurrentId] = useState('root');
  const [ghost, setGhost] = useState<Ghost>();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [engineOn, setEngineOnState] = useState(getEngineOn());
  const toggleEngine = () => { setEngineOn(!engineOn); setEngineOnState(!engineOn); };
  const textRef = useRef<HTMLDivElement>(null);

  // Reset when switching chapters (or jumping to a spot from the issues list).
  useEffect(() => {
    setCurrentId(startNodeId ?? lineNodeId ?? 'root');
    setMode(startNodeId ? 'study' : 'line');
    setLineKey(lineId ?? 'main');
    setGhost(undefined);
    setCollapsed(new Set());
    if (!startNodeId) textRef.current?.scrollTo({ top: 0 });
  }, [chapterId, startNodeId, lineId, lineNodeId]);

  const node: TreeNode | undefined = idx?.byId.get(currentId) ?? chapter?.root;

  /** The move after `id`: along the open line in line view, else the main continuation. */
  const nextOf = useCallback(
    (id: string): MoveNode | undefined => {
      if (line) return line.nodes[(id === 'root' ? -1 : lineIndex.get(id) ?? -2) + 1];
      return idx?.byId.get(id)?.children[0];
    },
    [line, lineIndex, idx],
  );

  // ----- Navigation -----
  const select = useCallback((id: string) => {
    setGhost(undefined);
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
    const next = nextOf(currentId);
    if (next) setCurrentId(next.id);
  }, [ghost, nextOf, currentId]);

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
  }, [currentId, ghost]);

  if (chapter === undefined || !idx || !node) return <div className="page"><p className="muted">Loading…</p></div>;
  if (chapter === null) return <div className="page"><p>Comb not found.</p></div>;

  const boardFen = ghost ? ghost.line[ghost.index].fen : node.fen;
  const lastMove = ghost ? ghost.line[ghost.index].uci : (node as MoveNode).uci;
  const shapes = ghost ? [] : node.shapes;
  const branches = !line && !ghost && node.children.length > 1 ? node.children : [];
  const openLine = (l: Line) => {
    setGhost(undefined);
    setMode('line');
    setLineKey(l.id);
    // Show the position where the line branches off.
    setCurrentId(l.shared > 0 ? l.nodes[l.shared - 1].id : 'root');
    textRef.current?.scrollTo({ top: 0 });
  };
  // With the engine open, the board is an analysis board: play any legal move and the evaluation follows.
  // A move that is the next study move just steps forward; anything else plays on from here as a side line,
  // and Back takes those moves back one by one, to where you started.
  const turn = turnOf(boardFen);
  const movable = engineOn ? { color: turn as 'white' | 'black', dests: destsOf(boardFen) } : undefined;
  const playOnBoard = (orig: Key, dest: Key) => {
    const san = sanOfBoardMove(boardFen, orig as Key, dest as Key);
    if (!san) return;
    if (!ghost) {
      const next = nextOf(currentId) ?? node.children.find((c) => stripSan(c.san) === stripSan(san));
      if (next && stripSan(next.san) === stripSan(san)) { setCurrentId(next.id); return; }
    }
    const pos = positionOf(boardFen);
    const move = pos && parseSan(pos, san);
    if (!pos || !move) return;
    const uci = makeUci(move);
    const played = makeSanAndPlay(pos, move);
    const prior: GhostMove[] = ghost ? ghost.line.slice(0, ghost.index + 1) : [];
    const ply = ghost ? ghost.line[ghost.index].ply + 1 : ('ply' in node ? node.ply : 0) + 1;
    const g: GhostMove = { san: played, uci, fen: makeFen(pos.toSetup()), ply };
    // Same move as the line already shown: just step along it.
    if (ghost && ghost.line[ghost.index + 1]?.uci === uci) { setGhost({ ...ghost, index: ghost.index + 1 }); return; }
    setGhost({ line: [...prior, g], index: prior.length, baseId: ghost?.baseId ?? currentId, source: 'board' });
  };
  const pathLen = currentId === 'root' ? 0 : pathTo(idx, currentId).length;
  return (
    <div className="reader">
      <div className="reader-top">
      <header className="reader-header">
        <button type="button" className="icon-btn" onClick={() => navigate(`/comb/${chapter.id}`)} aria-label="Back to the lines" title="Back to the lines">
          ‹
        </button>
        <h1 className="reader-hive-title">{course?.name ?? chapter.title}</h1>
        <button type="button" className="icon-btn" onClick={() => navigate('/settings')} aria-label="Settings">{Icon.settings}</button>
      </header>

      </div>

      <div className="reader-body">
        <div className="board-pane">
          <Board
            fen={boardFen}
            orientation={flipped ? (chapter.orientation === 'white' ? 'black' : 'white') : chapter.orientation}
            lastMove={lastMove}
            shapes={shapes}
            check={/[+#]$/.test(ghost ? ghost.line[ghost.index].san : (node as MoveNode).san ?? '')}
            movable={movable}
            onMove={playOnBoard}
          />
          {engineOn && (
            <EnginePanel
              fen={boardFen}
              paused={false}
              onPlayLine={ghost ? undefined : (line) => setGhost({ line, index: 0, baseId: currentId, source: 'engine' })}
            />
          )}
        </div>

        <div className="text-pane sheet" ref={textRef}>
          <div className="sheet-handle" aria-hidden="true" />
          <div className="sheet-title">
            <h2>{chapter.title}</h2>
            <p>{line ? <><span className="line-num">Line {line.number}/{lines.length}</span> {line.name}</> : <>Whole study · {lines.length} lines</>}</p>
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
          {line ? (
            <LineText
              key={line.id}
              root={chapter.root}
              line={line}
              lines={lines}
              annotations={annotations}
              currentId={currentId}
              ghost={ghost}
              onSelect={(id) => select(id)}
              onGhost={setGhost}
              onOpenLine={openLine}
              boldNotation={getBoldNotation()}
              showMarkers={showMarkers}
              elsewhere={posIndex ? (n) =>
                lookup(posIndex, n.fen)
                  // A real transposition: reached there by a different last move or from a different position.
                  // (Every comb that starts 1.e4 e5 2.Nf3 shares those moves; that's not worth a marker.)
                  .filter((h) => !('key' in h.node) || h.node.key !== n.key)
                  .map((h) => ({
                    label: `${h.hive.name} › ${h.chapter.title}, line ${h.line.number}`,
                    open: () => navigate(`/line/${h.chapter.id}/${encodeURIComponent(h.line.id)}/${h.node.id}`),
                  }))
              : undefined}
            />
          ) : (
          <ChapterText
            root={chapter.root}
            annotations={annotations}
            currentId={currentId}
            ghost={ghost}
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
            onGhost={setGhost}
            boldNotation={getBoldNotation()}
          />
          )}
          <div className="text-end-spacer" />
        </div>
      </div>
      <Toolbar
        items={[
          { label: 'Engine', icon: Icon.engine, onClick: toggleEngine, pressed: engineOn, title: 'Stockfish evaluation (runs on this phone)' },
          { label: 'Train', icon: Icon.forage, onClick: () => line && navigate(`/train/line/${chapter.id}/${encodeURIComponent(line.id)}`), disabled: !line?.trainable || !!chapter.skipLines?.includes(line.id), primary: true, title: 'Train this line: learn it if new, else review it (schedules it like the trainer)' },
          { label: 'Back', icon: Icon.back, onClick: stepBack, disabled: !ghost && pathLen === 0 },
          { label: 'Next', icon: Icon.next, onClick: stepForward, disabled: !ghost && !nextOf(currentId) },
        ]}
      />
    </div>
  );
}
