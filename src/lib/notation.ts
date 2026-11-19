/**
 * Find chess notation in plain text (moves like "12...Nf6?" or "Bxf6", squares like "e5")
 * so the reader can show it in bold. Purely visual: nothing here is clickable.
 */
const NOTATION =
  /(?<![A-Za-z0-9])(?:\d+\s?(?:\.\.\.|…|\.)\s?)?(?:O-O(?:-O)?|[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h]x[a-h][1-8](?:=[QRBN])?|[a-h][1-8](?:=[QRBN])?)[+#]?[!?]{0,2}(?![A-Za-z0-9])/g;

export function splitNotation(text: string): { text: string; bold: boolean }[] {
  const out: { text: string; bold: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(NOTATION)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ text: text.slice(last, i), bold: false });
    out.push({ text: m[0], bold: true });
    last = i + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), bold: false });
  return out;
}

/**
 * Paragraphs of a note. Any run of line breaks, with or without a blank line between
 * (Lichess keeps whatever you typed), is one paragraph break, so every gap looks the same.
 */
export const splitParagraphs = (text: string): string[] => text.split(/[ \t]*(?:\r?\n[ \t]*)+/);
