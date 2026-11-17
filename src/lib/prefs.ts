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
