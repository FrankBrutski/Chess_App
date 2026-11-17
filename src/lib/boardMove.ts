import { parseFen } from 'chessops/fen';
import { Chess } from 'chessops/chess';
import { parseSquare } from 'chessops/util';
import { makeSan } from 'chessops/san';
import { chessgroundDests } from 'chessops/compat';
import type { Key } from 'chessground/types';

/** Plies played before this position (0 = White to move at move 1). */
export const plyOf = (pos: { fullmoves: number; turn: 'white' | 'black' }) => (pos.fullmoves - 1) * 2 + (pos.turn === 'white' ? 0 : 1);

export function positionOf(fen: string) {
  const setup = parseFen(fen);
  if (setup.isErr) return undefined;
  const pos = Chess.fromSetup(setup.value);
  return pos.isErr ? undefined : pos.value;
}

export const destsOf = (fen: string) => {
  const pos = positionOf(fen);
  return pos ? (chessgroundDests(pos) as Map<Key, Key[]>) : new Map<Key, Key[]>();
};

export const stripSan = (san: string) => san.replace(/[+#!?]/g, '');

/** SAN of a move made on the board. Promotes to the expected piece when the expected move is a promotion. */
export function sanOfBoardMove(fen: string, orig: Key, dest: Key, expectedSan?: string): string | undefined {
  const pos = positionOf(fen);
  const from = parseSquare(orig);
  let to = parseSquare(dest);
  if (!pos || from === undefined || to === undefined) return undefined;
  const piece = pos.board.get(from);
  // chessground reports castling as king-to-destination; chessops wants king-to-rook.
  if (piece?.role === 'king' && Math.abs(from - to) === 2) to = to > from ? to + 1 : to - 2;
  const promo = expectedSan ? /=([QRBN])/.exec(expectedSan)?.[1] : undefined;
  const role = promo ? ({ Q: 'queen', R: 'rook', B: 'bishop', N: 'knight' } as const)[promo as 'Q'] : undefined;
  const isPromo = piece?.role === 'pawn' && (dest[1] === '8' || dest[1] === '1');
  return makeSan(pos, { from, to, promotion: isPromo ? role ?? 'queen' : undefined });
}
