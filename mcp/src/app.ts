/**
 * The Web-standard request handler shared by both entries (Node and Cloudflare
 * Workers). Stateless Streamable HTTP: every request gets a fresh McpServer and
 * transport, so nothing has to survive between Worker isolates.
 */
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

import { RegistryClient } from './client.js';
import { createRegistryMcpServer, SERVER_INFO } from './server.js';

export interface AppConfig {
  registryUrl: string;
  registryToken?: string;
  cfAccessClientId?: string;
  cfAccessClientSecret?: string;
  /** Shared bearer token for the local/dev entry. When unset, the server refuses every MCP request (never open by accident). */
  mcpToken?: string;
  /** Path the MCP endpoint answers on. Default /mcp. */
  mcpPath?: string;
  extAppsBundleJs?: string;
  today?: string;
  fetch?: typeof fetch;
}

export type AuthCheck = (request: Request) => Promise<Response | null> | Response | null;

function unauthorized(detail: string): Response {
  return new Response(JSON.stringify({ error: 'unauthorized', detail }), {
    status: 401,
    headers: { 'content-type': 'application/json', 'www-authenticate': 'Bearer realm="free-the-brain-mcp"' },
  });
}

/** Constant-time-ish string compare (both are short; the point is not to short-circuit on the first byte). */
function tokenEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function bearerTokenAuth(expected: string | undefined): AuthCheck {
  return (request) => {
    if (!expected) return unauthorized('MCP_TOKEN is not configured on the server; refusing rather than running open.');
    const header = request.headers.get('authorization') ?? '';
    const m = header.match(/^Bearer\s+(.+)$/i);
    if (!m || !tokenEquals(m[1].trim(), expected)) return unauthorized('Missing or invalid bearer token.');
    return null;
  };
}

export function createFetchHandler(config: AppConfig, auth: AuthCheck = bearerTokenAuth(config.mcpToken)) {
  const mcpPath = config.mcpPath ?? '/mcp';
  const client = new RegistryClient({
    baseUrl: config.registryUrl,
    token: config.registryToken,
    cfAccessClientId: config.cfAccessClientId,
    cfAccessClientSecret: config.cfAccessClientSecret,
    fetch: config.fetch,
  });

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health' || url.pathname === '/') {
      return new Response(JSON.stringify({ ok: true, server: SERVER_INFO, mcp: mcpPath }), {
        headers: { 'content-type': 'application/json' },
      });
    }

    if (url.pathname !== mcpPath) {
      return new Response('Not found', { status: 404 });
    }

    const denied = await auth(request);
    if (denied) return denied;

    if (request.method === 'GET' || request.method === 'DELETE') {
      // Stateless: no standalone SSE stream, no session to delete.
      return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed in stateless mode.' }, id: null }), {
        status: 405,
        headers: { 'content-type': 'application/json', allow: 'POST' },
      });
    }

    const server = createRegistryMcpServer({ client, today: config.today, extAppsBundleJs: config.extAppsBundleJs });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    try {
      await server.connect(transport);
      return await transport.handleRequest(request);
    } finally {
      // Close after the response has been produced; JSON mode means the body is complete by now.
      void server.close().catch(() => undefined);
    }
  };
}
