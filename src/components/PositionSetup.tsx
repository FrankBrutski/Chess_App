import { createElement, useState, type ReactNode } from 'react';
import type { Piece } from 'chessground/types';
import { EditorBoard, type Tool } from './EditorBoard';
import { normalizeFen } from '../lib/positions';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const ROLES = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'] as const;

/** Castling rights a set-up board allows (kings and rooks on their home squares). */
export function castlingFor(board: string): string {
  const rows = board.split('/').map((r) => r.replace(/\d/g, (d) => '.'.repeat(+d)));
  if (rows.length !== 8) return '-';
  const w = rows[7];
  const b = rows[0];
  let s = '';
  if (w[4] === 'K' && w[7] === 'R') s += 'K';
  if (w[4] === 'K' && w[0] === 'R') s += 'Q';
  if (b[4] === 'k' && b[7] === 'r') s += 'k';
  if (b[4] === 'k' && b[0] === 'r') s += 'q';
  return s || '-';
}

export const setupFenOf = (board: string, turn: 'w' | 'b') => `${board} ${turn} ${castlingFor(board)} - 0 1`;

interface Props {
  board: string;
  turn: 'w' | 'b';
  orientation: 'white' | 'black';
  onBoard: (b: string) => void;
  onTurn: (t: 'w' | 'b') => void;
  onOrientation: (o: 'white' | 'black') => void;
  onError?: (msg: string | undefined) => void;
  /** Extra buttons for the Start / Clear / Flip row. */
  extra?: ReactNode;
}

/** Board editor: piece palette, side to move, start/clear/flip and a FEN field. */
export function PositionSetup({ board, turn, orientation, onBoard, onTurn, onOrientation, onError, extra }: Props) {
  const [tool, setTool] = useState<Tool>('move');
  const [fenInput, setFenInput] = useState('');
  const setupFen = setupFenOf(board, turn);

  const loadFen = (text: string) => {
    const r = normalizeFen(text);
    if ('error' in r) { onError?.(r.error); return; }
    const [b, t] = r.fen.split(' ');
    onBoard(b);
    onTurn(t as 'w' | 'b');
    onError?.(undefined);
  };

  const palette: Tool[] = ['move', ...ROLES.map((role) => ({ role, color: 'white' as const })), ...ROLES.map((role) => ({ role, color: 'black' as const })), 'erase'];
  const toolKey = (t: Tool) => (typeof t === 'string' ? t : `${t.color}-${t.role}`);

  return (
    <>
      <EditorBoard board={board} orientation={orientation} tool={tool} onChange={onBoard} />
      <div className="palette cg-wrap" role="radiogroup" aria-label="Piece to place">
        {palette.map((t) => (
          <button key={toolKey(t)} type="button" role="radio" aria-checked={toolKey(tool) === toolKey(t)}
            className={`pal${toolKey(tool) === toolKey(t) ? ' on' : ''}`}
            aria-label={typeof t === 'string' ? (t === 'move' ? 'Move pieces' : 'Erase') : `${t.color} ${t.role}`}
            onClick={() => setTool(t)}>
            {typeof t === 'string' ? (t === 'move' ? '✋' : '⌫') : createElement('piece', { className: `${(t as Piece).color} ${(t as Piece).role}` })}
          </button>
        ))}
      </div>
      <div className="row editor-row">
        <div className="segmented small-seg" role="radiogroup" aria-label="Side to move">
          <button type="button" role="radio" aria-checked={turn === 'w'} className={turn === 'w' ? 'on' : ''} onClick={() => onTurn('w')}>White to move</button>
          <button type="button" role="radio" aria-checked={turn === 'b'} className={turn === 'b' ? 'on' : ''} onClick={() => onTurn('b')}>Black to move</button>
        </div>
      </div>
      <div className="row editor-row">
        <button type="button" onClick={() => onBoard(START_FEN.split(' ')[0])}>Start</button>
        <button type="button" onClick={() => onBoard('8/8/8/8/8/8/8/8')}>Clear</button>
        <button type="button" onClick={() => onOrientation(orientation === 'white' ? 'black' : 'white')}>Flip</button>
        {extra}
      </div>
      <label className="field">
        <span>FEN</span>
        <input
          value={fenInput || setupFen}
          onChange={(e) => setFenInput(e.target.value)}
          onBlur={() => { if (fenInput) { loadFen(fenInput); setFenInput(''); } }}
          onKeyDown={(e) => { if (e.key === 'Enter') { loadFen(fenInput || setupFen); setFenInput(''); } }}
          spellCheck={false}
          autoCapitalize="off"
          aria-label="FEN"
        />
      </label>
    </>
  );
}
