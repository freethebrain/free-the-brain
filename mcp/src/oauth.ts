/**
 * The OAuth provider's defaultHandler (src/worker.ts): every request outside /mcp
 * that the provider does not answer itself. The provider owns /.well-known/*,
 * /oauth/token and /oauth/register; this file owns the sign-in page.
 *
 * Single user. /authorize asks for one password, the MCP_TOKEN secret. The right
 * password completes the authorization as FtB and sends the browser back to the
 * client's redirect URI with a code; the provider then trades that code for
 * tokens (PKCE) on its own. MCP_TOKEN unset → 503: an unconfigured Worker never
 * issues a token.
 */
import { AuthorizationError, type AuthRequest } from '@cloudflare/workers-oauth-provider';

import { SERVER_INFO } from './server.js';
import type { Env } from './worker.js';

export const FTB_USER_ID = 'ftb';
export const SCOPES = ['registry:read', 'registry:write'];

/** What the provider hands the API handler as ctx.props once an access token checks out. */
export interface FtbProps {
  userId: string;
  displayName: string;
}

const BRAND = '#8e9dfa';

const HTML_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
};

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Hash both sides, then compare the digests without an early exit: equal-length
 * inputs to the loop, so neither the first differing byte nor the length leaks.
 */
async function passwordMatches(given: string, expected: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all(
    [given, expected].map(async (s) => new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s))))
  );
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function text(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
}

interface FormPage {
  /** The original /authorize query string, without the leading "?". */
  query: string;
  clientName: string;
  redirectHost: string;
  error?: string;
}

function signInPage(p: FormPage): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Free the Brain</title>
<style>
  :root { color-scheme: light dark; --bg: #f4f5fb; --card: #ffffff; --fg: #1d1f2b; --muted: #5b5f73; --line: #c9cce0; }
  @media (prefers-color-scheme: dark) { :root { --bg: #14151c; --card: #1d1f2b; --fg: #e8e9f1; --muted: #a3a7bb; --line: #3a3d50; } }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--fg);
         font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { box-sizing: border-box; width: min(24rem, calc(100vw - 2rem)); padding: 2rem; background: var(--card);
         border-top: 4px solid ${BRAND}; border-radius: 12px; box-shadow: 0 1px 4px rgb(0 0 0 / 0.15); }
  h1 { margin: 0 0 0.5rem; font-size: 1.4rem; }
  p { margin: 0 0 1rem; color: var(--muted); font-size: 0.95rem; }
  p strong { color: var(--fg); }
  label { display: block; margin-bottom: 0.25rem; font-size: 0.85rem; }
  input[type=password] { box-sizing: border-box; width: 100%; padding: 0.6rem 0.75rem; font: inherit; color: inherit;
         background: var(--bg); border: 1px solid var(--line); border-radius: 8px; }
  input[type=password]:focus { outline: 2px solid ${BRAND}; outline-offset: 1px; }
  button { width: 100%; margin-top: 1rem; padding: 0.65rem; font: inherit; font-weight: 600; color: #14151c;
         background: ${BRAND}; border: 0; border-radius: 8px; cursor: pointer; }
  .error { color: #d64545; font-weight: 600; }
</style>
</head>
<body>
<main>
  <h1>Free the Brain</h1>
  <p><strong>${escapeHtml(p.clientName)}</strong> is asking to use the task registry and will return to <strong>${escapeHtml(p.redirectHost)}</strong>.</p>
  ${p.error ? `<p class="error" role="alert">${escapeHtml(p.error)}</p>` : ''}
  <form method="post" action="/authorize">
    <input type="hidden" name="oauth_query" value="${escapeHtml(p.query)}">
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
    <button type="submit">Sign in</button>
  </form>
</main>
</body>
</html>
`;
}

/**
 * parseAuthRequest / completeAuthorization failures, as the package README
 * prescribes: without a validated redirect URI the error is rendered here and
 * never redirected; with one, it goes back to the client as an OAuth error.
 */
function authorizationFailure(error: unknown): Response {
  if (!(error instanceof AuthorizationError)) throw error;
  if (!error.redirectUri) return text(400, error.description);
  const redirect = new URL(error.redirectUri);
  redirect.searchParams.set('error', error.code);
  redirect.searchParams.set('error_description', error.description);
  if (error.state) redirect.searchParams.set('state', error.state);
  if (error.issuer) redirect.searchParams.set('iss', error.issuer);
  return Response.redirect(redirect.toString(), 302);
}

async function parse(request: Request, env: Env): Promise<AuthRequest | Response> {
  try {
    return await env.OAUTH_PROVIDER.parseAuthRequest(request);
  } catch (error) {
    return authorizationFailure(error);
  }
}

async function formFor(authRequest: AuthRequest, query: string, env: Env, status: number, error?: string): Promise<Response> {
  const client = await env.OAUTH_PROVIDER.lookupClient(authRequest.clientId);
  if (!client) return text(400, 'Unknown OAuth client.');
  const redirect = new URL(authRequest.redirectUri);
  const page = signInPage({
    query,
    clientName: client.clientName || authRequest.clientId,
    // A custom-scheme redirect (an app's own URI) has no host; show the scheme instead.
    redirectHost: redirect.host || redirect.protocol,
    error,
  });
  return new Response(page, { status, headers: HTML_HEADERS });
}

async function showForm(request: Request, env: Env): Promise<Response> {
  const parsed = await parse(request, env);
  if (parsed instanceof Response) return parsed;
  return formFor(parsed, new URL(request.url).search.slice(1), env, 200);
}

async function signIn(request: Request, env: Env, expected: string): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return text(400, 'Expected a form submission.');
  }
  const query = String(form.get('oauth_query') ?? '');
  const password = String(form.get('password') ?? '');

  // Rebuild the original authorization request from the hidden field and validate it again:
  // nothing the browser posts back is trusted until the provider has re-checked it.
  const original = new URL('/authorize', request.url);
  original.search = query;
  const parsed = await parse(new Request(original.toString()), env);
  if (parsed instanceof Response) return parsed;

  if (!(await passwordMatches(password, expected))) {
    return formFor(parsed, query, env, 401, 'Wrong password.');
  }

  const client = await env.OAUTH_PROVIDER.lookupClient(parsed.clientId);
  const props: FtbProps = { userId: FTB_USER_ID, displayName: 'FtB' };
  let redirectTo: string;
  try {
    ({ redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
      request: parsed,
      userId: FTB_USER_ID,
      metadata: { clientName: client?.clientName ?? parsed.clientId },
      scope: SCOPES,
      props,
    }));
  } catch (error) {
    return authorizationFailure(error);
  }
  return new Response(null, { status: 302, headers: { location: redirectTo, 'cache-control': 'no-store' } });
}

export const oauthHandler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true, server: SERVER_INFO, mcp: '/mcp', auth: 'oauth' }), {
        headers: { 'content-type': 'application/json' },
      });
    }

    if (url.pathname !== '/authorize') return text(404, 'Not found');

    const expected = env.MCP_TOKEN;
    if (!expected) return text(503, 'Sign-in is not configured: the MCP_TOKEN secret is unset, so this server issues no tokens.');

    if (request.method === 'GET') return showForm(request, env);
    if (request.method === 'POST') return signIn(request, env, expected);
    return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, POST' } });
  },
};
