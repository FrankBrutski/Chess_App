import { describe, expect, it } from 'vitest';
import type { RootNode } from '../model';
import { deleteNode, editNode, lineStart, playMove, promote, readyProblems } from '../stingTree';

const FEN = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 0 1';
const empty = (): RootNode => ({ id: 'root', ply: 0, fen: FEN, comments: [], shapes: [], children: [] });

describe('sting tree editing', () => {
  it('adds moves, reuses existing ones, and never mutates the input', () => {
    const r0 = empty();
    const a = playMove(r0, 'root', 'Qxf7')!;
    expect(r0.children).toHaveLength(0);
    expect(a.root.children[0]).toMatchObject({ san: 'Qxf7#', ply: 1, tag: 'best' });
    const again = playMove(a.root, 'root', 'Qxf7#')!;
    expect(again.id).toBe(a.id);
    expect(playMove(a.root, 'root', 'Ke3')).toBeUndefined(); // illegal
    const b = playMove(a.root, 'root', 'Bxf7+')!;
    expect(b.root.children.map((c) => [c.san, c.tag])).toEqual([['Qxf7#', 'best'], ['Bxf7+', undefined]]);
    expect(readyProblems(b.root)).toEqual(['Tag every first move: Bxf7+ has no tag yet.']);
  });

  it('one best line, which becomes the main line; notes and deleting', () => {
    let r = playMove(empty(), 'root', 'Qxf7')!.root;
    const bx = playMove(r, 'root', 'Bxf7+')!;
    r = editNode(bx.root, bx.id, { tag: 'best', comment: '  Also mates soon  ' });
    expect(r.children.map((c) => [c.san, c.tag])).toEqual([['Bxf7+', 'best'], ['Qxf7#', 'also']]);
    expect(r.children[0].comments).toEqual(['Also mates soon']);
    expect(readyProblems(r)).toEqual([]);
    const k = playMove(r, bx.id, 'Ke7')!;
    expect(lineStart(k.root, k.id)?.san).toBe('Bxf7+');
    const d = deleteNode(k.root, bx.id);
    expect(d.id).toBe('root');
    expect(d.root.children.map((c) => c.san)).toEqual(['Qxf7#']);
    expect(readyProblems(d.root)).toEqual(['Play the winning move and tag its line Best.']);
  });

  it('promotes a side line to the main continuation', () => {
    const a = playMove(empty(), 'root', 'Bxf7+')!;
    const k = playMove(a.root, a.id, 'Ke7')!;
    const m1 = playMove(k.root, k.id, 'Bb3')!;
    const m2 = playMove(m1.root, k.id, 'Qxe5+')!;
    const p = promote(m2.root, m2.id);
    expect(p.children[0].children[0].children.map((c) => c.san)).toEqual(['Qxe5+', 'Bb3']);
  });
});
