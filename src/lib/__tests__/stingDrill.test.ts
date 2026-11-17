import { describe, expect, it } from 'vitest';
import type { RootNode, Sting } from '../model';
import { playMove, editNode } from '../stingTree';
import { cellKey, honeyFor, judgeFirst, judgeLater, planDrill, scoreFor } from '../stingDrill';

const FEN = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 0 1';
function card(): RootNode {
  let r: RootNode = { id: 'root', ply: 0, fen: FEN, comments: [], shapes: [], children: [] };
  r = playMove(r, 'root', 'Qxf7#')!.root; // best
  const b = playMove(r, 'root', 'Bxf7+')!;
  r = editNode(b.root, b.id, { tag: 'refute' });
  const k = playMove(r, b.id, 'Ke7')!;
  return k.root;
}

describe('sting drill', () => {
  it('judges first moves by tag, ignoring check marks', () => {
    const r = card();
    expect(judgeFirst(r, 'Qxf7').kind).toBe('best');
    expect(judgeFirst(r, 'Bxf7+').kind).toBe('refute');
    expect(judgeFirst(r, 'Nf3').kind).toBe('unknown');
    const bx = r.children.find((c) => c.san === 'Bxf7+')!;
    expect(judgeLater(bx, 'Ke7')).toMatchObject({ ok: true });
    expect(judgeLater(bx, 'Kf8')).toEqual({ ok: false, side: undefined });
  });

  it('honey follows the +4.00 / 2.00 rules', () => {
    expect(honeyFor('best', 3)).toBe(3);
    expect(honeyFor('also', 3, { played: 650, best: 800 })).toBe(3);
    expect(honeyFor('also', 3, { played: 450, best: 900 })).toBe(2); // more than 2.00 worse
    expect(honeyFor('also', 3, { played: 300, best: 320 })).toBe(2); // not above +4.00
    expect(honeyFor('also', 3)).toBe(3); // no engine: trust the notes
    expect(honeyFor('extra', 3, { played: 520 })).toBe(2);
    expect(honeyFor('extra', 3, { played: 150 })).toBe(0);
    expect(scoreFor({ mate: 2 }, true)).toBeGreaterThan(90_000);
    expect(scoreFor({ cp: -500 }, false)).toBe(500);
  });

  it('plans due cards first, then new ones', () => {
    const base = { status: 'ready' as const, updatedAt: 0, root: card() };
    const cards: Sting[] = [
      { ...base, id: 'a', createdAt: 3 },
      { ...base, id: 'b', createdAt: 1 },
      { ...base, id: 'c', createdAt: 2 },
      { ...base, id: 'd', createdAt: 0, status: 'progress' },
    ];
    const cells = new Map([[cellKey('a'), { key: cellKey('a'), level: 1, due: 5, learnedAt: 0, lapses: 0 }], [cellKey('c'), { key: cellKey('c'), level: 1, due: 50, learnedAt: 0, lapses: 0 }]]);
    expect(planDrill(cards, cells, 10, 5).map((c) => c.id)).toEqual(['a', 'b']);
  });
});
