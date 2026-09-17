// Owner-token mode ("until Access"): with the OWNER_TOKEN secret set the service protects itself —
// the owner bearer has full access, every other route needs a bearer, the machine token keeps its
// scope, and /health plus the CORS preflight stay open. Same harness as relay.test.ts.
import { env } from 'cloudflare:test';
import type { Task } from '@ftb/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { runImport } from '../src/import.ts';
import type { Clock } from '../src/writes.ts';

const files = env.REGISTRY_FILES ?? [];
const hasRegistry = files.length > 0;

const clock: Clock = { now: () => new Date('2026-09-08T18:30:00Z') }; // Tuesday 2026-09-08 21:30 Europe/Sofia
const app = createApp({ clock });
const TODAY = '2026-09-08';
const OWNER = 'owner-secret-token';
const MACHINE = 'relay-secret-token';
/** The deployed shape tonight: OWNER_TOKEN set, MACHINE_TOKEN set for the relay. */
const OWNER_ENV = { ...env, OWNER_TOKEN: OWNER, MACHINE_TOKEN: MACHINE };
/** Owner mode without a machine token at all. */
const OWNER_ONLY_ENV = { ...env, OWNER_TOKEN: OWNER };

async function api(path: string, init: RequestInit = {}, bindings: object = OWNER_ENV) {
  const res = await app.request(`/api/v1${path}`, init, bindings);
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* plain text */
  }
  return { status: res.status, body: body as any, headers: res.headers };
}

function json(method: string, path: string, body: unknown, headers: Record<string, string> = {}, bindings: object = OWNER_ENV) {
  return api(path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }, bindings);
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function judgmentsFor(taskId: string) {
  const res = await env.DB.prepare('SELECT actor, source, human_judgment FROM judgments WHERE task_id = ? ORDER BY id').bind(taskId).all<{ actor: string; source: string; human_judgment: number }>();
  return res.results;
}

describe.skipIf(!hasRegistry)('owner-token mode (until Access)', () => {
  beforeAll(async () => {
    await runImport(env.DB, files, clock.now());
  });

  it('GET /health stays open without a bearer; every other route is 401 without one', async () => {
    const health = await api('/health');
    expect(health.status).toBe(200);
    expect(health.body.ok).toBe(true);

    for (const path of ['/registry', '/registry/open', '/queue', '/radar', '/dated', '/archive/pending']) {
      const res = await api(path);
      expect(res.status, path).toBe(401);
      expect(res.body).toMatchObject({ error: 'unauthorized', detail: expect.stringMatching(/owner-token mode/) });
    }
    // writes too — and a refused write must not write
    const before = (await api('/registry', { headers: bearer(OWNER) })).body.counts.total;
    const cap = await json('POST', '/capture', { actor: 'ftb', source: 'app', items: [{ task: 'must not land' }] });
    expect(cap.status).toBe(401);
    const judge = await json('POST', '/judgments', { actor: 'ftb', source: 'app', human_judgment: true, today: TODAY, judgments: [{ id: 'T-029', u: 'H' }] });
    expect(judge.status).toBe(401);
    expect((await api('/registry', { headers: bearer(OWNER) })).body.counts.total).toBe(before);
    // the same without any machine token configured
    expect((await api('/health', {}, OWNER_ONLY_ENV)).status).toBe(200);
    expect((await api('/registry', {}, OWNER_ONLY_ENV)).status).toBe(401);
  });

  it('the CORS preflight never needs a token in owner mode', async () => {
    const pre = await app.request(
      '/api/v1/judgments/text',
      { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type,x-actor,x-human-judgment' } },
      OWNER_ENV,
    );
    expect(pre.status).toBe(204);
    expect(pre.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    expect(pre.headers.get('Access-Control-Allow-Headers')).toMatch(/Authorization/);
  });

  it('a wrong or malformed bearer is 401 in owner mode, and a 401 still carries the CORS origin so the browser can read it', async () => {
    expect((await api('/registry', { headers: bearer('nope') })).status).toBe(401);
    expect((await api('/registry', { headers: { Authorization: 'Basic abc' } })).status).toBe(401);
    const res = await api('/registry', { headers: { Origin: 'http://localhost:5173' } });
    expect(res.status).toBe(401);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
  });

  it('the owner bearer has full access: reads, judgments, close, reopen, archive — actor defaults to ftb, source to app', async () => {
    for (const path of ['/health', '/registry', '/registry/open', '/queue', '/radar', '/dated', '/archive/pending']) {
      expect((await api(path, { headers: bearer(OWNER) })).status, path).toBe(200);
    }
    const before = (await api('/registry', { headers: bearer(OWNER) })).body.rows.find((r: Task) => r.id === 'T-029') as Task;

    // a judgment with no actor anywhere: the owner token supplies "ftb"
    const judge = await json('POST', '/judgments', { human_judgment: true, today: TODAY, judgments: [{ id: 'T-029', u: 'H', i: 'M' }] }, bearer(OWNER));
    expect(judge.status).toBe(200);
    expect(judge.body.applied).toBe(1);
    const row = (await api('/registry', { headers: bearer(OWNER) })).body.rows.find((r: Task) => r.id === 'T-029') as Task;
    expect(row).toMatchObject({ u: 'H', i: 'M', triaged: TODAY });
    expect((await judgmentsFor('T-029')).at(-1)).toEqual({ actor: 'ftb', source: 'app', human_judgment: 1 });

    // the widget's text route, headers as the client sends them
    const text = await api('/judgments/text', { method: 'POST', headers: { ...bearer(OWNER), 'Content-Type': 'text/plain', 'X-Human-Judgment': 'true' }, body: `TRIAGE — Master widget — ${TODAY} (staged from x)\nT-029 (${before.task}): U=M` });
    expect(text.status).toBe(200);
    expect(text.body.applied).toBe(1);
    expect((await judgmentsFor('T-029')).at(-1)).toEqual({ actor: 'ftb', source: 'app', human_judgment: 1 });

    // a body actor/source override the defaults
    const cap = await json('POST', '/capture', { actor: 'claude', source: 'mcp', items: [{ task: 'Owner capture, explicit actor' }] }, bearer(OWNER));
    expect(cap.status).toBe(200);
    expect(await judgmentsFor(cap.body.rows[0].id)).toEqual([{ actor: 'claude', source: 'mcp', human_judgment: 0 }]);
    // OWNER_ACTOR renames the default
    const named = await json('POST', '/capture', { items: [{ task: 'Owner capture, named default' }] }, bearer(OWNER), { ...OWNER_ENV, OWNER_ACTOR: 'christo' });
    expect(await judgmentsFor(named.body.rows[0].id)).toEqual([{ actor: 'christo', source: 'app', human_judgment: 0 }]);

    // close and reopen
    const id = cap.body.rows[0].id as string;
    const close = await json('POST', `/tasks/${id}/close`, { human_judgment: true }, bearer(OWNER));
    expect(close.status).toBe(200);
    expect(close.body.status).toBe('Done');
    const reopen = await json('POST', `/tasks/${id}/reopen`, { human_judgment: true, status: 'Planned' }, bearer(OWNER));
    expect(reopen.status).toBe(200);
    expect(reopen.body.status).toBe('Planned');
    // the covenant still applies to the owner — a token is not an attestation
    const noAttest = await json('POST', '/judgments', { today: TODAY, judgments: [{ id: 'T-029', u: 'L' }] }, bearer(OWNER));
    expect(noAttest.status).toBe(403);
    expect(noAttest.body.error).toBe('covenant');
  });

  it('the machine token keeps exactly its scope in owner mode: captures, notes and reads, never a judgment', async () => {
    const cap = await json('POST', '/capture', { source: 'gtasks', items: [{ task: 'Relay capture in owner mode' }] }, bearer(MACHINE));
    expect(cap.status).toBe(200);
    expect(await judgmentsFor(cap.body.rows[0].id)).toEqual([{ actor: 'gt-relay', source: 'gtasks', human_judgment: 0 }]);
    expect((await api('/dated', { headers: bearer(MACHINE) })).status).toBe(200);
    expect((await api('/health', { headers: bearer(MACHINE) })).status).toBe(200);

    const attempts: [string, string, unknown][] = [
      ['POST', '/judgments', { human_judgment: true, today: TODAY, judgments: [{ id: 'T-029', u: 'H' }] }],
      ['POST', '/tasks/T-029/close', { human_judgment: true }],
      ['POST', '/archive/flush', {}],
      ['GET', '/archive/pending', undefined],
    ];
    for (const [method, path, body] of attempts) {
      const res = body === undefined ? await api(path, { method, headers: bearer(MACHINE) }) : await json(method, path, body, bearer(MACHINE));
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(res.body.error).toBe('forbidden');
    }
    // a machine token presented where no machine token is configured is just a bad bearer
    expect((await api('/dated', { headers: bearer(MACHINE) }, OWNER_ONLY_ENV)).status).toBe(401);
  });

  it('Access mode is untouched: OWNER_TOKEN unset, a request without a bearer passes everywhere', async () => {
    const plain = { ...env, MACHINE_TOKEN: MACHINE };
    expect((await api('/registry', {}, plain)).status).toBe(200);
    expect((await api('/archive/pending', {}, plain)).status).toBe(200);
    const judge = await json('POST', '/judgments', { actor: 'ftb', source: 'app', human_judgment: true, today: TODAY, judgments: [{ id: 'T-029', u: 'M' }] }, {}, plain);
    expect(judge.status).toBe(200);
    // and the owner token is then just an unknown bearer
    expect((await api('/registry', { headers: bearer(OWNER) }, plain)).status).toBe(401);
  });
});
