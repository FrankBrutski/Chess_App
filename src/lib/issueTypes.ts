import type { Issue } from './model';

/** What kind of problem an import issue is, for the chips on the Import issues page. */
export type IssueType = 'illegal' | 'note-line' | 'transposition' | 'move-number' | 'bracket' | 'other';

export const ISSUE_TYPES: { id: IssueType; label: string }[] = [
  { id: 'illegal', label: 'Illegal move' },
  { id: 'note-line', label: 'Note line differs' },
  { id: 'transposition', label: 'Transposition' },
  { id: 'move-number', label: 'Move number' },
  { id: 'bracket', label: 'Bracket' },
  { id: 'other', label: 'Other' },
];

export const issueTypeLabel = (t: IssueType) => ISSUE_TYPES.find((x) => x.id === t)!.label;

/** Worked out from the check that found it, so issues saved by older imports get a type too. */
export function issueType(i: Issue): IssueType {
  switch (i.kind) {
    case 'unreadable-move': return 'illegal';
    case 'conflicting-moves': return 'transposition';
    case 'unmatched-bracket': return 'bracket';
    case 'empty-chapter': return 'other';
    case 'bad-bracket-line': {
      if (i.key.startsWith('stuck|')) return 'note-line';
      const m = i.message;
      if (/wrong move number/.test(m)) return 'move-number';
      if (/is not legal|never reaches|can't be played/.test(m)) return 'note-line';
      if (/"\("|"\)"|brackets are empty|side line opens/.test(m)) return 'bracket';
      return 'other';
    }
  }
  return 'other';
}

/** "Line 3: note at 9.cxd5: …" → the text without its "Line 3: ", which the type label shows instead. */
export function withoutLinePrefix(message: string): string {
  const rest = message.replace(/^Line \d+: /, '');
  return rest === message ? message : rest.charAt(0).toUpperCase() + rest.slice(1);
}
