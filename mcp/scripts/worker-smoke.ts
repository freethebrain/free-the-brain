/**
 * Manual smoke test for the Cloudflare Worker entry (not part of `npm test`,
 * because it needs wrangler's local workerd).
 *
 *   Terminal 1:  npx wrangler dev --port 8790 --var MCP_TOKEN:abc
 *   Terminal 2:  npx tsx scripts/worker-smoke.ts
 *
 * Starts the test fixture's fake Registry Service behind 127.0.0.1:8787 (the
 * REGISTRY_URL in wrangler.toml), then drives the Worker with the SDK client.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createServer } from 'node:http';

import { startFakeService } from '../test/fake-service.js';

const WORKER = process.env.WORKER_URL ?? 'http://127.0.0.1:8790';
const TOKEN = process.env.MCP_TOKEN ?? 'abc';

const fake = await startFakeService();
const proxy = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const r = await fetch(`${fake.url}${req.url}`, {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body: chunks.length ? Buffer.concat(chunks) : undefined,
  });
  res.statusCode = r.status;
  res.setHeader('content-type', r.headers.get('content-type') ?? 'application/json');
  res.end(await r.text());
});
await new Promise<void>((r) => proxy.listen(8787, '127.0.0.1', () => r()));

const c = new Client({ name: 'worker-smoke', version: '0' });
await c.connect(new StreamableHTTPClientTransport(new URL(`${WORKER}/mcp`), { requestInit: { headers: { authorization: `Bearer ${TOKEN}` } } }));
const tools = await c.listTools();
console.log('tools:', tools.tools.map((t) => t.name).join(', '));
const stage = (await c.callTool({ name: 'triage_stage', arguments: { chunk: 5 } })) as { content: { text: string }[] };
console.log('stage:', stage.content[0].text.split('\n')[0]);
const refused = (await c.callTool({ name: 'triage_record', arguments: { actor: 'claude', human_judgment: false, judgments: [{ id: 'T-061', u: 'H' }] } })) as { isError?: boolean };
console.log('covenant refusal isError:', refused.isError, '| write requests that reached the service:', fake.writes().length);
const view = await c.readResource({ uri: 'ui://free-the-brain/triage-stage.html' });
console.log('view:', (view.contents[0] as { text: string }).text.length, 'bytes,', view.contents[0].mimeType);
await c.close();
proxy.close();
await fake.close();
