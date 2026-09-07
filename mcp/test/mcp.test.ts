import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createNodeServer, listen, loadExtAppsBundle } from '../src/node.js';
import { TRIAGE_VIEW_URI } from '../src/ui.js';
import { parentOf } from '@ftb/core';
import { deriveQueue, FIXTURE_TODAY, startFakeService, type FakeService } from './fake-service.js';

const TOKEN = 'test-token-do-not-use';

let fake: FakeService;
let mcpHttp: Server;
let mcpUrl: string;
let client: Client;

type ToolResult = { content: { type: string; text?: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };

async function call(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  return (await client.callTool({ name, arguments: args })) as ToolResult;
}
const textOf = (r: ToolResult) => r.content.map((c) => c.text ?? '').join('\n');

async function connect(token: string | undefined): Promise<Client> {
  const c = new Client({ name: 'test-host', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${mcpUrl}/mcp`), {
    requestInit: token ? { headers: { authorization: `Bearer ${token}` } } : undefined,
  });
  await c.connect(transport);
  return c;
}

beforeAll(async () => {
  fake = await startFakeService();
  mcpHttp = createNodeServer({
    registryUrl: fake.url,
    mcpToken: TOKEN,
    today: FIXTURE_TODAY,
    extAppsBundleJs: loadExtAppsBundle(),
  });
  mcpUrl = await listen(mcpHttp, 0);
  client = await connect(TOKEN);
});

afterAll(async () => {
  await client.close().catch(() => undefined);
  await new Promise<void>((r) => mcpHttp.close(() => r()));
  await fake.close();
});

beforeEach(() => {
  fake.requests.length = 0;
});

describe('transport and auth', () => {
  it('refuses without a bearer token and with a wrong one', async () => {
    await expect(connect(undefined)).rejects.toThrow();
    await expect(connect('wrong')).rejects.toThrow();
    expect(fake.requests).toHaveLength(0);
  });

  it('answers /health without auth', async () => {
    const res = await fetch(`${mcpUrl}/health`);
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});

describe('tool list', () => {
  it('lists every tool with the covenant in its description', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      ['capture_add', 'full_pass_status', 'note_append', 'propose_scores', 'registry_queue', 'registry_radar', 'registry_read', 'task_close', 'task_reopen', 'triage_record', 'triage_stage'].sort()
    );
    for (const t of tools) {
      expect(t.description).toMatch(/triage is a human act/i);
      expect(t.inputSchema).toBeTruthy();
    }
    const record = tools.find((t) => t.name === 'triage_record')!;
    expect(record.description).toMatch(/human_judgment may ONLY be set true when the human actually made the judgment/);
    const stage = tools.find((t) => t.name === 'triage_stage')!;
    expect((stage._meta as { ui?: { resourceUri?: string } } | undefined)?.ui?.resourceUri).toBe(TRIAGE_VIEW_URI);
  });

  it('exposes the MCP App view resource', async () => {
    const { resources } = await client.listResources();
    const view = resources.find((r) => r.uri === TRIAGE_VIEW_URI);
    expect(view).toBeTruthy();
    expect(view!.mimeType).toBe('text/html;profile=mcp-app');
    const read = await client.readResource({ uri: TRIAGE_VIEW_URI });
    const html = (read.contents[0] as { text: string }).text;
    expect(html).toContain('<script type="module">');
    expect(html).toContain('new App(');
    expect(html).toContain('ui/notifications'); // the inlined ext-apps bundle
  });
});

describe('reads', () => {
  it('registry_read returns rows and counts, open_only filters', async () => {
    const all = await call('registry_read');
    expect(all.isError).toBeFalsy();
    const env = all.structuredContent as { rows: unknown[]; counts: { open: number; done: number; dropped: number; total: number } };
    expect(env.counts).toEqual({ open: 6, done: 1, dropped: 1, total: 8 });
    expect(env.rows).toHaveLength(8);

    const open = await call('registry_read', { open_only: true });
    expect((open.structuredContent as { rows: unknown[] }).rows).toHaveLength(6);
    expect(fake.requests.map((r) => r.path)).toEqual(['/registry', '/registry/open']);
  });

  it('registry_queue returns tiers and the legend', async () => {
    const r = await call('registry_queue', { chunk: 5 });
    const q = r.structuredContent as { entries: { top: { id: string }; tier: number }[]; total: number; legend: string; monday: string };
    expect(q.monday).toBe('2026-09-07'); // today is a Monday
    expect(q.legend).toMatch(/① Overdue/);
    // T-041 overdue (tier 1) first; T-052 start-by within 14d (tier 2); T-060 never judged (3); T-061 dormant SO, scored, triaged (5). T-080 judged this cycle: out.
    expect(q.entries.map((e) => [e.top.id, e.tier])).toEqual([
      ['T-041', 1],
      ['T-052', 2],
      ['T-060', 3],
      ['T-061', 5],
    ]);
  });

  it('registry_radar returns the sections', async () => {
    const r = await call('registry_radar', { days: 14 });
    const radar = r.structuredContent as Record<string, { id: string }[]>;
    expect(radar.overdue.map((t) => t.id)).toEqual(['T-041']);
    expect(radar.fortnight.map((t) => t.id).sort()).toEqual(['T-052', 'T-080']);
    expect(radar.dormant.map((t) => t.id)).toEqual(['T-061']);
    expect(fake.requests[0].path).toBe('/radar');
  });
});

describe('triage_stage', () => {
  it('returns the chunk and staging text in the widget style', async () => {
    const r = await call('triage_stage', { chunk: 5 });
    expect(r.isError).toBeFalsy();
    const text = textOf(r);
    expect(text).toMatch(/^TRIAGE STAGE — chunk 1 of 1 \(5 per chunk\) — today 2026-09-07 · cycle Monday 2026-09-07/);
    expect(text).toContain('Sort order: ① Overdue · ② Dated within 14 days · ③ Never judged');
    expect(text).toContain('① Overdue\nT-041 (Chase Ian for the pay figure) · Freelance Videoediting · H/M · Planned · 12d overdue · hard (DL 2026-08-26) · judged 34d ago · Ian said Friday.');
    expect(text).toContain('\n  T-041.1 (Draft the follow-up message) · Freelance Videoediting · –/– · Inbox · no date · never judged');
    expect(text).toContain('② Dated within 14 days\nT-052 (Book dentist) · Personal / Admin · L/M · Inbox · start by in 8d (SB 2026-09-15) · never judged');
    expect(text).toContain('⑤ Stalest triage\nT-061 (Booking system quotes) · Art College · M/H · Blocked on Sasho · starts in 24d (dormant) (SO 2026-10-01) · judged 27d ago · Waiting on Sasho for the second quote.');
    expect(text).not.toContain('T-080');
    const sc = r.structuredContent as { queue: { total: number }; staging_text: string; today: string };
    expect(sc.queue.total).toBe(4);
    expect(sc.staging_text).toBe(text);
    expect(fake.writes()).toHaveLength(0);
  });
});

describe('capture_add', () => {
  it('creates Inbox rows with the next free IDs and Triaged empty', async () => {
    const r = await call('capture_add', { actor: 'claude', items: [{ task: 'Book the dentist follow-up' }, { task: 'Renew the parking permit', category: 'Personal / Admin', notes: 'expires end of month' }] });
    expect(r.isError).toBeFalsy();
    const rows = (r.structuredContent as { rows: { id: string; status: string; triaged: null; recorded: string }[] }).rows;
    expect(rows.map((x) => x.id)).toEqual(['T-081', 'T-082']);
    expect(rows.every((x) => x.status === 'Inbox' && x.triaged === null && x.recorded === FIXTURE_TODAY)).toBe(true);
    expect(textOf(r)).toMatch(/^Captured 2: T-081 \(Book the dentist follow-up\), T-082 \(Renew the parking permit\)/);
    const w = fake.writes();
    expect(w).toHaveLength(1);
    expect(w[0].path).toBe('/capture');
    expect((w[0].body as { source: string; actor: string }).source).toBe('mcp');
    expect((w[0].body as { actor: string }).actor).toBe('claude');
  });
});

describe('triage_record and the covenant', () => {
  it('records his judgments when human_judgment is true', async () => {
    const r = await call('triage_record', {
      actor: 'ftb',
      human_judgment: true,
      judgments: [
        { id: 'T-060', u: 'H', i: 'H', status: 'Planned', deadline: { type: 'SB', date: '2026-09-20' }, note: 'He wants it before the open day.' },
        { id: 'T-052', deadline: 'none' },
      ],
    });
    expect(r.isError).toBeFalsy();
    expect(textOf(r)).toMatch(/^Recorded 2 judgment\(s\) · delta 2026-09-07-1200/);
    const w = fake.writes();
    expect(w).toHaveLength(1);
    expect(w[0].path).toBe('/judgments');
    expect((w[0].body as { human_judgment: boolean; source: string }).human_judgment).toBe(true);
    expect((w[0].body as { source: string }).source).toBe('mcp');
    const t60 = fake.rows.find((x) => x.id === 'T-060')!;
    expect(t60).toMatchObject({ u: 'H', i: 'H', status: 'Planned', deadline: '2026-09-20', deadline_type: 'SB', triaged: FIXTURE_TODAY });
    expect(t60.notes).toContain('He wants it before the open day.');
    expect(fake.rows.find((x) => x.id === 'T-052')!.deadline).toBeNull();
  });

  it('refuses locally when human_judgment is false and a triage field is touched — the service receives NO request', async () => {
    const r = await call('triage_record', {
      actor: 'claude',
      human_judgment: false,
      judgments: [{ id: 'T-061', u: 'H', note: 'looks urgent' }, { id: 'T-041', status: 'Done' }],
    });
    expect(r.isError).toBe(true);
    const msg = textOf(r);
    expect(msg).toMatch(/Refused by the automation covenant before reaching the Registry Service/);
    expect(msg).toContain('T-061 (u)');
    expect(msg).toContain('T-041 (status)');
    expect(msg).toMatch(/Nothing was written/);
    expect(fake.requests).toHaveLength(0);
    expect(fake.rows.find((x) => x.id === 'T-061')!.u).toBe('M');
    expect(fake.rows.find((x) => x.id === 'T-041')!.status).toBe('Planned');
  });

  it('lets a note-only batch through without attestation', async () => {
    const r = await call('triage_record', { actor: 'claude', human_judgment: false, judgments: [{ id: 'T-041', note: 'Value: €1,000 agreed for the week, against a researched band of €1,278–4,090.' }] });
    expect(r.isError).toBeFalsy();
    expect(fake.writes().map((w) => w.path)).toEqual(['/judgments']);
    expect(fake.rows.find((x) => x.id === 'T-041')!.notes).toContain('€1,000 agreed');
  });

  it('surfaces the service covenant 403 if the local check were bypassed', async () => {
    // Drive the fake straight from the client-side wrapper to prove the second line of defence is live.
    const res = await fetch(`${fake.url}/api/v1/judgments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ actor: 'claude', source: 'mcp', human_judgment: false, judgments: [{ id: 'T-061', i: 'L' }] }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('covenant');
  });
});

describe('close, reopen, note', () => {
  it('task_close is refused without attestation and closes with it', async () => {
    const refused = await call('task_close', { id: 'T-052', actor: 'claude', human_judgment: false });
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toMatch(/Refused by the automation covenant/);
    expect(fake.requests).toHaveLength(0);

    const ok = await call('task_close', { id: 'T-052', actor: 'ftb', human_judgment: true, note: 'Booked for the 12th.' });
    expect(ok.isError).toBeFalsy();
    expect(textOf(ok)).toMatch(/^T-052 \(Book dentist\) → Done 2026-09-07/);
    expect(fake.writes().map((w) => w.path)).toEqual(['/tasks/T-052/close']);
    expect((fake.writes()[0].body as { human_judgment: boolean; source: string }).human_judgment).toBe(true);
  });

  it('task_reopen is refused without attestation and reopens with it', async () => {
    const refused = await call('task_reopen', { id: 'T-070', actor: 'claude', human_judgment: false, status: 'Planned' });
    expect(refused.isError).toBe(true);
    expect(fake.requests).toHaveLength(0);

    const ok = await call('task_reopen', { id: 'T-070', actor: 'ftb', human_judgment: true, status: 'Blocked', note: 'Garage called back — one pad was wrong.' });
    expect(ok.isError).toBeFalsy();
    expect(textOf(ok)).toMatch(/^T-070 \(Volvo brakes\) reopened as Blocked/);
    expect(fake.rows.find((x) => x.id === 'T-070')!.status).toBe('Blocked');
  });

  it('note_append appends without attestation', async () => {
    const r = await call('note_append', { id: 'T-061', actor: 'claude', text: 'Second quote arrived: €2,400.' });
    expect(r.isError).toBeFalsy();
    expect(fake.writes().map((w) => w.path)).toEqual(['/tasks/T-061/note']);
    expect(fake.rows.find((x) => x.id === 'T-061')!.notes).toContain('Second quote arrived: €2,400.');
  });
});

describe('propose_scores', () => {
  it('returns labelled proposals and writes nothing', async () => {
    const r = await call('propose_scores', { ids: ['T-041', 'T-061', 'T-060', 'T-999'] });
    expect(r.isError).toBeFalsy();
    const sc = r.structuredContent as { proposals: { id: string; u: string; i: string; reasoning: string }[]; unknown_ids: string[]; written: boolean; disclaimer: string };
    expect(sc.written).toBe(false);
    expect(sc.disclaimer).toMatch(/PROPOSAL ONLY — nothing was written/);
    expect(sc.unknown_ids).toEqual(['T-999']);
    const byId = Object.fromEntries(sc.proposals.map((p) => [p.id, p]));
    expect(byId['T-041']).toMatchObject({ u: 'H', i: 'M' }); // overdue; Freelance = income floor
    expect(byId['T-041'].reasoning).toMatch(/12d overdue → U=H/);
    expect(byId['T-061']).toMatchObject({ u: 'L', i: 'H' }); // dormant SO; Art College = top tier
    expect(byId['T-060']).toMatchObject({ i: 'H' });
    expect(fake.writes()).toHaveLength(0);
    expect(fake.requests.map((x) => x.method)).toEqual(['GET']);
  });
});

describe('full_pass_status', () => {
  it('counts branches judged this cycle against the total', async () => {
    const r = await call('full_pass_status');
    expect(r.isError).toBeFalsy();
    const sc = r.structuredContent as { monday: string; branches_total: number; branches_judged_this_cycle: number; entries_remaining: number };
    expect(sc.monday).toBe('2026-09-07');
    // Expected from the fixture state as it stands after the writes above.
    const open = fake.rows.filter((x) => ['Inbox', 'Planned', 'Active', 'Blocked'].includes(x.status));
    const ids = new Set(open.map((x) => x.id));
    const top = (id: string) => { let t = id; let p: string | null; while ((p = parentOf(t)) && ids.has(p)) t = p; return t; };
    const tops = new Set(open.map((x) => top(x.id)));
    const judged = new Set(open.filter((x) => x.triaged && x.triaged >= '2026-09-07').map((x) => top(x.id)));
    expect(sc.branches_total).toBe(tops.size);
    expect(sc.branches_judged_this_cycle).toBe(judged.size);
    expect(judged.size).toBeGreaterThan(0); // T-080 in the fixture, plus T-060 judged in this run
    expect(sc.entries_remaining).toBe(deriveQueue(fake.rows, FIXTURE_TODAY).length);
    // A partially judged branch counts on both sides, so remaining + judged >= total.
    expect(sc.entries_remaining + sc.branches_judged_this_cycle).toBeGreaterThanOrEqual(sc.branches_total);
    expect(fake.writes()).toHaveLength(0);
  });
});
