/**
 * Shapes from docs/api-contract.md (Registry Service API v1).
 * Kept local to mcp/ until packages/core exports them; the two must agree
 * with the contract, not with each other.
 */

export type Level = 'H' | 'M' | 'L';
export type Status = 'Inbox' | 'Planned' | 'Active' | 'Blocked' | 'Done' | 'Dropped';
export type DeadlineType = 'DL' | 'SO' | 'SB';
export type DeadlineKind = 'hard' | 'self' | 'agreed';

export interface Task {
  id: string;
  task: string;
  category: string;
  u: Level | null;
  i: Level | null;
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

export interface RegistryEnvelope {
  stamp: string;
  today: string;
  rows: Task[];
  counts: { open: number; done: number; dropped: number; total: number };
  next_free_id: string;
  reserved: string[];
}

export interface QueueEntry {
  top: Task;
  rows: Task[];
  tier: 1 | 2 | 3 | 4 | 5;
  key: unknown;
}

export interface QueueResponse {
  monday: string;
  entries: QueueEntry[];
  total: number;
  page: number;
  chunk: number;
  /** Not in the contract table but the service may send it; we fall back to the device clock. */
  today?: string;
}

export interface RadarResponse {
  overdue: Task[];
  today_tomorrow: Task[];
  fortnight: Task[];
  passed_not_overdue: Task[];
  further: Task[];
  dormant: Task[];
  undated: Task[];
  today?: string;
}

export interface JudgmentDeadline {
  type: DeadlineType;
  date: string;
}

export interface Judgment {
  id: string;
  u?: Level;
  i?: Level;
  status?: Status;
  category?: string;
  deadline?: JudgmentDeadline | 'none';
  reopen?: 'Planned' | 'Active' | 'Blocked' | 'Dropped';
  note?: string;
}

export interface JudgmentBatch {
  actor: string;
  source: 'mcp';
  human_judgment: boolean;
  today?: string;
  judgments: Judgment[];
}

export interface JudgmentsResponse {
  applied: number;
  rejected: { id: string; reason: string }[];
  delta_stamp: string;
}

export interface CaptureItem {
  task: string;
  category?: string;
  notes?: string;
}
