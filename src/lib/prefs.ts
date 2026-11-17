import { DEFAULT_LADDER, type MissPolicy } from './srs';

const read = (k: string) => {
  try { return localStorage.getItem(k); } catch { return null; }
};
const write = (k: string, v: string | null) => {
  try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* unavailable */ }
};

export const getToken = () => read('lichessToken') || undefined;
export const setToken = (v: string) => write('lichessToken', v.trim() || null);

/** Link moves in comments even without <...> around them. */
export const getAutoLink = () => read('autoLinkMoves') === '1';
export const setAutoLink = (on: boolean) => write('autoLinkMoves', on ? '1' : null);

/** Show moves and squares written in plain comment text in bold (not clickable). On by default. */
export const getBoldNotation = () => read('boldNotation') !== '0';
export const setBoldNotation = (on: boolean) => write('boldNotation', on ? null : '0');

/** Allow the app to download studies from lichess.org. When off, the app makes no network requests at all. */
export const getLichessEnabled = () => read('lichessEnabled') !== '0';
export const setLichessEnabled = (on: boolean) => write('lichessEnabled', on ? null : '0');

/** Engine analysis shown in the reader (on/off is remembered between visits). */
export const getEngineOn = () => read('engineOn') === '1';
export const setEngineOn = (on: boolean) => write('engineOn', on ? '1' : null);
/** Search depth; 0 = keep thinking until the position changes. */
export const getEngineDepth = () => Number(read('engineDepth') ?? 20);
export const setEngineDepth = (d: number) => write('engineDepth', String(d));
export const getEngineLines = () => Math.min(3, Math.max(1, Number(read('engineLines') ?? 2)));
export const setEngineLines = (n: number) => write('engineLines', String(n));

/** Order of lines in a comb: Chessable style (main line last) or main line first. */
export const getLineOrder = (): 'mainLast' | 'mainFirst' => (read('lineOrder') === 'mainFirst' ? 'mainFirst' : 'mainLast');
export const setLineOrder = (v: 'mainLast' | 'mainFirst') => write('lineOrder', v === 'mainLast' ? null : v);

/** Small markers beside moves for other lines (⑂) and transpositions (⇄). On by default. */
export const getShowMarkers = () => read('showMarkers') !== '0';
export const setShowMarkers = (on: boolean) => write('showMarkers', on ? null : '0');

// ---------- Trainer ----------

/** Review ladder in ms; editable in Settings. */
export function getLadder(): number[] {
  try {
    const v = JSON.parse(read('ladder') ?? 'null');
    if (Array.isArray(v) && v.length && v.every((x) => Number.isFinite(x) && x > 0)) return v;
  } catch { /* fall through */ }
  return DEFAULT_LADDER;
}
export const setLadder = (l: number[] | null) => write('ladder', l ? JSON.stringify(l) : null);

/** What a wrong answer in a review does to that move's step on the ladder. */
export const getMissPolicy = (): MissPolicy => {
  const v = read('missPolicy');
  return v === 'back1' || v === 'back2' ? v : 'reset';
};
export const setMissPolicy = (v: MissPolicy) => write('missPolicy', v === 'reset' ? null : v);

/** After a miss, replay from this many of your own moves back (0 = just retry the move). */
export const getRetryBack = () => Math.max(0, Math.min(9, Number(read('retryBack') ?? 2)));
export const setRetryBack = (n: number) => write('retryBack', String(n));

/** Show the notes during reviews (up to the current move, never ahead). */
export const getReviewNotes = () => read('reviewNotes') !== '0';
export const setReviewNotes = (on: boolean) => write('reviewNotes', on ? null : '0');

/** In Learn, show each new move with an arrow before you play it (Chessable style) instead of letting you guess first. */
export const getShowNewMoves = () => read('showNewMoves') === '1';
export const setShowNewMoves = (on: boolean) => write('showNewMoves', on ? '1' : null);

export const getHoneyLearn = () => Math.max(0, Number(read('honeyLearn') ?? 1));
export const getHoneyReview = () => Math.max(0, Number(read('honeyReview') ?? 2));
export const setHoneyLearn = (n: number) => write('honeyLearn', String(n));
export const setHoneyReview = (n: number) => write('honeyReview', String(n));

export interface TrainScope {
  hive: string; // '' = all, 'white' / 'black' = by colour, else a hive id
  section: string; // '' = all
  comb: string; // '' = all
  mainHivesOnly: boolean;
  mainLinesOnly: boolean;
}
export const getScope = (): TrainScope => {
  const base: TrainScope = { hive: '', section: '', comb: '', mainHivesOnly: false, mainLinesOnly: false };
  try { return { ...base, ...(JSON.parse(read('trainScope') ?? '{}') as Partial<TrainScope>) }; } catch { return base; }
};
export const setScope = (s: TrainScope) => write('trainScope', JSON.stringify(s));

// ---------- Reading text ----------

export interface TextPrefs {
  size: number; // px
  weight: number; // notes: 300 light, 400 regular, 500 medium
  moveWeight: number; // moves: 500, 600, 700
  leading: number; // line height
  tight: boolean; // slightly tighter letter spacing
  font: 'system' | 'serif';
  paraGap: number; // em of space for a blank line in a study comment
}
export const DEFAULT_TEXT: TextPrefs = { size: 16, weight: 400, moveWeight: 600, leading: 1.4, tight: true, font: 'system', paraGap: 0.6 };
export function getTextPrefs(): TextPrefs {
  try { return { ...DEFAULT_TEXT, ...(JSON.parse(read('textPrefs') ?? '{}') as Partial<TextPrefs>) }; } catch { return DEFAULT_TEXT; }
}
export function setTextPrefs(t: TextPrefs) {
  write('textPrefs', JSON.stringify(t));
  applyTextPrefs(t);
}
/** Push the reading-text settings into CSS variables (system fonts only; nothing is downloaded). */
export function applyTextPrefs(t: TextPrefs = getTextPrefs()) {
  const r = document.documentElement.style;
  r.setProperty('--read-size', `${t.size}px`);
  r.setProperty('--read-weight', String(t.weight));
  r.setProperty('--move-weight', String(t.moveWeight));
  r.setProperty('--read-leading', String(t.leading));
  r.setProperty('--para-gap', `${t.paraGap}em`);
  r.setProperty('--read-tracking', t.tight ? '-0.01em' : '0');
  r.setProperty(
    '--read-font',
    t.font === 'serif' ? '"Iowan Old Style", "Palatino Linotype", Georgia, serif' : '-apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", sans-serif',
  );
}

// ---------- Appearance ----------

export type Theme = 'auto' | 'light' | 'dark';
export const getTheme = (): Theme => {
  const v = read('theme');
  return v === 'light' || v === 'dark' ? v : 'auto';
};
/** Auto follows the phone's Light/Dark setting; Light or Dark overrides it. */
export function applyTheme(t: Theme = getTheme()) {
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}
export function setTheme(t: Theme) {
  write('theme', t === 'auto' ? null : t);
  applyTheme(t);
}
