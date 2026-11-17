import { describe, expect, it } from 'vitest';
import { parseChapters } from '../pgn';
import { annotateChapter } from '../annotations';
import { stripLineMarker } from '../lines';

const PGN = `[Event "Study: Breaks"]

1. e4 { [Line: King's pawn] First line.
Second line.

New paragraph with <1... e5 2. Nf3>.

Last paragraph. } 1... e5 *
`;

describe('comment line breaks', () => {
  it('stripLineMarker keeps line breaks and paragraph gaps', () => {
    expect(stripLineMarker('[Line: X]  A  b.\nC.\n\nD.')).toBe('A b.\nC.\n\nD.');
  });

  it('a multi-paragraph study comment keeps its breaks around bracket lines', () => {
    const [ch] = parseChapters(PGN);
    const e4 = ch.root.children[0];
    const ann = annotateChapter(ch.root).get(e4.id)!;
    const pieces = ann.after[0];
    const text = pieces.filter((p) => p.kind === 'text').map((p) => (p as { text: string }).text);
    expect(text[0]).toBe("First line.\nSecond line.\n\nNew paragraph with ");
    expect(text[text.length - 1]).toBe('.\n\nLast paragraph.');
    expect(pieces.some((p) => p.kind === 'move')).toBe(true);
  });
});

it('auto-linked moves in plain text keep the breaks too', () => {
  const [ch] = parseChapters(PGN.replace('<1... e5 2. Nf3>', '1...e5 2.Nf3'));
  const ann = annotateChapter(ch.root, { auto: true }).get(ch.root.children[0].id)!;
  const joined = ann.after[0].map((p) => ('text' in p ? p.text : '')).join('|');
  expect(joined).toContain('Second line.\n\nNew paragraph');
  expect(joined).toContain('\n\nLast paragraph.');
});
