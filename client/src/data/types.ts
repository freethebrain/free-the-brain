/* Row shapes — the widget's own (as injected into the template) and the service's (API contract v1). */

export type Score = "H" | "M" | "L";
export type OpenStatus = "Inbox" | "Planned" | "Active" | "Blocked";
export type Status = OpenStatus | "Done" | "Dropped";
export type DateType = "DL" | "SO" | "SB";
export type DateKind = "hard" | "self" | "agreed";

/** One OPEN row as the widget sees it: `id task cat u i st rec tri dl ty kind d note blk`. */
export interface Row {
  id: string;
  task: string;
  cat: string;
  u: Score | null;
  i: Score | null;
  st: OpenStatus;
  /** Recorded — ISO date. */
  rec: string;
  /** Triaged — ISO date or "" / null when never judged. */
  tri: string | null;
  /** Dated field — ISO date or "" when undated. */
  dl: string;
  /** "DL" | "SO" | "SB" | "" */
  ty: DateType | "";
  /** "hard" | "self" | "agreed" | "" */
  kind: DateKind | "";
  /** depth = number of dots in the id */
  d: number;
  note: string;
  /** short human label for what a Blocked row waits on */
  blk: string | null;
}

/** One CLOSED row: `id task cat done`. */
export interface DoneRow {
  id: string;
  task: string;
  cat: string;
  /** completion date, ISO */
  done: string;
}

/** The API's Task shape (docs/api-contract.md). */
export interface ApiTask {
  id: string;
  task: string;
  category: string;
  u: Score | null;
  i: Score | null;
  status: Status;
  recorded: string;
  triaged: string | null;
  deadline: string | null;
  deadline_type: DateType | null;
  deadline_kind: DateKind | null;
  done: string | null;
  notes: string | null;
  blocker: string | null;
  updated_at: string;
}

/** GET /api/v1/registry envelope. The fixture file uses the same shape. */
export interface RegistryEnvelope {
  stamp: string;
  today: string;
  rows: ApiTask[];
  counts?: { open: number; done: number; dropped: number; total: number };
  next_free_id?: string;
  reserved: [string, string, string] | string[];
}

/** What the template's injection block carried. */
export interface Injection {
  STAMP: string;
  TODAY: string;
  RESERVED: string[];
  NEXTNUM: number;
  ROWS: Row[];
  DONE: DoneRow[];
}
