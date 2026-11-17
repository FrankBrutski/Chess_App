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
}

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
  courseId: string;
  order: number;
  title: string;
  orientation: 'white' | 'black';
  lichessChapterId?: string;
  root: RootNode;
  issues?: Issue[];
  importedAt: number;
}

export interface Course {
  id: string;
  name: string;
  /** Lichess study URL when the course is linked to a live study. */
  sourceUrl?: string;
  lichessStudyId?: string;
  createdAt: number;
  updatedAt: number;
}

export const isMove = (n: TreeNode): n is MoveNode => n.id !== 'root';
