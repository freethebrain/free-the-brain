/**
 * Shapes from docs/api-contract.md (Registry Service API v1).
 * The row shape, the score / status / deadline enums and the queue entry come from @ftb/core
 * (ADR-2: one definition, every surface); what stays here is the wire envelope the service
 * wraps them in, and the judgment / capture request bodies the MCP tools send.
 */
import type { DeadlineType, QueueEntry, Score, Status } from '@ftb/core';

export type { DeadlineKind, DeadlineType, QueueEntry, Score, Status, Task, Tier } from '@ftb/core';

/** The MCP layer's historical name for a score. */
export type Level = Score;

import type { Task } from '@ftb/core';

export interface RegistryEnvelope {
  stamp: string;
  today: string;
  rows: Task[];
  counts: { open: number; done: number; dropped: number; total: number };
  next_free_id: string;
  reserved: string[];
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
