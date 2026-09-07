/**
 * propose_scores — "your read" as a tool. A deterministic placeholder heuristic
 * that returns proposals and writes NOTHING. U and I remain his judgments; the
 * only path to the registry is triage_record with human_judgment: true.
 */
import { dstate } from '@ftb/core';
import type { Level, Task } from './types.js';

/** Earning Hierarchy, top tier first (Portfolio card order in the Master widget). */
export const CATEGORY_TIERS: Record<string, { rank: number; tier: string }> = {
  'Art College': { rank: 1, tier: 'Wealth engine' },
  'Real Estate': { rank: 2, tier: 'Burn deleter' },
  'Freelance Videoediting': { rank: 3, tier: 'Income floor' },
  'Website Projects': { rank: 4, tier: 'Asymmetric bet' },
  'Best Moments': { rank: 5, tier: 'Bridge income' },
  'Research & Side Projects': { rank: 6, tier: 'Capability stack' },
  'Personal / Admin': { rank: 7, tier: 'Life & admin' },
};

export interface ScoreProposal {
  id: string;
  task: string;
  u: Level;
  i: Level;
  reasoning: string;
  current: { u: Level | null; i: Level | null };
}

export const PROPOSAL_DISCLAIMER =
  'PROPOSAL ONLY — nothing was written. This is a placeholder heuristic (dates → U, Earning Hierarchy tier → I), ' +
  'not his judgment. Offer it as a read he can overrule in one word; record only what he decides, via triage_record with human_judgment: true.';

export function proposeScores(row: Task, today: string): ScoreProposal {
  const d = dstate(row, today);
  const hard = row.deadline_kind === 'hard';
  const why: string[] = [];

  let u: Level;
  if (d?.k === 'overdue') {
    u = 'H';
    why.push(`${-d.n}d overdue → U=H`);
  } else if (d && d.k !== 'dormant' && d.n <= 14 && (hard || d.n <= 7)) {
    u = 'H';
    why.push(`${hard ? 'hard ' : ''}date in ${d.n}d → U=H`);
  } else if (d && d.k !== 'dormant' && d.n <= 30) {
    u = 'M';
    why.push(`dated in ${d.n}d → U=M`);
  } else if (row.status === 'Blocked') {
    u = 'L';
    why.push('blocked, undated → U=L');
  } else {
    u = 'L';
    why.push(d?.k === 'dormant' ? 'dormant start-on → U=L' : 'no pressing date → U=L');
  }

  const cat = CATEGORY_TIERS[row.category];
  let i: Level;
  if (cat && cat.rank <= 2) {
    i = 'H';
    why.push(`${row.category} is a top-two tier (${cat.tier}) → I=H`);
  } else if (cat && cat.rank <= 4) {
    i = 'M';
    why.push(`${row.category} (${cat.tier}) → I=M`);
  } else {
    i = 'L';
    why.push(`${row.category}${cat ? ` (${cat.tier})` : ' (unknown category)'} → I=L`);
  }
  if (i === 'L' && hard) {
    i = 'M';
    why.push('hard external deadline lifts I to M');
  }

  return { id: row.id, task: row.task, u, i, reasoning: why.join('; '), current: { u: row.u, i: row.i } };
}
