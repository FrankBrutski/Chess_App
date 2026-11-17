import { useEffect, useRef } from 'react';
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Key, Piece } from 'chessground/types';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.brown.css';
import 'chessground/assets/chessground.cburnett.css';

/** 'move' = drag pieces around; a piece = tap squares to place it; 'erase' = tap to remove. */
export type Tool = 'move' | 'erase' | Piece;

interface Props {
  board: string; // FEN board part
  orientation: 'white' | 'black';
  tool: Tool;
  onChange: (board: string) => void;
}

/** A free board for setting up a position by hand. */
export function EditorBoard({ board, orientation, tool, onChange }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!el.current) return;
    api.current = Chessground(el.current, {
      fen: board,
      orientation,
      coordinates: true,
      animation: { enabled: false },
      highlight: { lastMove: false, check: false },
      movable: { free: true, color: 'both', showDests: false },
      draggable: { enabled: true, deleteOnDropOff: true },
      premovable: { enabled: false },
      drawable: { enabled: false },
      events: {
        change: () => onChangeRef.current(api.current!.getFen()),
        select: (key: Key) => {
          const t = toolRef.current;
          if (t === 'move' || !api.current) return;
          const pieces = new Map<Key, Piece | undefined>();
          pieces.set(key, t === 'erase' ? undefined : t);
          api.current.setPieces(pieces);
          api.current.selectSquare(null);
          onChangeRef.current(api.current.getFen());
        },
      },
    });
    return () => api.current?.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!api.current) return;
    if (api.current.getFen() !== board) api.current.set({ fen: board });
    api.current.set({
      orientation,
      movable: tool === 'move' ? { free: true, color: 'both' } : { free: false, color: undefined },
      draggable: { enabled: tool === 'move' },
    });
  }, [board, orientation, tool]);

  return <div className="board-wrap"><div ref={el} className="cg-board-host" /></div>;
}
