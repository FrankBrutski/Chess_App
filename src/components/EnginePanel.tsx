import { useEffect, useMemo, useRef, useState } from 'react';
import { parseFen } from 'chessops/fen';
import { Chess, normalizeMove } from 'chessops/chess';
import { parseUci } from 'chessops/util';
import { makeSanAndPlay } from 'chessops/san';
import { makeFen } from 'chessops/fen';
import { engine } from '../lib/engine';
import { formatScore, whiteShare, type EngineLine } from '../lib/uci';
import { getEngineDepth, getEngineLines } from '../lib/prefs';
import { moveNumber } from '../lib/tree';
import type { GhostMove } from '../lib/commentMoves';

interface Props {
  fen: string;
  /** True while foraging and waiting for your move: the engine would give the answer away. */
  paused: boolean;
  /** Tap a line to play it on the board (only when looking at a move of the study). */
  onPlayLine?: (line: GhostMove[]) => void;
}

/** Convert an engine line (uci moves) into SAN moves that can be shown and played. */
export function pvToMoves(fen: string, pv: string[], max = 12): GhostMove[] {
  const setup = parseFen(fen);
  if (setup.isErr) return [];
  const p = Chess.fromSetup(setup.value);
  if (p.isErr) return [];
  const pos = p.value;
  const startPly = (pos.fullmoves - 1) * 2 + (pos.turn === 'white' ? 0 : 1);
  const out: GhostMove[] = [];
  for (const uci of pv.slice(0, max)) {
    const raw = parseUci(uci);
    if (!raw) break;
    const move = normalizeMove(pos, raw); // UCI castling e1g1 -> chessops king-takes-rook
    if (!pos.isLegal(move)) break;
    const san = makeSanAndPlay(pos, move);
    out.push({ san, uci, fen: makeFen(pos.toSetup()), ply: startPly + out.length + 1 });
  }
  return out;
}

function lineText(moves: GhostMove[]) {
  return moves
    .map((m, i) => (m.ply % 2 === 1 || i === 0 ? `${moveNumber(m.ply)}${m.san}` : m.san))
    .join(' ');
}

export function EnginePanel({ fen, paused, onPlayLine }: Props) {
  const [lines, setLines] = useState<EngineLine[]>([]);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string>();
  const frame = useRef(0);
  const depth = getEngineDepth();
  const multiPv = getEngineLines();

  useEffect(() => {
    if (paused) {
      engine.stop();
      return;
    }
    setLines([]);
    setDone(false);
    let latest: EngineLine[] = [];
    const t = setTimeout(() => {
      engine
        .analyse({ fen, depth, multiPv }, (ls, finished) => {
          latest = ls;
          if (finished) setDone(true);
          cancelAnimationFrame(frame.current);
          frame.current = requestAnimationFrame(() => setLines([...latest]));
        })
        .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    }, 120);
    return () => clearTimeout(t);
  }, [fen, paused, depth, multiPv]);

  // Don't burn battery in the background.
  useEffect(() => {
    const onVis = () => { if (document.hidden) engine.stop(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // Unload the engine when the panel goes away (toggle off, leaving the reader).
  useEffect(() => () => engine.shutdown(), []);

  const moves = useMemo(() => lines.map((l) => pvToMoves(fen, l.pv)), [lines, fen]);
  const best = lines[0];

  if (error) return <div className="engine-panel"><span className="error small">{error}</span></div>;
  if (paused) {
    return (
      <div className="engine-panel paused">
        <span className="muted small">Engine paused while you forage (it would give the answer away).</span>
      </div>
    );
  }
  return (
    <div className="engine-panel" aria-live="polite">
      <div className="eval-row">
        <div className="eval-bar" role="img" aria-label={`Evaluation ${best ? formatScore(best) : 'pending'}`}>
          <div className="eval-white" style={{ width: `${(best ? whiteShare(best) : 0.5) * 100}%` }} />
        </div>
        <span className="eval-score">{best ? formatScore(best) : '…'}</span>
        <span className="eval-depth muted">
          {best ? `depth ${best.depth}${depth ? `/${depth}` : ''}` : 'thinking'}
          {done ? ' ✓' : ''}
        </span>
      </div>
      {lines.map((l, i) => (
        <button
          key={l.multipv}
          type="button"
          className="engine-line"
          disabled={!onPlayLine || !moves[i]?.length}
          onClick={() => onPlayLine?.(moves[i])}
        >
          <span className="engine-line-score">{formatScore(l)}</span>
          <span className="engine-line-moves">{lineText(moves[i] ?? [])}</span>
        </button>
      ))}
    </div>
  );
}
