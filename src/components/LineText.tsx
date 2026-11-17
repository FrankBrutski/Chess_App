import { memo, useState, type ReactNode } from 'react';
import type { MoveNode, RootNode } from '../lib/model';
import type { NodeAnnotations } from '../lib/annotations';
import type { Line } from '../lib/lines';
import { branchesAlong, fmtMove } from '../lib/lines';
import { NAG_SYMBOLS, isWhiteMove, moveNumber, nagClass } from '../lib/tree';
import { Comment, type Ghost } from './ChapterText';

interface Props {
  /** Kept for symmetry with ChapterText (root comments come from `annotations`). */
  root?: RootNode;
  line: Line;
  lines: Line[];
  annotations: Map<string, NodeAnnotations>;
  currentId: string;
  ghost?: Ghost;
  /** Moves after this index in the line are hidden (play-along / training). Undefined = show all; -1 = none yet. */
  visibleUpTo?: number;
  onSelect: (id: string) => void;
  onGhost: (g: Ghost) => void;
  onOpenLine: (l: Line) => void;
  boldNotation: boolean;
  /** Hide the "other lines here" markers (training keeps the screen to one line). */
  hideBranches?: boolean;
  /** Show the small ⑂ / ⇄ markers (Settings → Lines). */
  showMarkers?: boolean;
  /** Other places in your repertoire with the position after this move (transpositions). */
  elsewhere?: (n: MoveNode) => { label: string; open: () => void }[];
}

/**
 * One line of a comb, Chessable style: only the moves and notes on this line's own path.
 * Moves it shares with the line before it are folded into one short row so the same notes
 * don't repeat line after line; one tap shows them again.
 */
function LineTextImpl(p: Props) {
  const { line, lines, annotations, currentId, ghost, visibleUpTo, onSelect, onGhost, onOpenLine, boldNotation, hideBranches, elsewhere } = p;
  const showMarkers = p.showMarkers ?? true;
  const [open, setOpen] = useState<string>();
  const [trunkOpen, setTrunkOpen] = useState(false);
  const branches = hideBranches ? new Map<string, { move: MoveNode; line: Line }[]>() : branchesAlong(line, lines);
  const limit = visibleUpTo ?? line.nodes.length - 1;
  const shown = line.nodes.slice(0, limit + 1);
  const folded = line.shared > 0 && !trunkOpen;

  const moveButton = (n: MoveNode, withNumber: boolean) => (
    <button
      key={`m${n.id}`}
      type="button"
      className={`mv mv-main${n.id === currentId && !ghost ? ' current' : ''}`}
      data-current={(n.id === currentId && !ghost) || undefined}
      onClick={() => onSelect(n.id)}
    >
      {(withNumber || isWhiteMove(n.ply)) && <span className="mv-num">{moveNumber(n.ply)}</span>}
      {n.san}
      {n.nags.map((g) => <span key={g} className={`nag ${nagClass(g)}`}>{NAG_SYMBOLS[g] ?? ''}</span>)}
    </button>
  );

  const blocks: ReactNode[] = [];
  let inline: ReactNode[] = [];
  let needNum = true;
  let k = 0;
  const flush = () => {
    if (inline.length) blocks.push(<p key={`p${k++}`} className="line-main">{inline}</p>);
    inline = [];
  };
  const comment = (pieces: Parameters<typeof Comment>[0]['pieces'], key: string) => {
    flush();
    blocks.push(<p key={key} className="comment"><Comment pieces={pieces} ghost={ghost} onGhost={onGhost} bold={boldNotation} /></p>);
    needNum = true;
  };

  const start = folded ? Math.min(line.shared, shown.length) : 0;
  if (folded && start > 0) {
    blocks.push(
      <div key="trunk" className="trunk">
        <span className="trunk-label">Same start as line {line.number - 1}:</span>{' '}
        {shown.slice(0, start).map((n, i) => (
          <span key={n.id}>{moveButton(n, i === 0)} </span>
        ))}
        <button type="button" className="link-btn small" onClick={() => setTrunkOpen(true)}>Show notes</button>
      </div>,
    );
  } else if (!folded) {
    annotations.get('root')?.after.forEach((pc, i) => {
      flush();
      blocks.push(<p key={`r${i}`} className="comment intro"><Comment pieces={pc} ghost={ghost} onGhost={onGhost} bold={boldNotation} /></p>);
    });
    if (line.shared > 0 && trunkOpen) {
      blocks.push(
        <button key="fold" type="button" className="link-btn small trunk-fold" onClick={() => setTrunkOpen(false)}>
          Fold the start shared with line {line.number - 1}
        </button>,
      );
    }
  }

  for (let i = start; i < shown.length; i++) {
    const n = shown[i];
    const ann = annotations.get(n.id);
    ann?.before.forEach((pc, j) => comment(pc, `b${n.id}-${j}`));
    inline.push(moveButton(n, needNum));
    needNum = false;
    const alts = branches.get(n.id) ?? [];
    const others = showMarkers && elsewhere ? elsewhere(n) : [];
    const hasMark = showMarkers && (alts.length > 0 || others.length > 0);
    if (hasMark) {
      inline.push(
        <button
          key={`k${n.id}`}
          type="button"
          className={`mark${open === n.id ? ' on' : ''}`}
          aria-expanded={open === n.id}
          aria-label={`${alts.length ? `${alts.length} other move${alts.length === 1 ? '' : 's'} here` : ''}${alts.length && others.length ? ', ' : ''}${others.length ? `same position in ${others.length} other place${others.length === 1 ? '' : 's'}` : ''}`}
          title={alts.length ? 'Other moves here' : 'Transposition: this position is elsewhere in your repertoire'}
          onClick={() => setOpen(open === n.id ? undefined : n.id)}
        >
          {alts.length ? '⑂' : ''}{others.length ? '⇄' : ''}
        </button>,
      );
    }
    inline.push(' ');
    ann?.after.forEach((pc, j) => comment(pc, `a${n.id}-${j}`));
    if (hasMark && open === n.id) {
      flush();
      blocks.push(
        <div key={`x${n.id}`} className="mark-panel">
          {alts.length > 0 && (
            <div>
              <span className="muted">Instead of {fmtMove(n)}: </span>
              {alts.map(({ move, line: l }, j) => (
                <span key={move.id}>
                  {j > 0 && ' · '}
                  <button type="button" className="link-btn" onClick={() => { setOpen(undefined); onOpenLine(l); }}>
                    {fmtMove(move)} (line {l.number}{l.name !== l.label ? `, ${l.name}` : ''})
                  </button>
                </span>
              ))}
            </div>
          )}
          {others.length > 0 && (
            <div>
              <span className="muted">Same position: </span>
              {others.map((o, j) => (
                <span key={j}>
                  {j > 0 && ' · '}
                  <button type="button" className="link-btn" onClick={() => { setOpen(undefined); o.open(); }}>{o.label}</button>
                </span>
              ))}
            </div>
          )}
        </div>,
      );
      needNum = true;
    }
  }
  flush();

  return <div className="chapter-text line-text">{blocks}</div>;
}

export const LineText = memo(LineTextImpl);
