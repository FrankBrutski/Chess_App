import { useEffect, useMemo, useRef, useState } from 'react';
import type { Key } from 'chessground/types';
import type { LineTag, MoveNode, RootNode, Sting } from '../lib/model';
import { db } from '../lib/db';
import { indexTree, moveNumber } from '../lib/tree';
import { annotateChapter } from '../lib/annotations';
import { destsOf, sanOfBoardMove } from '../lib/boardMove';
import { deleteNode, editNode, lineStart, playMove, promote, readyProblems, TAG_LABEL } from '../lib/stingTree';
import { getAutoLink, getBoldNotation, getEngineOn, setEngineOn } from '../lib/prefs';
import { Board } from './Board';
import { ChapterText, type Ghost } from './ChapterText';
import { Icon, Toolbar } from './Toolbar';
import { EnginePanel } from './EnginePanel';

const TAGS: LineTag[] = ['best', 'also', 'refute', 'idea'];
const TAG_HELP: Record<LineTag, string> = {
  best: 'The line you want played. Exactly one per card.',
  also: 'Also wins: accepted in drills.',
  refute: 'A tempting move that fails. Your note shows when you play it.',
  idea: 'An explainer (e.g. the threat). Never drilled.',
};

/** Explore a card like the opening reader, but editable: play moves to add lines, write notes, tag lines. */
export function StingExplorer({ card }: { card: Sting }) {
  const [root, setRoot] = useState<RootNode>(card.root!);
  const [currentId, setCurrentId] = useState('root');
  const [ghost, setGhost] = useState<Ghost>();
  const [engineOn, setEngineOnState] = useState(getEngineOn());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [resetKey, setResetKey] = useState(0);
  const saveTimer = useRef<number | undefined>(undefined);

  const pending = useRef(0);
  // Pick up changes made elsewhere (e.g. Edit position), but not echoes of our own saves.
  useEffect(() => { if (!pending.current) setRoot(card.root!); }, [card.root]);

  const idx = useMemo(() => indexTree(root), [root]);
  const node = idx.byId.get(currentId) ?? root;
  useEffect(() => { setNote(node.comments.join('\n\n')); }, [node]);
  const annotations = useMemo(() => annotateChapter(root, { auto: getAutoLink() }), [root]);
  const orientation = card.orientation ?? (root.fen.split(' ')[1] === 'b' ? 'black' : 'white');
  const start = node.id === 'root' ? undefined : lineStart(root, node.id);
  const problems = readyProblems(root);

  const commit = (r: RootNode) => {
    setRoot(r);
    window.clearTimeout(saveTimer.current);
    pending.current++;
    saveTimer.current = window.setTimeout(() => {
      void db.stings.update(card.id, { root: r, updatedAt: Date.now() }).finally(() => {
        // Let the echo of this save arrive before listening again.
        window.setTimeout(() => { pending.current = 0; }, 100);
      });
    }, 250);
  };
  const latest = useRef(root);
  latest.current = root;
  // Leaving the card: save straight away instead of dropping the last edit.
  useEffect(() => () => {
    window.clearTimeout(saveTimer.current);
    if (pending.current) void db.stings.update(card.id, { root: latest.current, updatedAt: Date.now() });
  }, [card.id]);

  const onMove = (orig: Key, dest: Key) => {
    const san = sanOfBoardMove(node.fen, orig, dest);
    const res = san ? playMove(root, node.id, san) : undefined;
    if (!res) { setResetKey((k) => k + 1); return; }
    if (res.root !== root) commit(res.root);
    setGhost(undefined);
    setCurrentId(res.id);
  };
  const back = () => { setGhost(undefined); setCurrentId(idx.parent.get(node.id)?.id ?? 'root'); };
  const forward = () => { const n = node.children[0]; if (n) { setGhost(undefined); setCurrentId(n.id); } };
  const saveNote = () => { if (note.trim() !== node.comments.join('\n\n').trim()) commit(editNode(root, node.id, { comment: note })); };

  const [flipped, setFlipped] = useState(false);
  const boardFen = ghost ? ghost.line[ghost.index].fen : node.fen;
  const turn = boardFen.split(' ')[1] === 'b' ? 'black' : 'white';

  return (
    <div className="stack explorer">
      <Board
        fen={boardFen}
        orientation={flipped ? (orientation === 'white' ? 'black' : 'white') : orientation}
        lastMove={ghost ? ghost.line[ghost.index].uci : (node as MoveNode).uci}
        shapes={ghost ? [] : node.shapes}
        movable={ghost ? undefined : { color: turn, dests: destsOf(node.fen) }}
        onMove={onMove}
        resetKey={resetKey}
      />
      {ghost && (
        <div className="ghost-bar">
          <span>{ghost.source === 'engine' ? 'Engine line' : 'Line from the text'}</span>
          <button type="button" className="link-btn" onClick={() => setGhost(undefined)}>Back to the card</button>
        </div>
      )}
      <Toolbar fixed items={[
        { label: 'Start', icon: Icon.start, onClick: () => { setGhost(undefined); setCurrentId('root'); }, disabled: node.id === 'root' && !ghost },
        { label: 'Back', icon: Icon.back, onClick: back, disabled: node.id === 'root' && !ghost },
        { label: 'Next', icon: Icon.next, onClick: forward, disabled: !node.children.length },
        { label: 'Flip', icon: Icon.flip, onClick: () => setFlipped(!flipped) },
        { label: 'Engine', icon: Icon.engine, onClick: () => { setEngineOn(!engineOn); setEngineOnState(!engineOn); }, pressed: engineOn, title: 'Stockfish (runs on this phone)' },
      ]} />
      {engineOn && <EnginePanel fen={boardFen} paused={false} onPlayLine={ghost ? undefined : (line) => setGhost({ line, index: 0, baseId: currentId, source: 'engine' })} />}
      <p className="muted small center">Play moves on the board to add lines. {turn === 'white' ? 'White' : 'Black'} to move.</p>

      <section className="sting-lines" aria-label="Lines from the puzzle position">
        {root.children.length === 0 && <p className="muted small">No lines yet. Play the winning move first.</p>}
        {root.children.map((c) => (
          <button key={c.id} type="button" className={`sting-line${start?.id === c.id ? ' on' : ''}`} onClick={() => { setGhost(undefined); setCurrentId(c.id); }}>
            <b>{moveNumber(c.ply)}{c.san}</b>
            <span className={`tag tag-${c.tag ?? 'none'}`}>{c.tag ? TAG_LABEL[c.tag] : 'No tag'}</span>
          </button>
        ))}
      </section>

      {start && (
        <div className="stack tag-box">
          <span className="small">Line starting <b>{moveNumber(start.ply)}{start.san}</b> is:</span>
          <div className="chips" role="radiogroup" aria-label="Line tag">
            {TAGS.map((t) => (
              <button key={t} type="button" role="radio" aria-checked={start.tag === t} title={TAG_HELP[t]}
                className={`chip${start.tag === t ? ' on' : ''}`} onClick={() => commit(editNode(root, start.id, { tag: t }))}>
                {TAG_LABEL[t]}
              </button>
            ))}
          </div>
          {start.tag && <span className="muted small">{TAG_HELP[start.tag]}</span>}
        </div>
      )}

      <label className="field">
        <span>{node.id === 'root' ? 'Note on the puzzle position' : `Note after ${moveNumber(node.ply)}${(node as MoveNode).san}`}</span>
        <textarea className="note-input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} onBlur={saveNote}
          placeholder="Why it works. Lines in <angle brackets> become clickable, e.g. <2. Qxf7#>" />
      </label>
      {node.id !== 'root' && (
        <div className="row">
          {idx.parent.get(node.id)?.id !== 'root' && idx.parent.get(node.id)?.children[0]?.id !== node.id && (
            <button type="button" onClick={() => commit(promote(root, node.id))}>Make main line</button>
          )}
          <button type="button" className="danger-link" onClick={() => { const d = deleteNode(root, node.id); commit(d.root); setCurrentId(d.id); }}>
            Delete this move and after
          </button>
        </div>
      )}

      <div className="chapter-text-wrap">
        <ChapterText
          root={root}
          annotations={annotations}
          currentId={ghost ? '' : currentId}
          ghost={ghost}
          collapsed={collapsed}
          onToggle={(id) => setCollapsed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; })}
          onSelect={(id) => { setGhost(undefined); setCurrentId(id); }}
          onGhost={setGhost}
          boldNotation={getBoldNotation()}
        />
      </div>

      <div className="ready-box">
        {card.status === 'ready' ? (
          <>
            <p className="good-text center"><b>Ready</b>: this card is in your drills.</p>
            <button type="button" className="wide" onClick={() => void db.stings.update(card.id, { status: 'progress', updatedAt: Date.now() })}>Move back to In progress</button>
          </>
        ) : (
          <>
            {problems.map((p) => <p key={p} className="muted small">{p}</p>)}
            <button type="button" className="primary wide" disabled={problems.length > 0}
              onClick={() => void db.stings.update(card.id, { root, status: 'ready', updatedAt: Date.now() })}>
              Mark Ready
            </button>
          </>
        )}
      </div>
    </div>
  );
}
