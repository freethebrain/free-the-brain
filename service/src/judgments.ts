// Turns judgment batches (JSON body or the Master widget's Send-results text) into core Changes,
// and enforces the covenant: without human_judgment: true, nothing may touch u, i, status,
// deadline, category or triaged. Note-only batches pass. Validation here, persistence in writes.ts.

import type { Change, DeadlineType, Score, Status, Task } from '@ftb/core';
import { CLOSED_STATUSES, DEADLINE_TYPES, SCORES, STATUSES } from '@ftb/core';

export const COVENANT_FIELDS = ['u', 'i', 'status', 'deadline', 'category', 'triaged', 'reopen'] as const;

export interface DeadlineInput {
  type?: string;
  date: string;
}

export interface Judgment {
  id: string;
  u?: string;
  i?: string;
  status?: string;
  category?: string;
  deadline?: 'none' | string | DeadlineInput;
  reopen?: string;
  /** Explicit override of the Triaged date; normally derived as today from any judgment field. */
  triaged?: string;
  note?: string;
}

export interface JudgmentBatch {
  actor: string;
  source: string;
  human_judgment?: boolean;
  today?: string;
  judgments: Judgment[];
}

export class CovenantError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'CovenantError';
  }
}

export class BadRequest extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'BadRequest';
  }
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function isJudgmentField(j: Judgment): boolean {
  return COVENANT_FIELDS.some((f) => j[f] !== undefined);
}

/** Throws CovenantError when a batch touches protected fields without attestation. */
export function checkCovenant(batch: Pick<JudgmentBatch, 'human_judgment' | 'judgments'>): void {
  if (batch.human_judgment === true) return;
  const offenders = batch.judgments.filter(isJudgmentField);
  if (offenders.length === 0) return;
  const fields = new Set<string>();
  for (const j of offenders) for (const f of COVENANT_FIELDS) if (j[f] !== undefined) fields.add(f);
  throw new CovenantError(
    `Changing ${[...fields].join(', ')} on ${offenders.map((j) => j.id).join(', ')} requires human_judgment: true. Triage is a human act; automation stages it.`,
  );
}

function score(v: string, field: string): Score {
  const t = v.trim().toUpperCase();
  if (!(SCORES as readonly string[]).includes(t)) throw new BadRequest(`${field} must be H, M or L (got "${v}")`);
  return t as Score;
}

function status(v: string): Status {
  const hit = STATUSES.find((s) => s.toLowerCase() === v.trim().toLowerCase());
  if (!hit) throw new BadRequest(`Unknown status "${v}"`);
  return hit;
}

/** "none" | "SB 2026-09-15" | "2026-09-15" | {type, date} → the Deadline column text. */
export function deadlineText(v: Judgment['deadline']): string {
  if (v === undefined) throw new BadRequest('deadline missing');
  if (typeof v === 'string') {
    const t = v.trim();
    if (/^(none|no date)$/i.test(t)) return 'none';
    const m = /^(DL|SO|SB)?\s*(\d{4}-\d{2}-\d{2})$/i.exec(t);
    if (!m) throw new BadRequest(`Unparseable deadline "${v}"`);
    return `${(m[1] ?? 'DL').toUpperCase()} ${m[2]}`;
  }
  if (!v.date || !ISO.test(v.date)) throw new BadRequest(`deadline.date must be YYYY-MM-DD`);
  const type = (v.type ?? 'DL').toUpperCase();
  if (!(DEADLINE_TYPES as readonly string[]).includes(type)) throw new BadRequest(`deadline.type must be DL, SO or SB`);
  return `${type as DeadlineType} ${v.date}`;
}

export interface Rejection {
  id: string;
  reason: string;
}

/**
 * Build the Change for one judgment against the row's current state. Returns a rejection instead
 * of throwing for per-row problems (unknown id, reopen on an open row), so a batch reports them.
 */
export function judgmentToChange(j: Judgment, row: Task | null, today: string): { change: Change } | { rejected: Rejection } {
  if (!row) return { rejected: { id: j.id, reason: 'unknown id' } };
  const change: Change = { id: j.id, name: row.task, isNew: false, sets: {}, noteAppends: [] };
  const closed = CLOSED_STATUSES.includes(row.status);

  if (j.reopen !== undefined) {
    if (!closed) return { rejected: { id: j.id, reason: `reopen is only valid on a closed row (status is ${row.status})` } };
    const st = status(j.reopen);
    if (st === 'Done' || st === 'Inbox') return { rejected: { id: j.id, reason: `cannot reopen as ${st}` } };
    change.sets.Status = st;
    change.sets.Done = '—';
  }
  if (j.status !== undefined) {
    const st = status(j.status);
    change.sets.Status = st;
    if (st === 'Done' || st === 'Dropped') change.sets.Done = today;
    else if (closed && j.reopen === undefined) change.sets.Done = '—';
  }
  if (j.u !== undefined) change.sets.U = score(j.u, 'u');
  if (j.i !== undefined) change.sets.I = score(j.i, 'i');
  if (j.category !== undefined) {
    if (!j.category.trim()) throw new BadRequest(`${j.id}: category must not be empty`);
    change.sets.Category = j.category.trim();
  }
  if (j.deadline !== undefined) change.sets.Deadline = deadlineText(j.deadline);
  if (j.note !== undefined && j.note.trim()) change.noteAppends.push(j.note.trim());
  if (isJudgmentField(j)) change.sets.Triaged = today;
  if (j.triaged !== undefined) {
    if (!ISO.test(j.triaged)) throw new BadRequest(`${j.id}: triaged must be YYYY-MM-DD`);
    change.sets.Triaged = j.triaged;
  }

  if (Object.keys(change.sets).length === 0 && change.noteAppends.length === 0) {
    return { rejected: { id: j.id, reason: 'empty judgment' } };
  }
  return { change };
}

// ---- The Master widget's Send-results text ----------------------------------------------------

export interface ParsedText {
  today: string | null;
  stagedFrom: string | null;
  judgments: Judgment[];
  captures: { id: string | null; task: string }[];
}

const LINE = /^(T-\d+(?:\.\d+)*)\s*(?:\((.*?)\))?\s*:\s*(.*)$/;

/**
 * TRIAGE — Master widget — YYYY-MM-DD (staged from …)
 * T-041 (chase Ian): U=H I=M status=Planned deadline=SB 2026-09-15 note: free text
 * T-052 (book dentist): deadline=no date
 * T-070 (x): REOPEN status=Planned note: why
 *
 * NEW TASKS:
 * T-101: captured line
 */
export function parseSendResults(text: string): ParsedText {
  const out: ParsedText = { today: null, stagedFrom: null, judgments: [], captures: [] };
  let inNew = false;
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (/^TRIAGE\b/i.test(line)) {
      out.today = /(\d{4}-\d{2}-\d{2})/.exec(line)?.[1] ?? null;
      out.stagedFrom = /staged from\s+(\d{4}-\d{2}-\d{2}-\d{4})/i.exec(line)?.[1] ?? null;
      continue;
    }
    if (/^NEW TASKS\s*:?$/i.test(line)) {
      inNew = true;
      continue;
    }
    const m = LINE.exec(line);
    if (!m) throw new BadRequest(`Unparseable line: "${line}"`);
    const [, id, , rest] = m;
    if (inNew) {
      out.captures.push({ id: id!, task: rest!.trim() });
      continue;
    }
    const j: Judgment = { id: id! };
    let body = rest!;
    const noteIdx = body.search(/(?:^|\s)note:\s?/i);
    if (noteIdx >= 0) {
      j.note = body.slice(noteIdx).replace(/^\s*note:\s?/i, '').trim();
      body = body.slice(0, noteIdx);
    }
    if (/\bREOPEN\b/.test(body)) {
      const st = /\bstatus=(\w+)/i.exec(body)?.[1];
      if (!st) throw new BadRequest(`${id}: REOPEN needs status=`);
      j.reopen = st;
      body = body.replace(/\bREOPEN\b/, '').replace(/\bstatus=\w+/i, '');
    }
    const u = /\bU=([A-Za-z])/.exec(body)?.[1];
    if (u) j.u = u;
    const i = /\bI=([A-Za-z])/.exec(body)?.[1];
    if (i) j.i = i;
    const st = /\bstatus=(\w+)/i.exec(body)?.[1];
    if (st) j.status = st;
    const dl = /\bdeadline=(no date|none|(?:DL|SO|SB)?\s*\d{4}-\d{2}-\d{2})/i.exec(body)?.[1];
    if (dl) j.deadline = dl.trim();
    const cat = /\bcategory=([^=]+?)(?=\s+\w+=|$)/i.exec(body)?.[1];
    if (cat) j.category = cat.trim();
    out.judgments.push(j);
  }
  return out;
}
