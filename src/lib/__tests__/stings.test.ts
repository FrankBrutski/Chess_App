import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { addScreenshots, deleteSting, stingCounts } from '../stings';

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
});
