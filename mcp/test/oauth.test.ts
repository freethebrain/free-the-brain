/**
 * The sign-in page (src/oauth.ts) against a fake OAUTH_PROVIDER. The provider
 * itself — discovery, registration, PKCE, token checks on /mcp — is the
 * package's; the end-to-end run through wrangler dev is scripts/worker-smoke.ts.
 */
import { AuthorizationError, type AuthRequest, type CompleteAuthorizationOptions, type OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import { describe, expect, it } from 'vitest';

import { FTB_USER_ID, oauthHandler, SCOPES } from '../src/oauth.js';
import type { Env } from '../src/worker.js';

const ORIGIN = 'https://mcp.test';
const PASSWORD = 'test-password-do-not-use';
const CLIENT_ID = 'client-1';
const REDIRECT = 'https://claude.example/callback';
const QUERY = new URLSearchParams({
  response_type: 'code',
  client_id: CLIENT_ID,
  redirect_uri: REDIRECT,
  state: 'st"ate<1>',
  code_challenge: 'x'.repeat(43),
  code_challenge_method: 'S256',
}).toString();

function fakeEnv(mcpToken: string | null = PASSWORD) {
  const completed: CompleteAuthorizationOptions[] = [];
  const helpers = {
    async parseAuthRequest(request: Request): Promise<AuthRequest> {
      const q = new URL(request.url).searchParams;
      if (q.get('client_id') !== CLIENT_ID) throw new AuthorizationError('invalid_request', { description: 'Invalid client' });
      const redirectUri = q.get('redirect_uri') ?? '';
      const state = q.get('state') ?? '';
      if (q.get('response_type') !== 'code') {
        throw new AuthorizationError('unsupported_response_type', { description: 'Only code', redirectUri, state, issuer: ORIGIN });
      }
      return { responseType: 'code', clientId: CLIENT_ID, redirectUri, scope: [], state, issuer: ORIGIN };
    },
    async lookupClient(clientId: string) {
      return clientId === CLIENT_ID ? { clientId, clientName: '<b>Claude</b> & co', redirectUris: [REDIRECT] } : null;
    },
    async completeAuthorization(options: CompleteAuthorizationOptions) {
      completed.push(options);
      return { redirectTo: `${options.request.redirectUri}?code=the-code&state=${encodeURIComponent(options.request.state)}` };
    },
  };
  const env = {
    REGISTRY_URL: 'http://127.0.0.1:1',
    MCP_TOKEN: mcpToken ?? undefined,
    OAUTH_PROVIDER: helpers as unknown as OAuthHelpers,
  } as Env;
  return { env, completed };
}

const get = (path: string) => new Request(`${ORIGIN}${path}`);
const post = (fields: Record<string, string>) =>
  new Request(`${ORIGIN}/authorize`, { method: 'POST', body: new URLSearchParams(fields) });

describe('sign-in page', () => {
  it('answers / and /health with JSON ok, no auth', async () => {
    const { env } = fakeEnv();
    for (const path of ['/', '/health']) {
      const res = await oauthHandler.fetch(get(path), env);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, mcp: '/mcp' });
    }
  });

  it('refuses with 503 when MCP_TOKEN is unset, on GET and POST alike', async () => {
    const { env, completed } = fakeEnv(null);
    expect((await oauthHandler.fetch(get(`/authorize?${QUERY}`), env)).status).toBe(503);
    expect((await oauthHandler.fetch(post({ oauth_query: QUERY, password: '' }), env)).status).toBe(503);
    expect(completed).toHaveLength(0);
  });

  it('GET renders the password form, carrying the query and escaping everything', async () => {
    const { env } = fakeEnv();
    const res = await oauthHandler.fetch(get(`/authorize?${QUERY}`), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/html/);
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    const html = await res.text();
    expect(html).toContain('<title>Free the Brain</title>');
    expect(html).toContain('#8e9dfa');
    expect(html).toContain('&lt;b&gt;Claude&lt;/b&gt; &amp; co');
    expect(html).not.toContain('<b>Claude</b>');
    expect(html).toContain(`name="oauth_query" value="${QUERY.replace(/&/g, '&amp;')}"`);
    expect(html).toContain('claude.example');
  });

  it('wrong password: 401 and the form again, no grant', async () => {
    const { env, completed } = fakeEnv();
    const res = await oauthHandler.fetch(post({ oauth_query: QUERY, password: 'nope' }), env);
    expect(res.status).toBe(401);
    const html = await res.text();
    expect(html).toContain('Wrong password.');
    expect(html).toContain('name="password"');
    expect(completed).toHaveLength(0);
  });

  it('right password: completes as FtB with both scopes and 302s to the redirect URI with a code', async () => {
    const { env, completed } = fakeEnv();
    const res = await oauthHandler.fetch(post({ oauth_query: QUERY, password: PASSWORD }), env);
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location') ?? '');
    expect(`${location.origin}${location.pathname}`).toBe(REDIRECT);
    expect(location.searchParams.get('code')).toBe('the-code');
    expect(location.searchParams.get('state')).toBe('st"ate<1>');
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({
      userId: FTB_USER_ID,
      scope: SCOPES,
      props: { userId: 'ftb', displayName: 'FtB' },
    });
    expect(SCOPES).toEqual(['registry:read', 'registry:write']);
  });

  it('re-validates the posted query: a tampered client is refused locally, never redirected', async () => {
    const { env, completed } = fakeEnv();
    const tampered = QUERY.replace(CLIENT_ID, 'evil');
    const res = await oauthHandler.fetch(post({ oauth_query: tampered, password: PASSWORD }), env);
    expect(res.status).toBe(400);
    expect(res.headers.get('location')).toBeNull();
    expect(completed).toHaveLength(0);
  });

  it('an error with a validated redirect URI goes back to the client as an OAuth error', async () => {
    const { env } = fakeEnv();
    const res = await oauthHandler.fetch(get(`/authorize?${QUERY.replace('response_type=code', 'response_type=token')}`), env);
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location') ?? '');
    expect(location.searchParams.get('error')).toBe('unsupported_response_type');
    expect(location.searchParams.get('state')).toBe('st"ate<1>');
    expect(location.searchParams.get('iss')).toBe(ORIGIN);
  });

  it('anything else is 404', async () => {
    const { env } = fakeEnv();
    expect((await oauthHandler.fetch(get('/nope'), env)).status).toBe(404);
  });
});
