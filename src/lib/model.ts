/** Arrow or circle drawn in a Lichess study comment ([%cal] / [%csl]). */
export interface Shape {
  color: 'green' | 'red' | 'yellow' | 'blue';
  orig: string; // square name, e.g. "e2"
  dest?: string; // missing = circle on orig
}

/** One move in a chapter's variation tree. children[0] is the main line. */
export interface MoveNode {
  id: string;
  ply: number; // ply after this move (1 = after White's first move)
  san: string;
  uci: string;
  fen: string; // position after the move
  /** Position before the move + the move. Stable key used to keep progress across re-imports. */
  key: string;
  comments: string[];
  startingComments: string[];
  nags: number[];
  shapes: Shape[];
  children: MoveNode[];
  /** Stings only: what a line from the puzzle position is (set on its first move). */
  tag?: LineTag;
}

/** best = the line to play; also = also wins; refute = a tempting move that fails; idea = explainer, never drilled. */
export type LineTag = 'best' | 'also' | 'refute' | 'idea';

export interface RootNode {
  id: 'root';
  ply: number; // ply of the starting position (0 for the normal start)
  fen: string;
  comments: string[];
  shapes: Shape[];
  children: MoveNode[];
}

export type TreeNode = RootNode | MoveNode;

/** Something the import checker found. Errors affect the main line; warnings never block. */
export interface Issue {
  severity: 'error' | 'warning';
  kind: 'unreadable-move' | 'bad-bracket-line' | 'unmatched-bracket' | 'conflicting-moves' | 'empty-chapter';
  message: string;
  /** Node to jump to in the reader. */
  nodeId?: string;
  /** Stable identity, used to tell which issues a re-sync fixed. */
  key: string;
}

export interface Chapter {
  id: string;
  /** The hive (repertoire) this comb belongs to. */
  courseId: string;
  /** The section within the hive. */
  sectionId: string;
  /** Position within its section. */
  order: number;
  title: string;
  orientation: 'white' | 'black';
  lichessChapterId?: string;
  root: RootNode;
  issues?: Issue[];
  /** Your own names for lines, by line id (see lib/lines.ts). Kept across re-syncs. */
  lineNames?: Record<string, string>;
  /** Your own line order, by line id (Move up / Move down on the comb page). Kept across re-syncs. */
  lineOrder?: string[];
  /** Line ids you chose not to drill. Kept across re-syncs. */
  skipLines?: string[];
  /** true = don't drill any line of this comb. */
  skip?: boolean;
  importedAt: number;
}

/** A group of combs inside a hive, usually one Lichess study or one theme. */
export interface Section {
  id: string;
  name: string;
  /** Lichess study this section syncs from, if any. */
  sourceUrl?: string;
  lichessStudyId?: string;
  /** true = don't drill this section. */
  skip?: boolean;
}

/** A hive = one repertoire, e.g. "King's Gambit" as White, main. */
export interface Course {
  id: string;
  name: string;
  /** The side you play in this repertoire. */
  color: 'white' | 'black';
  /** 1 = main, 2 = secondary, 3 = tertiary, ... */
  tier: number;
  /** Position among hives of the same colour and tier. */
  order: number;
  sections: Section[];
  /** true = don't drill this hive (it stays readable). */
  skip?: boolean;
  /** @deprecated moved to Section; kept so old data can be migrated. */
  sourceUrl?: string;
  /** @deprecated moved to Section. */
  lichessStudyId?: string;
  createdAt: number;
  updatedAt: number;
}


// ---------- Tactics (Stings) ----------

/** Inbox = just a screenshot; In progress = position set; Ready = has a best line and is drilled. */
export type StingStatus = 'inbox' | 'progress' | 'ready';

export type SourceKind = 'mine' | 'online' | 'otb' | 'video' | 'book';

export interface StingSource {
  kind?: SourceKind;
  platform?: string;
  timeControl?: string;
  date?: string;
  white?: string;
  black?: string;
  event?: string;
  url?: string;
  /** Free notes, e.g. "Round 5" or the video title. */
  note?: string;
}

export interface Sting {
  id: string;
  status: StingStatus;
  createdAt: number;
  updatedAt: number;
  /** The screenshot (or, once cropped, just the board) in the `shots` table. */
  shotId?: string;
  /** The screenshot has been cut down to just the board (the rest is not kept). */
  cropped?: boolean;
  /** Board shown from this side (defaults to the side to move). */
  orientation?: 'white' | 'black';
  fen?: string;
  title?: string;
  themes?: string[];
  root?: RootNode;
  source?: StingSource;
}

/** A compressed image kept only on this phone. */
export interface Shot {
  id: string;
  blob: Blob;
  width: number;
  height: number;
}
