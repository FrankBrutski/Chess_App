import { useEffect, useRef } from 'react';
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Config } from 'chessground/config';
import type { Key } from 'chessground/types';
import type { DrawShape } from 'chessground/draw';
import type { Shape } from '../lib/model';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.brown.css';
import 'chessground/assets/chessground.cburnett.css';

export interface BoardProps {
  fen: string;
  orientation: 'white' | 'black';
  lastMove?: string; // uci
  shapes?: Shape[];
  /** Extra arrows (e.g. a hint), drawn on top of the study's own shapes. */
  hintShapes?: Shape[];
  movable?: { color: 'white' | 'black'; dests: Map<Key, Key[]> };
  onMove?: (orig: Key, dest: Key) => void;
  check?: boolean;
  /** Bump to force the board back to `fen` (e.g. after a wrong move). */
  resetKey?: number;
}

const uciToKeys = (uci?: string): Key[] | undefined =>
  uci && uci.length >= 4 ? [uci.slice(0, 2) as Key, uci.slice(2, 4) as Key] : undefined;

const toDraw = (s: Shape): DrawShape => ({ orig: s.orig as Key, dest: s.dest as Key | undefined, brush: s.color });

export function Board({ fen, orientation, lastMove, shapes = [], hintShapes = [], movable, onMove, check, resetKey }: BoardProps) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  useEffect(() => {
    if (!el.current) return;
    api.current = Chessground(el.current, {
      coordinates: true,
      animation: { enabled: true, duration: 180 },
      highlight: { lastMove: true, check: true },
      drawable: { enabled: true, eraseOnClick: true },
      movable: { free: false, showDests: true, events: { after: (o, d) => onMoveRef.current?.(o, d) } },
      premovable: { enabled: false },
    });
    return () => api.current?.destroy();
  }, []);

  useEffect(() => {
    const turn = fen.split(' ')[1] === 'b' ? 'black' : 'white';
    const cfg: Config = {
      fen,
      orientation,
      turnColor: turn,
      lastMove: uciToKeys(lastMove),
      check: check ? turn : false,
      movable: movable
        ? { color: movable.color, dests: movable.dests, free: false }
        : { color: undefined, dests: new Map() },
    };
    api.current?.set(cfg);
    api.current?.setAutoShapes([...shapes.map(toDraw), ...hintShapes.map(toDraw)]);
  }, [fen, orientation, lastMove, shapes, hintShapes, movable, check, resetKey]);

  return <div className="board-wrap"><div ref={el} className="cg-board-host" /></div>;
}
