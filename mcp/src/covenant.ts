/**
 * The automation covenant, enforced locally before any request leaves this process.
 *
 * Triage is a human act; automation stages it. A judgment that changes U, I, Status,
 * Deadline or Category (or reopens a row, which is a status change) is a triage
 * judgment and may only be recorded when the human actually made it in the
 * conversation — attested with human_judgment: true. Note-only judgments are
 * observations and pass without the attestation.
 *
 * The Registry Service enforces the same rule (HTTP 403 { error: "covenant" }).
 * This copy exists so a refused call never reaches the network at all.
 */
import type { Judgment } from './types.js';

export const GUARDED_FIELDS = ['u', 'i', 'status', 'deadline', 'category', 'reopen'] as const;

export interface CovenantRefusal {
  ok: false;
  message: string;
  offending: { id: string; fields: string[] }[];
}

export type CovenantVerdict = { ok: true } | CovenantRefusal;

export function guardedFieldsOf(j: Judgment): string[] {
  return GUARDED_FIELDS.filter((f) => j[f] !== undefined && j[f] !== null);
}

export function checkJudgmentBatch(humanJudgment: unknown, judgments: Judgment[]): CovenantVerdict {
  if (humanJudgment === true) return { ok: true };
  const offending = judgments
    .map((j) => ({ id: j.id, fields: guardedFieldsOf(j) }))
    .filter((o) => o.fields.length > 0);
  if (offending.length === 0) return { ok: true };
  const list = offending.map((o) => `${o.id} (${o.fields.join(', ')})`).join('; ');
  return {
    ok: false,
    offending,
    message:
      `Refused by the automation covenant before reaching the Registry Service: ${offending.length} judgment(s) ` +
      `touch triage fields — ${list} — but human_judgment is not true. Triage is a human act: U, I, status, deadline ` +
      `and category are his judgments. Ask him, record what he says, and call again with human_judgment: true only if ` +
      `he actually made the judgment in this conversation. Note-only judgments need no attestation. Nothing was written.`,
  };
}

export function refuseStatusChange(action: 'close' | 'reopen', id: string): string {
  return (
    `Refused by the automation covenant before reaching the Registry Service: ${action === 'close' ? 'closing' : 'reopening'} ` +
    `${id} changes its status, which is a triage judgment, but human_judgment is not true. Only call this with ` +
    `human_judgment: true when he said in this conversation that the task is ${action === 'close' ? 'done' : 'to be reopened'}. Nothing was written.`
  );
}
