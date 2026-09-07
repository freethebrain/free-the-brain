/**
 * Node entry — local development and tests.
 *
 *   MCP_TOKEN=… REGISTRY_URL=http://127.0.0.1:8787 npm run dev
 *
 * Adapts Node's http request/response to the Web-standard handler in app.ts so
 * the same code serves the Cloudflare Worker entry.
 */
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';

import { createFetchHandler, type AppConfig } from './app.js';

/** The official ext-apps browser bundle, read from node_modules at startup and inlined into the view resource. */
export function loadExtAppsBundle(): string | undefined {
  try {
    const require = createRequire(import.meta.url);
    const path = require.resolve('@modelcontextprotocol/ext-apps/app-with-deps');
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

async function toWebRequest(req: IncomingMessage, origin: string): Promise<Request> {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
    else headers.set(k, v);
  }
  const method = req.method ?? 'GET';
  const chunks: Buffer[] = [];
  if (method !== 'GET' && method !== 'HEAD') for await (const c of req) chunks.push(c as Buffer);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  return new Request(`${origin}${req.url ?? '/'}`, { method, headers, body });
}

async function writeWebResponse(res: Response, out: ServerResponse): Promise<void> {
  out.statusCode = res.status;
  res.headers.forEach((v, k) => out.setHeader(k, v));
  if (!res.body) {
    out.end();
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const stream = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream);
    stream.on('error', reject);
    out.on('error', reject);
    out.on('finish', resolve);
    stream.pipe(out);
  });
}

export interface NodeServerOptions extends AppConfig {
  port?: number;
  host?: string;
}

export function createNodeServer(options: NodeServerOptions): Server {
  const handle = createFetchHandler(options);
  return createServer(async (req, res) => {
    const host = req.headers.host ?? `${options.host ?? '127.0.0.1'}:${options.port ?? 0}`;
    try {
      const webReq = await toWebRequest(req, `http://${host}`);
      const webRes = await handle(webReq);
      await writeWebResponse(webRes, res);
    } catch (err) {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json');
      }
      res.end(JSON.stringify({ error: 'internal', detail: err instanceof Error ? err.message : String(err) }));
    }
  });
}

/** Start listening; resolves with the bound URL. */
export function listen(server: Server, port: number, host = '127.0.0.1'): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const addr = server.address();
      const p = typeof addr === 'object' && addr ? addr.port : port;
      resolve(`http://${host}:${p}`);
    });
  });
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const port = Number(process.env.PORT ?? 8788);
  const host = process.env.HOST ?? '127.0.0.1';
  const registryUrl = process.env.REGISTRY_URL ?? 'http://127.0.0.1:8787';
  const server = createNodeServer({
    registryUrl,
    registryToken: process.env.REGISTRY_TOKEN,
    cfAccessClientId: process.env.CF_ACCESS_CLIENT_ID,
    cfAccessClientSecret: process.env.CF_ACCESS_CLIENT_SECRET,
    mcpToken: process.env.MCP_TOKEN,
    mcpPath: process.env.MCP_PATH ?? '/mcp',
    extAppsBundleJs: loadExtAppsBundle(),
    port,
    host,
  });
  listen(server, port, host).then((url) => {
    console.log(`free-the-brain MCP (Node) listening on ${url}/mcp → registry ${registryUrl}`);
    if (!process.env.MCP_TOKEN) console.warn('MCP_TOKEN is not set: every MCP request will be refused with 401 until it is.');
  });
}
