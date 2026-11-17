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
import { getLineOrder } from '../lib/prefs';
import { getAutoLink, getBoldNotation, getEngineOn, setEngineOn } from '../lib/prefs';
import { EnginePanel } from '../components/EnginePanel';
import { LineText } from '../components/LineText';
import { splitLines, type Line } from '../lib/lines';

const strip = (san: string) => san.replace(/[+#!?]/g, '');

function positionOf(fen: string) {
  const setup = parseFen(fen);
  if (setup.isErr) return undefined;
  const pos = Chess.fromSetup(setup.value);
  return pos.isErr ? undefined : pos.value;
}

type Feedback = { kind: 'good' | 'bad' | 'info' | 'done'; text: string } | undefined;

export function Reader({ chapterId, startNodeId, lineId, lineNodeId }: { chapterId: string; startNodeId?: string; lineId?: string; lineNodeId?: string }) {
  const chapter = useLiveQuery(() => db.chapters.get(chapterId), [chapterId]);
  const siblings = useLiveQuery(async () => (chapter ? chaptersOf(chapter.courseId) : []), [chapter?.courseId]);
  const course = useLiveQuery(async () => (chapter ? db.courses.get(chapter.courseId) : undefined), [chapter?.courseId]);

  const idx = useMemo(() => (chapter ? indexTree(chapter.root) : undefined), [chapter]);
  const order = useMemo(() => (chapter ? docOrder(chapter.root) : []), [chapter]);
  const orderIndex = useMemo(() => new Map(order.map((id, i) => [id, i])), [order]);
  const annotations = useMemo(() => (chapter ? annotateChapter(chapter.root, { auto: getAutoLink() }) : new Map()), [chapter]);
  const lines = useMemo(() => (chapter ? splitLines(chapter.root, chapter.orientation, { names: chapter.lineNames, order: getLineOrder() }) : []), [chapter]);
  // Line view (one line at a time, Chessable style) is the default; "Whole study" shows the full tree.
  const [mode, setMode] = useState<'line' | 'study'>(startNodeId ? 'study' : 'line');
  const [lineKey, setLineKey] = useState(lineId ?? 'main');
  const [drawer, setDrawer] = useState(false);
  const line: Line | undefined = mode === 'line' ? lines.find((l) => l.id === lineKey) ?? lines.find((l) => l.id === 'main') ?? lines[0] : undefined;
  const lineIndex = useMemo(() => new Map(line?.nodes.map((n, i) => [n.id, i]) ?? []), [line]);

  const [currentId, setCurrentId] = useState('root');
  const [ghost, setGhost] = useState<Ghost>();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [play, setPlay] = useState<{ frontier: string } | undefined>();
  const [feedback, setFeedback] = useState<Feedback>();
  const [hint, setHint] = useState<Shape[]>([]);
  const [resetKey, setResetKey] = useState(0);
  const [engineOn, setEngineOnState] = useState(getEngineOn());
  const toggleEngine = () => { setEngineOn(!engineOn); setEngineOnState(!engineOn); };
  const textRef = useRef<HTMLDivElement>(null);

  // Reset when switching chapters (or jumping to a spot from the issues list).
  useEffect(() => {
    setCurrentId(startNodeId ?? lineNodeId ?? 'root');
    setMode(startNodeId ? 'study' : 'line');
    setLineKey(lineId ?? 'main');
    setDrawer(false);
    setGhost(undefined);
    setPlay(undefined);
    setFeedback(undefined);
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
    const next = nextOf(currentId);
    if (!next) return;
    if (play && currentId === play.frontier) return; // in play-along you make the move yourself
    if (!isVisible(next.id)) return;
    setCurrentId(next.id);
  }, [ghost, nextOf, play, currentId, isVisible]);

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
    setFeedback({ kind: 'info', text: 'Forage: play your moves on the board. The text follows you.' });
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
    const next = nextOf(play.frontier);
    if (!f) return;
    if (!next) {
      setFeedback({
        kind: 'done',
        text: line ? `End of line ${line.number}.` : 'End of this line. Pick a variation in the text to keep exploring, or restart.',
      });
      return;
    }
    const isUserMove = (isWhiteMove(next.ply) ? 'white' : 'black') === userColor;
    if (isUserMove) return;
    const t = setTimeout(() => {
      setPlay({ frontier: next.id });
      setCurrentId(next.id);
    }, 550);
    return () => clearTimeout(t);
  }, [play, idx, userColor, nextOf, line]);

  const viewing = !!play && (currentId !== play.frontier || !!ghost);
  const frontierNode = play ? idx?.byId.get(play.frontier) : undefined;
  const expected = play ? nextOf(play.frontier) : undefined;
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
      const altLine = alt && line ? lines.find((l) => l !== line && l.nodes.includes(alt)) : undefined;
      setFeedback({
        kind: 'bad',
        text: altLine
          ? `${san} is line ${altLine.number} (${altLine.name}). This line plays ${expected.san}.`
          : alt
            ? `${san} is covered in the text as a side line. Try the repertoire move.`
            : `${san} isn't the repertoire move. Try again or tap Hint.`,
      });
      // Put the piece back.
      setResetKey((k) => k + 1);
    },
    [frontierNode, expected, line, lines],
  );

  const showHint = () => {
    if (!expected) return;
    setHint([{ color: 'blue', orig: expected.uci.slice(0, 2) }]);
    if (hint.length) setHint([{ color: 'blue', orig: expected.uci.slice(0, 2), dest: expected.uci.slice(2, 4) }]);
  };

  if (chapter === undefined || !idx || !node) return <div className="page"><p className="muted">Loading…</p></div>;
  if (chapter === null) return <div className="page"><p>Comb not found.</p></div>;

  const boardFen = ghost ? ghost.line[ghost.index].fen : node.fen;
  const lastMove = ghost ? ghost.line[ghost.index].uci : (node as MoveNode).uci;
  const shapes = ghost ? [] : node.shapes;
  const branches = !line && !ghost && !play && node.children.length > 1 ? node.children : [];
  const openLine = (l: Line) => {
    setPlay(undefined);
    setFeedback(undefined);
    setGhost(undefined);
    setHint([]);
    setMode('line');
    setLineKey(l.id);
    setDrawer(false);
    // Show the position where the line branches off.
    setCurrentId(l.shared > 0 ? l.nodes[l.shared - 1].id : 'root');
    textRef.current?.scrollTo({ top: 0 });
  };
  const lineNo = line ? line.number - 1 : -1;
  const renameLine = (l: Line, name: string) =>
    db.chapters.where('id').equals(chapter.id).modify((c) => {
      const names = { ...(c.lineNames ?? {}) };
      if (name.trim() && name.trim() !== l.label) names[l.id] = name.trim();
      else delete names[l.id];
      c.lineNames = names;
    });
  const chIndex = siblings?.findIndex((c) => c.id === chapter.id) ?? -1;
  const prevCh = chIndex > 0 ? siblings![chIndex - 1] : undefined;
  const nextCh = siblings && chIndex >= 0 && chIndex < siblings.length - 1 ? siblings[chIndex + 1] : undefined;
  const pathLen = currentId === 'root' ? 0 : pathTo(idx, currentId).length;

  return (
    <div className="reader">
      <header className="reader-header">
        <button type="button" className="icon-btn" onClick={() => navigate(`/course/${chapter.courseId}`)} aria-label="Back to hive" title="Back to hive">
          ‹
        </button>
        <div className="reader-title">
          <div className="reader-course">{course?.name}</div>
          <div className="reader-chapter">{chapter.title}</div>
        </div>
        <button type="button" className="icon-btn small-text" onClick={() => navigate(`/train/comb/${chapter.id}`)} title="Train this comb">Train</button>
        <button
          type="button"
          className={`engine-toggle${engineOn ? ' on' : ''}`}
          onClick={toggleEngine}
          aria-pressed={engineOn}
          title="Stockfish evaluation (runs on this phone)"
        >
          SF
        </button>
        <div className="reader-chapnav">
          <button type="button" className="icon-btn" disabled={!prevCh} onClick={() => prevCh && navigate(`/read/${prevCh.id}`)} aria-label="Previous comb (chapter)" title="Previous comb">⟨</button>
          <button type="button" className="icon-btn" disabled={!nextCh} onClick={() => nextCh && navigate(`/read/${nextCh.id}`)} aria-label="Next comb (chapter)" title="Next comb">⟩</button>
        </div>
      </header>

      <div className="line-bar">
        {line ? (
          <>
            <button type="button" className="icon-btn" disabled={lineNo <= 0} onClick={() => openLine(lines[lineNo - 1])} aria-label="Previous line">‹</button>
            <button type="button" className="line-pick" onClick={() => setDrawer(!drawer)} aria-expanded={drawer}>
              <span className="line-num">Line {line.number}/{lines.length}</span>
              <span className="line-name">{line.name}</span>
              <span aria-hidden="true">▾</span>
            </button>
            <button type="button" className="icon-btn" disabled={lineNo >= lines.length - 1} onClick={() => openLine(lines[lineNo + 1])} aria-label="Next line">›</button>
          </>
        ) : (
          <button type="button" className="line-pick" onClick={() => setDrawer(!drawer)} aria-expanded={drawer}>
            <span className="line-name">Whole study · {lines.length} lines</span>
            <span aria-hidden="true">▾</span>
          </button>
        )}
        <button
          type="button"
          className="icon-btn small-text"
          onClick={() => {
            setPlay(undefined);
            setFeedback(undefined);
            setGhost(undefined);
            if (line) setMode('study');
            else {
              setMode('line');
              const through = lines.find((l) => l.nodes.some((n) => n.id === currentId));
              if (through) setLineKey(through.id);
            }
          }}
          title={line ? 'Show the whole study with every line' : 'Show one line at a time'}
        >
          {line ? 'Whole' : 'Lines'}
        </button>
      </div>
      {drawer && (
        <LineList
          lines={lines}
          current={line}
          skipped={new Set(chapter.skipLines ?? [])}
          onOpen={openLine}
          onRename={renameLine}
          onToggleDrill={(l) =>
            db.chapters.where('id').equals(chapter.id).modify((c) => {
              const s = new Set(c.skipLines ?? []);
              if (s.has(l.id)) s.delete(l.id);
              else s.add(l.id);
              c.skipLines = [...s];
            })
          }
          onClose={() => setDrawer(false)}
        />
      )}

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
              <span>{ghost.source === 'engine' ? 'Engine line' : 'Line from the text'}</span>
              <button type="button" className="link-btn" onClick={() => { setCurrentId(ghost.baseId); setGhost(undefined); }}>
                Back to the study
              </button>
            </div>
          )}
          {engineOn && (
            <EnginePanel
              fen={boardFen}
              paused={awaitingUser}
              onPlayLine={ghost ? undefined : (line) => { setHint([]); setGhost({ line, index: 0, baseId: currentId, source: 'engine' }); }}
            />
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
              <button type="button" className="primary" onClick={startPlay} disabled={!nextOf(currentId)} title="Forage: play along and learn this line">
                Forage
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
          {line ? (
            <LineText
              key={line.id}
              root={chapter.root}
              line={line}
              lines={lines}
              annotations={annotations}
              currentId={currentId}
              ghost={ghost}
              visibleUpTo={play ? (play.frontier === 'root' ? -1 : lineIndex.get(play.frontier)) : undefined}
              onSelect={(id) => select(id)}
              onGhost={(g) => { setHint([]); setGhost(g); }}
              onOpenLine={openLine}
              boldNotation={getBoldNotation()}
              hideBranches={!!play}
            />
          ) : (
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
          )}
          {play && feedback?.kind === 'done' && (
            <div className="done-actions">
              <button type="button" onClick={() => { select('root'); setPlay({ frontier: 'root' }); setFeedback(undefined); }}>
                {line ? 'Restart line' : 'Restart comb'}
              </button>
              {line && lineNo < lines.length - 1 && (
                <button type="button" className="primary" onClick={() => openLine(lines[lineNo + 1])}>Next line</button>
              )}
              <button type="button" onClick={stopPlay}>Back to reading</button>
            </div>
          )}
          <div className="text-end-spacer" />
        </div>
      </div>
    </div>
  );
}

function LineList({ lines, current, skipped, onOpen, onRename, onToggleDrill, onClose }: {
  lines: Line[];
  current?: Line;
  skipped: Set<string>;
  onOpen: (l: Line) => void;
  onRename: (l: Line, name: string) => void;
  onToggleDrill: (l: Line) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<string>();
  const needle = q.trim().toLowerCase().replace(/\s+/g, ' ');
  const matches = (l: Line) => {
    if (!needle) return true;
    const moves = l.nodes.map((n) => `${moveNumber(n.ply)}${n.san}`).join(' ').toLowerCase();
    const sans = l.nodes.map((n) => n.san).join(' ').toLowerCase();
    return [l.name, l.label, `line ${l.number}`, moves, sans].some((t) => t.toLowerCase().replace(/…/g, '...').includes(needle.replace(/…/g, '...')) || t.toLowerCase().includes(needle));
  };
  const shown = lines.filter(matches);
  return (
    <div className="line-drawer">
      <div className="row">
        <input
          type="search"
          placeholder="Find a line: name or moves (e.g. Nf6 Ng5)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Find a line"
        />
        <button type="button" onClick={onClose}>Close</button>
      </div>
      <ol className="line-list">
        {shown.map((l) => (
          <li key={l.id} className={l === current ? 'current' : undefined}>
            {editing === l.id ? (
              <form
                className="row"
                onSubmit={(e) => {
                  e.preventDefault();
                  const v = new FormData(e.currentTarget).get('name');
                  void onRename(l, String(v ?? ''));
                  setEditing(undefined);
                }}
              >
                <input name="name" defaultValue={l.name} autoFocus aria-label={`Name for line ${l.number}`} />
                <button type="submit">Save</button>
              </form>
            ) : (
              <>
                <button type="button" className="line-row" onClick={() => onOpen(l)}>
                  <span className="line-num">{l.number}</span>
                  <span className="line-row-text">
                    <span className="line-name">{l.name}</span>
                    {l.name !== l.label && <span className="muted small"> · {l.label}</span>}
                    {!l.trainable && <span className="tag">reading only</span>}
                    {l.trainable && skipped.has(l.id) && <span className="tag">not drilled</span>}
                  </span>
                </button>
                {l.trainable && (
                  <button
                    type="button"
                    className={`drill-btn${skipped.has(l.id) ? ' off' : ''}`}
                    onClick={() => onToggleDrill(l)}
                    aria-pressed={!skipped.has(l.id)}
                    aria-label={`Drill line ${l.number}`}
                    title={skipped.has(l.id) ? 'Not drilled: tap to drill this line' : 'Drilled: tap to stop drilling this line'}
                  >
                    {skipped.has(l.id) ? 'Skip' : 'Drill'}
                  </button>
                )}
                <button type="button" className="icon-btn small-text" onClick={() => setEditing(l.id)} aria-label={`Rename line ${l.number}`}>✎</button>
              </>
            )}
          </li>
        ))}
        {shown.length === 0 && <li className="muted small">No line matches.</li>}
      </ol>
      <p className="muted small">
        Name a line by tapping ✎, or in Lichess by writing [Line: name] in the comment on the move where it branches.
        Tap Drill to switch a line between drilled and not drilled; skipped lines stay here to read and keep their progress.
      </p>
    </div>
  );
}
