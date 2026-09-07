// Queue and radar: synthetic rows for each tier rule, then the applied real registry, printing
// the first ten entries so a human can eyeball the order.
import { describe, expect, it } from 'vitest';
import type { Task } from '../src/index.ts';
import { buildQueue, buildRadar, chunkQueue, nextFreeId, reservedIds, resolveRegistry, TIER_NAMES } from '../src/index.ts';
import { hasRegistry, loadRegistryFiles } from './fixtures.ts';

const TODAY = '2026-09-07'; // Monday, so nothing triaged earlier is excluded by the cycle rule

function t(partial: Partial<Task> & { id: string }): Task {
  return {
    task: partial.id,
    category: 'Art College',
    u: null,
    i: null,
    status: 'Planned',
    recorded: '2026-08-01',
    triaged: null,
    deadline: null,
    deadline_type: null,
    deadline_kind: null,
    done: null,
    notes: '',
    blocker: null,
    updated_at: '2026-09-07T00:00:00+03:00',
    ...partial,
  };
}

describe('buildQueue', () => {
  it('orders the five tiers and their secondary keys', () => {
    const rows: Task[] = [
      t({ id: 'T-001', triaged: '2026-08-20', u: 'M', i: 'M' }), // tier 5
      t({ id: 'T-002', triaged: '2026-08-10', u: 'M', i: 'M' }), // tier 5, staler → first of the tier
      t({ id: 'T-003', u: 'H', i: 'L', recorded: '2026-07-20' }), // tier 4
      t({ id: 'T-004', recorded: '2026-07-01' }), // tier 3, oldest
      t({ id: 'T-005', recorded: '2026-07-15' }), // tier 3
      t({ id: 'T-006', deadline: '2026-09-15', deadline_type: 'DL', u: 'L', i: 'L', triaged: '2026-08-01' }), // tier 2, 8 days
      t({ id: 'T-007', deadline: '2026-09-09', deadline_type: 'SB', status: 'Inbox' }), // tier 2, 2 days
      t({ id: 'T-008', deadline: '2026-09-01', deadline_type: 'DL' }), // tier 1, -6
      t({ id: 'T-009', deadline: '2026-08-20', deadline_type: 'SB', status: 'Planned' }), // tier 1, -18 → first
      t({ id: 'T-010', deadline: '2026-09-21', deadline_type: 'SO', u: 'M', i: 'M', triaged: '2026-08-15' }), // dormant → tier 5
      t({ id: 'T-011', deadline: '2026-09-01', deadline_type: 'SO', u: 'M', i: 'M', triaged: '2026-08-15' }), // eligible → tier 2, -6
      t({ id: 'T-012', deadline: '2026-09-01', deadline_type: 'SB', status: 'Active', u: 'M', i: 'M', triaged: '2026-08-16' }), // started → tier 5
      t({ id: 'T-013', status: 'Done', done: '2026-09-01' }), // closed, out
      t({ id: 'T-014', triaged: '2026-09-07', u: 'H', i: 'H' }), // judged this cycle, out
    ];
    const q = buildQueue(rows, TODAY);
    expect(q.map((e) => `${e.top.id}:${e.tier}`)).toEqual([
      'T-009:1',
      'T-008:1',
      'T-011:2',
      'T-007:2',
      'T-006:2',
      'T-004:3',
      'T-005:3',
      'T-003:4',
      'T-002:5',
      'T-010:5',
      'T-012:5',
      'T-001:5',
    ]);
  });

  it('treats a branch as one entry and lets a subtask pull it up; orphans are top-level', () => {
    const rows: Task[] = [
      t({ id: 'T-020', u: 'M', i: 'M', triaged: '2026-08-01' }),
      t({ id: 'T-020.1', deadline: '2026-09-02', deadline_type: 'DL' }), // overdue → branch tier 1
      t({ id: 'T-020.1.1' }),
      t({ id: 'T-021', status: 'Done', done: '2026-09-01' }),
      t({ id: 'T-021.1', recorded: '2026-06-01' }), // orphan: parent closed → its own entry
      t({ id: 'T-022', triaged: '2026-09-07', u: 'H', i: 'H' }), // judged this week → out
      t({ id: 'T-022.1', recorded: '2026-08-05' }), // not judged → re-enters alone
    ];
    const q = buildQueue(rows, TODAY);
    expect(q.map((e) => e.top.id)).toEqual(['T-020', 'T-021.1', 'T-022.1']);
    expect(q[0]!.tier).toBe(1);
    expect(q[0]!.rows.map((r) => r.id)).toEqual(['T-020', 'T-020.1', 'T-020.1.1']);
    expect(chunkQueue(q, 2, 1).map((e) => e.top.id)).toEqual(['T-022.1']);
  });
});

describe('buildRadar', () => {
  it('sorts rows into the contract sections by DL/SO/SB state', () => {
    const rows: Task[] = [
      t({ id: 'T-030', deadline: '2026-09-01', deadline_type: 'DL' }),
      t({ id: 'T-031', deadline: '2026-09-08', deadline_type: 'DL' }),
      t({ id: 'T-032', deadline: '2026-09-15', deadline_type: 'SB', status: 'Inbox' }),
      t({ id: 'T-033', deadline: '2026-09-01', deadline_type: 'SO' }),
      t({ id: 'T-034', deadline: '2026-09-01', deadline_type: 'SB', status: 'Active' }),
      t({ id: 'T-035', deadline: '2026-10-30', deadline_type: 'DL' }),
      t({ id: 'T-036', deadline: '2026-09-14', deadline_type: 'SO' }),
      t({ id: 'T-037' }),
      t({ id: 'T-038', deadline: '2026-09-01', deadline_type: 'DL', status: 'Done' }),
    ];
    const r = buildRadar(rows, TODAY);
    expect(r.overdue.map((x) => x.id)).toEqual(['T-030']);
    expect(r.today_tomorrow.map((x) => x.id)).toEqual(['T-031']);
    expect(r.fortnight.map((x) => x.id)).toEqual(['T-032']);
    expect(r.passed_not_overdue.map((x) => x.id)).toEqual(['T-033', 'T-034']);
    expect(r.further.map((x) => x.id)).toEqual(['T-035']);
    expect(r.dormant.map((x) => x.id)).toEqual(['T-036']);
    expect(r.undated.map((x) => x.id)).toEqual(['T-037']);
  });
});

describe('ids', () => {
  it('next free ID is one past the highest ever used; reserved block follows', () => {
    const rows = [t({ id: 'T-001' }), t({ id: 'T-102' }), t({ id: 'T-096', status: 'Dropped' }), t({ id: 'T-102.3' })];
    expect(nextFreeId(rows)).toBe('T-103');
    expect(reservedIds(rows)).toEqual(['T-103', 'T-104', 'T-105']);
  });
});

describe.skipIf(!hasRegistry)('queue on the applied real registry', () => {
  it('derives a queue and prints the first ten entries', () => {
    const reg = resolveRegistry(loadRegistryFiles());
    const q = buildQueue(reg.rows, TODAY);
    expect(q.length).toBeGreaterThan(10);
    for (let k = 1; k < q.length; k++) expect(q[k]!.tier).toBeGreaterThanOrEqual(q[k - 1]!.tier);
    const lines = q.slice(0, 10).map((e, k) => {
      const key = typeof e.key[1] === 'number' ? `${e.key[1]}d` : e.key[1];
      return `${String(k + 1).padStart(2)}. ${TIER_NAMES[e.tier].slice(0, 1)} ${e.top.id} (${e.top.task}) — ${e.top.status}${e.top.deadline ? ` · ${e.top.deadline_type} ${e.top.deadline}` : ''} · key ${key}${e.rows.length > 1 ? ` · branch of ${e.rows.length}` : ''}`;
    });
    // eslint-disable-next-line no-console
    console.log(`Queue for ${TODAY} — ${q.length} entries\n${lines.join('\n')}`);
    // The known overdue rows at the head of the archive's own 2026-08-31 queue are still there.
    expect(q[0]!.tier).toBe(1);
    expect(q.some((e) => e.top.id === 'T-005')).toBe(true);
  });
});
