import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { addScreenshots, deleteSting, saveCrop, savePosition, stingCounts } from '../stings';

const fakeCompress = async (f: Blob) => ({ blob: f, width: 10, height: 20 });
const file = (name: string, bad = false) => Object.assign(new Blob([bad ? '' : 'x']), { name }) as File;

describe('stings inbox', () => {
  beforeEach(async () => {
    await db.stings.clear();
    await db.shots.clear();
  });

  it('adds one Inbox card per screenshot, in picker order, and reports failures', async () => {
    const compress = async (f: Blob) => {
      if ((f as File).name === 'bad.png') throw new Error('nope');
      return fakeCompress(f);
    };
    const res = await addScreenshots([file('a.png'), file('bad.png'), file('b.png')], compress);
    expect(res).toEqual({ added: 2, failed: ['bad.png'] });
    const cards = await db.stings.orderBy('createdAt').toArray();
    expect(cards.map((c) => c.status)).toEqual(['inbox', 'inbox']);
    expect(await db.shots.count()).toBe(2);
    expect(await stingCounts()).toEqual({ inbox: 2, progress: 0, ready: 0 });
  });

  it('deleting a card removes its screenshot too', async () => {
    await addScreenshots([file('a.png')], fakeCompress);
    const [c] = await db.stings.toArray();
    await deleteSting(c.id);
    expect(await db.stings.count()).toBe(0);
    expect(await db.shots.count()).toBe(0);
  });

  it('cropping replaces the screenshot; saving a position moves the card to In progress', async () => {
    await addScreenshots([file('a.png')], fakeCompress);
    const [c] = await db.stings.toArray();
    await saveCrop(c.id, { blob: new Blob(['crop']), width: 8, height: 8 });
    expect((await db.shots.get(c.shotId!))?.width).toBe(8);
    expect(await db.shots.count()).toBe(1);
    const fen = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4';
    await savePosition(c.id, fen, { title: 'Scholar' });
    let s = (await db.stings.get(c.id))!;
    expect([s.status, s.cropped, s.title, s.root?.ply, s.root?.fen]).toEqual(['progress', true, 'Scholar', 6, fen]);
    // Explored lines survive re-saving the same position, and reset when it changes.
    await db.stings.update(c.id, { root: { ...s.root!, comments: ['kept'] } });
    await savePosition(c.id, fen);
    expect((await db.stings.get(c.id))!.root!.comments).toEqual(['kept']);
    await savePosition(c.id, fen.replace(' w ', ' b '));
    s = (await db.stings.get(c.id))!;
    expect([s.root!.comments, s.root!.ply]).toEqual([[], 7]);
  });
});
