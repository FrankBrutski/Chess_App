/** Small helpers for FEN strings the app has made (always well formed). */

/** The position part of a FEN (board, side to move, castling, en passant), without the move counters. */
export const epd = (fen: string) => fen.split(' ').slice(0, 4).join(' ');

/** The side to move. */
export const turnOf = (fen: string): 'white' | 'black' => (fen.split(' ')[1] === 'b' ? 'black' : 'white');
