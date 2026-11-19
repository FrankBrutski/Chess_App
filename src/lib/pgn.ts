import { parsePgn, startingPosition, parseComment, type Game, type PgnNodeData, type Node as PgnNode, type ChildNode } from 'chessops/pgn';
import { parseSan } from 'chessops/san';
import { makeFen } from 'chessops/fen';
import { makeUci, makeSquare } from 'chessops/util';
import type { Position } from 'chessops/chess';
import { plyOf } from './boardMove';
import { epd } from './fen';
import type { Chapter, Issue, MoveNode, RootNode, Shape } from './model';

export interface ParsedChapter {
  title: string;
  orientation: 'white' | 'black';
  lichessChapterId?: string;
  studyName?: string;
  lichessStudyId?: string;
  root: RootNode;
  /** Moves that could not be read (illegal SAN etc.); the rest of that branch is skipped. */
  unreadable: UnreadableMove[];
}

export interface UnreadableMove {
  san: string;
  ply: number;
  /** The last move that could be read (where the branch stops). */
  parentId: string;
  onMainLine: boolean;
}

const epdOf = (pos: Position) => epd(makeFen(pos.toSetup()));

/** Split raw PGN comments into readable text and board shapes. */
export function splitComments(raw: string[] | undefined): { texts: string[]; shapes: Shape[] } {
  const texts: string[] = [];
  const shapes: Shape[] = [];
  for (const c of raw ?? []) {
    const parsed = parseComment(c);
    const text = parsed.text.trim();
    if (text) texts.push(text);
    for (const s of parsed.shapes) {
      shapes.push(
        s.from === s.to
          ? { color: s.color, orig: makeSquare(s.from) }
          : { color: s.color, orig: makeSquare(s.from), dest: makeSquare(s.to) },
      );
    }
  }
  return { texts, shapes };
}

function convertChildren(
  parent: PgnNode<PgnNodeData>,
  pos: Position,
  ply: number,
  ids: { n: number },
  bad: UnreadableMove[],
  parentId: string,
  onMain: boolean,
): MoveNode[] {
  const out: MoveNode[] = [];
  (parent.children as ChildNode<PgnNodeData>[]).forEach((child, idx) => {
    const move = parseSan(pos, child.data.san);
    if (!move) {
      bad.push({ san: child.data.san, ply: ply + 1, parentId, onMainLine: onMain && idx === 0 });
      return;
    }
    const key = `${epdOf(pos)}|${makeUci(move)}`;
    const next = pos.clone();
    const san = child.data.san;
    next.play(move);
    const after = splitComments(child.data.comments);
    const before = splitComments(child.data.startingComments);
    const id = `n${ids.n++}`;
    out.push({
      id,
      ply: ply + 1,
      san,
      uci: makeUci(move),
      fen: makeFen(next.toSetup()),
      key,
      comments: after.texts,
      startingComments: before.texts,
      nags: child.data.nags ?? [],
      shapes: [...before.shapes, ...after.shapes],
      children: convertChildren(child, next, ply + 1, ids, bad, id, onMain && idx === 0),
    });
  });
  return out;
}

const STUDY_URL = /lichess\.org\/study\/([A-Za-z0-9]{8})(?:\/([A-Za-z0-9]{8}))?/;

export function convertGame(game: Game<PgnNodeData>, index: number): ParsedChapter {
  const h = game.headers;
  const unreadable: UnreadableMove[] = [];
  const posResult = startingPosition(h);
  if (posResult.isErr) throw new Error(`Chapter ${index + 1}: invalid starting position (FEN header).`);
  const pos = posResult.value;
  const startPly = plyOf(pos);
  const rootComments = splitComments(game.comments);
  const ids = { n: 1 };
  const root: RootNode = {
    id: 'root',
    ply: startPly,
    fen: makeFen(pos.toSetup()),
    comments: rootComments.texts,
    shapes: rootComments.shapes,
    children: convertChildren(game.moves, pos, startPly, ids, unreadable, 'root', true),
  };

  const event = h.get('Event') ?? '';
  const chapterName = h.get('ChapterName');
  const studyName = h.get('StudyName') ?? (event.includes(': ') ? event.split(': ')[0] : undefined);
  const title =
    chapterName ??
    (event.includes(': ') ? event.split(': ').slice(1).join(': ') : event && event !== '?' ? event : `Chapter ${index + 1}`);
  const orientationHeader = (h.get('Orientation') ?? '').toLowerCase();
  const orientation: 'white' | 'black' = orientationHeader === 'black' ? 'black' : 'white';
  const url = h.get('ChapterURL') ?? h.get('Site') ?? '';
  const m = STUDY_URL.exec(url);

  return {
    title,
    orientation,
    studyName,
    lichessStudyId: m?.[1],
    lichessChapterId: m?.[2],
    root,
    unreadable,
  };
}

/** Parse a PGN file (one or many games/chapters) into chapters. */
export function parseChapters(pgnText: string): ParsedChapter[] {
  const games = parsePgn(pgnText.replace(/^﻿/, ''));
  return games.map((g, i) => convertGame(g, i));
}

export function toChapter(
  p: ParsedChapter,
  courseId: string,
  sectionId: string,
  order: number,
  id: string,
  issues: Issue[] = [],
  orientation: 'white' | 'black' = p.orientation,
): Chapter {
  return {
    id,
    courseId,
    sectionId,
    order,
    title: p.title,
    orientation,
    lichessChapterId: p.lichessChapterId,
    ...(p.lichessStudyId ? { lichessStudyId: p.lichessStudyId } : {}),
    root: p.root,
    issues,
    importedAt: Date.now(),
  };
}
