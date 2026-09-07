// The Task row shape from docs/api-contract.md, plus the parsed-file shapes every surface shares.
// One definition so the service, client and MCP server never drift on what a row is.

export type Score = 'H' | 'M' | 'L';
export type Status = 'Inbox' | 'Planned' | 'Active' | 'Blocked' | 'Done' | 'Dropped';
export type DeadlineType = 'DL' | 'SO' | 'SB';
export type DeadlineKind = 'hard' | 'self' | 'agreed';

export const STATUSES: readonly Status[] = ['Inbox', 'Planned', 'Active', 'Blocked', 'Done', 'Dropped'];
export const SCORES: readonly Score[] = ['H', 'M', 'L'];
export const DEADLINE_TYPES: readonly DeadlineType[] = ['DL', 'SO', 'SB'];
export const CLOSED_STATUSES: readonly Status[] = ['Done', 'Dropped'];

export interface Task {
  id: string;
  task: string;
  category: string;
  u: Score | null;
  i: Score | null;
  status: Status;
  recorded: string;
  triaged: string | null;
  deadline: string | null;
  deadline_type: DeadlineType | null;
  deadline_kind: DeadlineKind | null;
  done: string | null;
  notes: string;
  blocker: string | null;
  updated_at: string;
}

export interface Counts {
  open: number;
  done: number;
  dropped: number;
  total: number;
}

/** The registry's column names, in table order. Delta field names match these exactly. */
export const FIELDS = [
  'ID',
  'Task',
  'Category',
  'U',
  'I',
  'Status',
  'Recorded',
  'Triaged',
  'Deadline',
  'Done',
  'Notes',
] as const;
export type Field = (typeof FIELDS)[number];

/** Fields a delta line may set (everything but the ID, which is the line's subject). */
export const SETTABLE_FIELDS = FIELDS.filter((f) => f !== 'ID') as Exclude<Field, 'ID'>[];
export type SettableField = Exclude<Field, 'ID'>;

export interface Snapshot {
  /** YYYY-MM-DD-HHMM, from the file title (or the "Last synced:" line when parsing bare text). */
  stamp: string;
  /** Everything above the table header, verbatim. */
  preamble: string;
  rows: Task[];
  /** Anything after the table (an appendix, say), verbatim. Empty when there is none. */
  postamble: string;
  /** From the preamble's "COUNT" line, when present. */
  counts?: Counts;
  /** From the preamble's "Next free ID" phrase, when present. */
  nextFreeId?: string;
}

export interface Change {
  id: string;
  /** The task name carried in parentheses after the ID (may be empty). */
  name: string;
  isNew: boolean;
  renumberedFrom?: string;
  /** Field=value assignments, raw text as written. Deadline=none is kept as the literal "none". */
  sets: Partial<Record<SettableField, string>>;
  /** note+= texts, in order. */
  noteAppends: string[];
}

export interface Delta {
  stamp: string;
  /** The Base: line, as written (normally "Task Registry — YYYY-MM-DD-HHMM.md"). */
  base: string;
  /** The stamp extracted from the Base: line, or null when it carries none. */
  baseStamp: string | null;
  priorDeltas: string[];
  changes: Change[];
  forNextCompaction?: string;
  /** Non-fatal oddities met while parsing (unknown fields, lines that were skipped). */
  warnings: string[];
}
