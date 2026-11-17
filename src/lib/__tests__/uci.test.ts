import { describe, expect, it } from 'vitest';
import { formatScore, parseInfo, whiteShare } from '../uci';

describe('UCI info parsing', () => {
  const line = 'info depth 18 seldepth 24 multipv 2 score cp 35 nodes 1000 nps 500000 hashfull 10 time 20 pv e2e4 e7e5 g1f3';

  it('reads depth, multipv, score and pv', () => {
    expect(parseInfo(line, true)).toEqual({ multipv: 2, depth: 18, cp: 35, mate: undefined, pv: ['e2e4', 'e7e5', 'g1f3'] });
  });
  it('flips the score when Black is to move, so + always means White is better', () => {
    expect(parseInfo(line, false)?.cp).toBe(-35);
    expect(parseInfo('info depth 30 multipv 1 score mate 3 pv d8h4', false)?.mate).toBe(-3);
  });
  it('ignores bound scores, currmove lines and non-info output', () => {
    expect(parseInfo('info depth 10 multipv 1 score cp 20 lowerbound pv e2e4', true)).toBeUndefined();
    expect(parseInfo('info depth 10 currmove e2e4 currmovenumber 1', true)).toBeUndefined();
    expect(parseInfo('bestmove e2e4 ponder e7e5', true)).toBeUndefined();
    expect(parseInfo('info string NNUE evaluation using nn-61e7af4bb97d.nnue', true)).toBeUndefined();
  });
  it('formats scores', () => {
    expect([{ cp: 35 }, { cp: -120 }, { cp: 0 }, { mate: 3 }, { mate: -2 }].map(formatScore)).toEqual(['+0.35', '−1.20', '0.00', '#3', '#−2']);
  });
  it('maps scores onto the eval bar', () => {
    expect(whiteShare({ cp: 0 })).toBeCloseTo(0.5);
    expect(whiteShare({ cp: 300 })).toBeGreaterThan(0.75);
    expect(whiteShare({ mate: -1 })).toBe(0);
    expect(whiteShare({ mate: 2 })).toBe(1);
  });
});

describe('engine lines to SAN', () => {
  it('converts uci moves (including castling) to numbered SAN', async () => {
    const { pvToMoves } = await import('../../components/EnginePanel');
    const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3';
    const moves = pvToMoves(fen, ['g8f6', 'e1g1', 'f6e4', 'zzzz', 'a2a3']);
    expect(moves.map((m) => m.san)).toEqual(['Nf6', 'O-O', 'Nxe4']);
    expect(moves.map((m) => m.ply)).toEqual([6, 7, 8]);
  });
});
