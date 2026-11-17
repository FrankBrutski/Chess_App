import { Fragment, memo, type ReactNode } from 'react';
import type { MoveNode, RootNode, TreeNode } from '../lib/model';
import type { CommentPiece, GhostMove } from '../lib/commentMoves';
import type { NodeAnnotations } from '../lib/annotations';
import { splitNotation } from '../lib/notation';
import { NAG_SYMBOLS, countMoves, isWhiteMove, moveNumber, nagClass } from '../lib/tree';

export interface Ghost {
  line: GhostMove[];
  index: number;
  baseId: string;
  /** Where the line came from, for the label above the board. */
  source?: 'text' | 'engine';
}

interface Props {
  root: RootNode;
  annotations: Map<string, NodeAnnotations>;
  currentId: string;
  ghost?: Ghost;
  /** Returns false for nodes that are hidden (play-along hides what comes next). */
  isVisible: (id: string) => boolean;
  collapsed: Set<string>;
  onToggle: (variationFirstId: string) => void;
  onSelect: (id: string) => void;
  onGhost: (g: Ghost) => void;
  /** Bold moves and squares mentioned in plain text. */
  boldNotation: boolean;
}

export function PlainText({ text, bold }: { text: string; bold: boolean }) {
  if (!bold) return <>{text}</>;
  return (
    <>
      {splitNotation(text).map((part, i) => (part.bold ? <b key={i} className="notation">{part.text}</b> : <Fragment key={i}>{part.text}</Fragment>))}
    </>
  );
}

export function Comment({ pieces, ghost, onGhost, bold }: { pieces: CommentPiece[]; ghost?: Ghost; onGhost: (g: Ghost) => void; bold: boolean }) {
  return (
    <>
      {pieces.map((p, i) => {
        if (p.kind === 'text') return <PlainText key={i} text={p.text} bold={bold} />;
        if (p.kind === 'bad') {
          return (
            <span key={i} className="inline-bad" title="These moves are not legal from here">
              {p.text}
            </span>
          );
        }
        const active = ghost && ghost.line === p.line && ghost.index === p.index;
        return (
          <button
            key={i}
            type="button"
            className={`inline-move${p.depth ? ' nested' : ''}${active ? ' active' : ''}`}
            data-active={active || undefined}
            onClick={() => onGhost({ line: p.line, index: p.index, baseId: p.baseId })}
          >
            {p.text}
          </button>
        );
      })}
    </>
  );
}

function ChapterTextImpl(props: Props) {
  const { root, annotations, currentId, ghost, isVisible, collapsed, onToggle, onSelect, onGhost, boldNotation } = props;

  const moveButton = (n: MoveNode, withNumber: boolean, depth: number) => (
    <button
      key={`m${n.id}`}
      type="button"
      className={`mv ${depth === 0 ? 'mv-main' : 'mv-var'}${n.id === currentId && !ghost ? ' current' : ''}`}
      data-current={(n.id === currentId && !ghost) || undefined}
      onClick={() => onSelect(n.id)}
    >
      {(withNumber || isWhiteMove(n.ply)) && <span className="mv-num">{moveNumber(n.ply)}</span>}
      {n.san}
      {n.nags.map((g) => (
        <span key={g} className={`nag ${nagClass(g)}`}>{NAG_SYMBOLS[g] ?? ''}</span>
      ))}
    </button>
  );

  /** Render a line starting at parent.children[startIdx] (plus nested variations). */
  const renderSeq = (parent: TreeNode, startIdx: number, depth: number): ReactNode[] => {
    const blocks: ReactNode[] = [];
    let inline: ReactNode[] = [];
    let needNum = true;
    let key = 0;
    const flush = () => {
      if (inline.length) blocks.push(<p key={`p${key++}`} className={depth === 0 ? 'line-main' : 'line-var'}>{inline}</p>);
      inline = [];
    };
    const commentBlock = (pieces: CommentPiece[], k: string) => {
      if (depth === 0) {
        flush();
        blocks.push(
          <p key={k} className="comment">
            <Comment pieces={pieces} ghost={ghost} onGhost={onGhost} bold={boldNotation} />
          </p>,
        );
      } else {
        inline.push(
          <span key={k} className="comment-inline">
            {' '}<Comment pieces={pieces} ghost={ghost} onGhost={onGhost} bold={boldNotation} />{' '}
          </span>,
        );
      }
      needNum = true;
    };
    const emit = (n: MoveNode) => {
      const ann = annotations.get(n.id);
      ann?.before.forEach((p, i) => commentBlock(p, `b${n.id}-${i}`));
      inline.push(moveButton(n, needNum, depth), ' ');
      needNum = false;
      ann?.after.forEach((p, i) => commentBlock(p, `a${n.id}-${i}`));
    };
    const variation = (p: TreeNode, i: number) => {
      const first = p.children[i];
      if (!isVisible(first.id)) return;
      flush();
      const isCollapsed = collapsed.has(first.id);
      blocks.push(
        <div key={`v${first.id}`} className={`variation depth-${Math.min(depth + 1, 4)}`}>
          <button type="button" className="var-toggle" onClick={() => onToggle(first.id)} aria-label={isCollapsed ? 'Expand' : 'Collapse'}>
            {isCollapsed ? '▸' : '▾'}
          </button>
          {isCollapsed ? (
            <p className="line-var collapsed-summary">
              {moveButton(first, true, depth + 1)}
              <span className="var-count">{countMoves(first)} moves</span>
            </p>
          ) : (
            <div className="var-body">{renderSeq(p, i, depth + 1)}</div>
          )}
        </div>,
      );
      needNum = true;
    };

    let node = parent.children[startIdx];
    if (!isVisible(node.id)) return blocks;
    emit(node);
    if (startIdx === 0) for (let i = 1; i < parent.children.length; i++) variation(parent, i);
    while (node.children.length) {
      const p = node;
      node = p.children[0];
      if (!isVisible(node.id)) break;
      emit(node);
      for (let i = 1; i < p.children.length; i++) variation(p, i);
    }
    flush();
    return blocks;
  };

  const rootAnn = annotations.get('root');
  return (
    <div className="chapter-text">
      {rootAnn?.after.map((p, i) => (
        <p key={`r${i}`} className="comment intro">
          <Comment pieces={p} ghost={ghost} onGhost={onGhost} bold={boldNotation} />
        </p>
      ))}
      {root.children.length > 0 && renderSeq(root, 0, 0)}
    </div>
  );
}

export const ChapterText = memo(ChapterTextImpl);
