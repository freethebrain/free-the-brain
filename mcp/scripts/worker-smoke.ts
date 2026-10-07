/**
 * Manual smoke test for the Cloudflare Worker entry (not part of `npm test`,
 * because it needs wrangler's local workerd).
 *
 *   mcp/.dev.vars (gitignored; delete it afterwards):
 *     MCP_TOKEN=<any throwaway string>
 *     REGISTRY_URL=http://127.0.0.1:8787
 *   Terminal 1:  npx wrangler dev --local --port 8790
 *   Terminal 2:  MCP_TOKEN=<the same string> npx tsx scripts/worker-smoke.ts
 *
 * First the OAuth front door, the way Claude walks it: discovery, an
 * unauthenticated /mcp (401 + resource_metadata), Dynamic Client Registration,
 * the sign-in page (wrong password, then the right one), the PKCE S256 code
 * exchange, and initialize on /mcp with the issued token, a bad token and the
 * bare MCP_TOKEN. Then the old round trip with the issued token, against the
 * test fixture's fake Registry Service on 127.0.0.1:8787 (hence REGISTRY_URL
 * above: nothing here reaches the real service). Exits 1 if any check fails.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

import { startFakeService } from '../test/fake-service.js';

const WORKER = process.env.WORKER_URL ?? 'http://127.0.0.1:8790';
const PASSWORD = process.env.MCP_TOKEN;
if (!PASSWORD) {
  console.error('Set MCP_TOKEN to the value in mcp/.dev.vars.');
  process.exit(2);
}

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

const b64url = (b: Buffer) => b.toString('base64url');
const unescapeHtml = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const INITIALIZE = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'worker-smoke', version: '0' } },
});
const mcpPost = (bearer?: string) =>
  fetch(`${WORKER}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: INITIALIZE,
  });

// ---- OAuth front door ------------------------------------------------------
const meta = await fetch(`${WORKER}/.well-known/oauth-authorization-server`);
const metaJson = (await meta.json()) as Record<string, unknown>;
check(
  'GET /.well-known/oauth-authorization-server',
  meta.status === 200 && metaJson.authorization_endpoint === `${WORKER}/authorize` && metaJson.token_endpoint === `${WORKER}/oauth/token` && metaJson.registration_endpoint === `${WORKER}/oauth/register`,
  `${meta.status}; scopes_supported ${JSON.stringify(metaJson.scopes_supported)}; code_challenge_methods ${JSON.stringify(metaJson.code_challenge_methods_supported)}`
);

const anon = await mcpPost();
const challenge = anon.headers.get('www-authenticate') ?? '';
check('POST /mcp without a token → 401 + resource_metadata', anon.status === 401 && /resource_metadata="[^"]+"/.test(challenge), `${anon.status}; ${challenge}`);

const redirectUri = 'http://127.0.0.1:9/callback';
const reg = await fetch(`${WORKER}/oauth/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    client_name: 'worker-smoke',
    redirect_uris: [redirectUri],
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  }),
});
const regJson = (await reg.json()) as { client_id?: string };
check('POST /oauth/register → 201', reg.status === 201 && !!regJson.client_id, `${reg.status}`);
const clientId = regJson.client_id ?? '';

const verifier = b64url(randomBytes(32));
const state = b64url(randomBytes(12));
const authorizeQuery = new URLSearchParams({
  response_type: 'code',
  client_id: clientId,
  redirect_uri: redirectUri,
  state,
  code_challenge: b64url(createHash('sha256').update(verifier).digest()),
  code_challenge_method: 'S256',
  scope: 'registry:read registry:write',
  resource: `${WORKER}/mcp`,
});
const page = await fetch(`${WORKER}/authorize?${authorizeQuery}`);
const html = await page.text();
const hidden = html.match(/name="oauth_query" value="([^"]*)"/);
check('GET /authorize → password page', page.status === 200 && html.includes('<title>Free the Brain</title>') && !!hidden, `${page.status}`);
const oauthQuery = unescapeHtml(hidden?.[1] ?? '');

const signIn = (password: string) =>
  fetch(`${WORKER}/authorize`, { method: 'POST', redirect: 'manual', body: new URLSearchParams({ oauth_query: oauthQuery, password }) });

const wrong = await signIn(`${PASSWORD}-wrong`);
check('POST /authorize, wrong password → 401 + the form', wrong.status === 401 && (await wrong.text()).includes('Wrong password.'), `${wrong.status}`);

const right = await signIn(PASSWORD);
const location = new URL(right.headers.get('location') ?? 'about:blank');
const code = location.searchParams.get('code');
check(
  'POST /authorize, right password → 302 to the redirect URI with a code',
  right.status === 302 && `${location.origin}${location.pathname}` === redirectUri && !!code && location.searchParams.get('state') === state,
  `${right.status} → ${location.origin}${location.pathname}?code=…&state=${location.searchParams.get('state') === state ? '(matches)' : '(MISMATCH)'}`
);

const tok = await fetch(`${WORKER}/oauth/token`, {
  method: 'POST',
  body: new URLSearchParams({ grant_type: 'authorization_code', code: code ?? '', redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier, resource: `${WORKER}/mcp` }),
});
const tokJson = (await tok.json()) as { access_token?: string; token_type?: string; scope?: string; refresh_token?: string };
check(
  'POST /oauth/token (PKCE S256) → access_token',
  tok.status === 200 && !!tokJson.access_token,
  `${tok.status}; token_type ${tokJson.token_type}; scope "${tokJson.scope}"; refresh_token ${tokJson.refresh_token ? 'yes' : 'no'}`
);
const accessToken = tokJson.access_token ?? '';

const good = await mcpPost(accessToken);
const goodJson = (await good.json().catch(() => ({}))) as { result?: { serverInfo?: { name?: string } } };
check('MCP initialize with the access token → 200', good.status === 200 && goodJson.result?.serverInfo?.name === 'free-the-brain', `${good.status}; serverInfo.name ${goodJson.result?.serverInfo?.name}`);

const bad = await mcpPost(`${accessToken.slice(0, -4)}xxxx`);
check('MCP initialize with a bad token → 401', bad.status === 401, `${bad.status}`);

const bare = await mcpPost(PASSWORD);
check('MCP initialize with the bare MCP_TOKEN as bearer → 401', bare.status === 401, `${bare.status}`);

// ---- Round trip with the issued token ---------------------------------------
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
await c.connect(new StreamableHTTPClientTransport(new URL(`${WORKER}/mcp`), { requestInit: { headers: { authorization: `Bearer ${accessToken}` } } }));
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

console.log(failures ? `${failures} check(s) failed` : 'all OAuth checks passed');
process.exit(failures ? 1 : 0);
