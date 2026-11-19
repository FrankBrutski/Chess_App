import { getLichessEnabled } from './prefs';

const STUDY = /lichess\.org\/study\/([A-Za-z0-9]{8})(?:\/([A-Za-z0-9]{8}))?/;

export interface StudyRef {
  studyId: string;
  chapterId?: string;
}

export function parseStudyUrl(input: string): StudyRef | undefined {
  const trimmed = input.trim();
  const m = STUDY.exec(trimmed);
  if (m) return { studyId: m[1], chapterId: m[2] };
  if (/^[A-Za-z0-9]{8}$/.test(trimmed)) return { studyId: trimmed };
  return undefined;
}

export const studyUrl = (ref: StudyRef) =>
  `https://lichess.org/study/${ref.studyId}${ref.chapterId ? `/${ref.chapterId}` : ''}`;

/**
 * Download a study (or one chapter) as PGN from the Lichess API.
 * Public and unlisted studies need no token; private ones need a token with study:read.
 */
export async function fetchStudyPgn(ref: StudyRef, token?: string): Promise<string> {
  if (!getLichessEnabled()) throw new Error('Lichess downloads are switched off in Settings.');
  // Ids are checked to be 8 letters/digits, so the request can only ever go to lichess.org.
  if (!/^[A-Za-z0-9]{8}$/.test(ref.studyId) || (ref.chapterId && !/^[A-Za-z0-9]{8}$/.test(ref.chapterId))) {
    throw new Error('That does not look like a Lichess study link.');
  }
  const path = ref.chapterId ? `${ref.studyId}/${ref.chapterId}` : ref.studyId;
  const url = `https://lichess.org/api/study/${path}.pgn?comments=true&variations=true&clocks=false&orientation=true`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      credentials: 'omit', // never send cookies
      referrerPolicy: 'no-referrer',
    });
  } catch {
    throw new Error('Could not reach Lichess. Check your connection, or download the PGN and upload the file instead.');
  }
  if (res.status === 403) {
    throw new Error(
      token
        ? 'Lichess refused to export this study (403), even with your token. This usually means its owner turned off "Share & export" in the study settings; set it to Everyone, or ask the owner to.'
        : 'Lichess refused to export this study (403). This usually means its owner turned off "Share & export" in the study settings, or the study is private. If it is your study, set that to Everyone, or add a Lichess token in Settings.',
    );
  }
  if (res.status === 404 || res.status === 401) {
    throw new Error(
      `Lichess could not find this study (${res.status}). Check the link. If the study is private, add a Lichess token in Settings, or make it unlisted.`,
    );
  }
  if (res.status === 429) throw new Error('Lichess is limiting requests right now (429). Wait a minute and try again.');
  if (!res.ok) throw new Error(`Lichess returned an error (${res.status}). Try again in a minute.`);
  return res.text();
}
