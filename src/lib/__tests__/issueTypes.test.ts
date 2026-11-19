import { describe, expect, it } from 'vitest';
import { parseChapters } from '../pgn';
import { checkChapter } from '../checker';
import { issueType, withoutLinePrefix } from '../issueTypes';

const PGN = `[ChapterName "Types"]\n[Orientation "black"]\n\n1. d4 Nf6 2. c4 { <2...e5 4. d5> } 2... g6 { <3. Nc3 Bg7 4. Bxf7> } 3. Nc3 { a stray < here } 3... Bg7 4. e4 { <If 4...d6 5. f4 then 6. Qxh8 wins> } 4... d6 *`;

describe('issue types', () => {
  it('names each check by what went wrong', () => {
    const [c] = parseChapters(PGN);
    const types = checkChapter(c).map((i) => [issueType(i), i.message]);
    expect(types.map((t) => t[0]).sort()).toEqual(['bracket', 'move-number', 'note-line', 'note-line']);
  });

  it('maps the import-time kinds', () => {
    const base = { severity: 'warning' as const, message: '', key: 'k' };
    expect(issueType({ ...base, kind: 'unreadable-move' })).toBe('illegal');
    expect(issueType({ ...base, kind: 'conflicting-moves' })).toBe('transposition');
    expect(issueType({ ...base, kind: 'empty-chapter' })).toBe('other');
    expect(issueType({ ...base, kind: 'bad-bracket-line', message: 'Bracketed line in the note at 1.d4: a "(" side line is never closed with ")".' })).toBe('bracket');
  });

  it('drops the "Line n:" prefix the label now shows', () => {
    expect(withoutLinePrefix('Line 3: note at 9.cxd5: …')).toBe('Note at 9.cxd5: …');
    expect(withoutLinePrefix('Same position, …')).toBe('Same position, …');
  });
});
