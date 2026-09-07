/**
 * Integration run against the REAL Registry Service (not the test fixture's fake).
 * Not part of `npm test` — it needs `wrangler dev` of service/ seeded from data/registry.
 *
 *   Terminal 1 (service/):  npx wrangler dev --port 8787            # after the seed steps in service/README.md
 *   Terminal 2 (mcp/):      MCP_TOKEN=abc REGISTRY_URL=http://127.0.0.1:8787 npm run dev
 *   Terminal 3 (mcp/):      MCP_TOKEN=abc npx tsx scripts/integration-smoke.ts
 *
 * Exercises: registry_queue → triage_stage → propose_scores (asserts nothing was written) →
 * triage_record without attestation (must be refused) → note_append (allowed) → the service's
 * pending delta parses with core's parseDelta and names the right base.
 *
 * It writes ONE note line to the row it touches ("integration test … — remove me"); re-seed the
 * local D1 afterwards (service/README.md) so no test residue survives.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { parseDelta } from '@ftb/core';

const MCP = process.env.MCP_URL ?? 'http://127.0.0.1:8788';
const REGISTRY = process.env.REGISTRY_URL ?? 'http://127.0.0.1:8787';
const TOKEN = process.env.MCP_TOKEN ?? 'abc';
const NOTE_TEXT = process.env.NOTE_TEXT ?? `integration test ${new Date().toISOString().slice(0, 10)} — remove me`;

type ToolResult = { content: { type: string; text?: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };

const failures: string[] = [];
function assert(cond: unknown, msg: string): void {
  if (cond) console.log(`  ok   ${msg}`);
  else {
    console.log(`  FAIL ${msg}`);
    failures.push(msg);
  }
}
const hr = (t: string) => console.log(`\n=== ${t} ===`);

const pending = async () => (await fetch(`${REGISTRY}/api/v1/archive/pending`)).json() as Promise<{ content: string; changes: number; filename: string; delta_count: number }>;

const c = new Client({ name: 'integration-smoke', version: '0' });
await c.connect(new StreamableHTTPClientTransport(new URL(`${MCP}/mcp`), { requestInit: { headers: { authorization: `Bearer ${TOKEN}` } } }));
const call = async (name: string, args: Record<string, unknown> = {}) => (await c.callTool({ name, arguments: args })) as ToolResult;
const textOf = (r: ToolResult) => r.content.map((x) => x.text ?? '').join('\n');

// ---------------------------------------------------------------- queue
hr('registry_queue chunk=5 page=0');
const q = await call('registry_queue', { chunk: 5, page: 0 });
assert(!q.isError, 'registry_queue answered');
const queue = q.structuredContent as { entries: { top: { id: string; task: string; category: string; u: string | null; i: string | null; status: string; deadline: string | null; triaged: string | null }; tier: number; rows: unknown[] }[]; total: number; monday: string };
console.log(`  total ${queue.total} entries · monday ${queue.monday}`);
for (const e of queue.entries) {
  const t = e.top;
  console.log(`  [tier ${e.tier}] ${t.id} (${t.task}) · ${t.category} · U=${t.u ?? '-'} I=${t.i ?? '-'} · ${t.status} · dl ${t.deadline ?? '-'} · triaged ${t.triaged ?? 'never'} · ${e.rows.length} row(s)`);
}
assert(queue.entries.length === 5, 'five entries on page 0');
const ids = queue.entries.map((e) => e.top.id);

// ---------------------------------------------------------------- stage
hr('triage_stage chunk=5 page=0');
const st = await call('triage_stage', { chunk: 5, page: 0 });
assert(!st.isError, 'triage_stage answered');
const stagingText = textOf(st);
console.log(stagingText.split('\n').map((l) => `  | ${l}`).join('\n'));
for (const id of ids) assert(stagingText.includes(`${id} (`), `staging text names ${id} with its name`);

// ---------------------------------------------------------------- propose_scores: no write
hr('propose_scores — must write nothing');
const before = await pending();
const stampBeforeWrites = ((await (await fetch(`${REGISTRY}/api/v1/registry`)).json()) as { stamp: string }).stamp;
if (before.changes > 0) console.log(`  (note: ${before.changes} change line(s) already pending from an earlier run — re-seed for a clean run)`);
const ps = await call('propose_scores', { ids });
assert(!ps.isError, 'propose_scores answered');
const proposals = ps.structuredContent as { proposals: { id: string; task: string; u: string; i: string; reasoning: string }[]; written: boolean };
for (const p of proposals.proposals) console.log(`  ${p.id} (${p.task}) → U=${p.u} I=${p.i} — ${p.reasoning}`);
assert(proposals.written === false, 'written: false');
const after = await pending();
assert(after.content === before.content && after.changes === before.changes, '/archive/pending unchanged after propose_scores');

// ---------------------------------------------------------------- triage_record without attestation
hr('triage_record human_judgment=false touching u — must be refused');
const refused = await call('triage_record', { actor: 'claude', human_judgment: false, judgments: [{ id: ids[0], u: 'H' }] });
assert(refused.isError === true, 'isError: true');
console.log(`  ${textOf(refused).split('\n')[0]}`);
const after2 = await pending();
assert(after2.content === before.content, '/archive/pending still unchanged (service never called)');

// ---------------------------------------------------------------- note_append
hr(`note_append on ${ids[0]}`);
const na = await call('note_append', { id: ids[0], actor: 'claude', text: NOTE_TEXT });
assert(!na.isError, 'note_append succeeded');
console.log(`  ${textOf(na).split('\n')[0]}`);
const row = na.structuredContent as { id: string; task: string; notes: string; triaged: string | null };
assert(row.notes?.includes(NOTE_TEXT), 'row notes carry the appended text');
assert(row.triaged === queue.entries[0]!.top.triaged, 'note did not stamp Triaged (a note is not a triage)');

// ---------------------------------------------------------------- pending delta parses
hr('GET /archive/pending → parseDelta');
const pend = await pending();
console.log(pend.content.split('\n').map((l) => `  | ${l}`).join('\n'));
const reg = (await (await fetch(`${REGISTRY}/api/v1/registry`)).json()) as { stamp: string };
assert(reg.stamp >= stampBeforeWrites, `registry stamp advanced with the write (${stampBeforeWrites} → ${reg.stamp})`);
const delta = parseDelta(pend.content, { filename: pend.filename });
assert(delta.stamp === reg.stamp, `pending delta stamp is the registry's current stamp (${delta.stamp})`);
assert(delta.changes.length === before.changes + 1, `delta has ${before.changes + 1} change line(s) (got ${delta.changes.length})`);
const mine = delta.changes.filter((ch) => ch.id === ids[0] && ch.noteAppends.some((n) => n.includes(NOTE_TEXT)));
assert(mine.length === 1, `exactly one change targets ${ids[0]} with the note+= append`);
assert(delta.warnings.length === 0, `no parser warnings (${delta.warnings.join('; ')})`);
console.log(`  base=${delta.base} baseStamp=${delta.baseStamp} priorDeltas=${delta.priorDeltas.length} registry stamp=${reg.stamp}`);
assert(delta.baseStamp === '2026-08-31-1137' || process.env.EXPECT_BASE === delta.baseStamp, `Base names the seeded snapshot (${delta.baseStamp})`);
assert(delta.priorDeltas.length === pend.delta_count, `Prior deltas line lists delta_count = ${pend.delta_count} stamps`);
assert(delta.priorDeltas.every((d) => d > delta.baseStamp!) && delta.stamp > delta.priorDeltas[delta.priorDeltas.length - 1]!, 'chain is ordered: base < prior deltas < this delta');

await c.close();
hr(failures.length ? `FAILED: ${failures.length}` : 'ALL PASSED');
for (const f of failures) console.log(`  - ${f}`);
process.exit(failures.length ? 1 : 0);
