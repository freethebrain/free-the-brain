/**
 * Thin fetch client for the Registry Service (docs/api-contract.md).
 * Every write carries actor + source; the MCP layer always sends source "mcp".
 */
import type {
  CaptureItem,
  JudgmentBatch,
  JudgmentsResponse,
  QueueResponse,
  RadarResponse,
  RegistryEnvelope,
  Task,
} from './types.js';

export interface RegistryClientOptions {
  /** Origin of the service, e.g. http://127.0.0.1:8787 — /api/v1 is appended unless already present. */
  baseUrl: string;
  /** Optional bearer token forwarded to the service as Authorization. */
  token?: string;
  /** Optional Cloudflare Access service-token pair, forwarded as CF-Access-Client-Id / -Secret. */
  cfAccessClientId?: string;
  cfAccessClientSecret?: string;
  fetch?: typeof fetch;
}

export class RegistryError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    message: string
  ) {
    super(message);
    this.name = 'RegistryError';
  }
  get isCovenant(): boolean {
    return this.status === 403 && typeof this.body === 'object' && this.body !== null && (this.body as { error?: string }).error === 'covenant';
  }
}

export class RegistryClient {
  private readonly api: string;
  private readonly fetchImpl: typeof fetch;
  private readonly headers: Record<string, string>;

  constructor(opts: RegistryClientOptions) {
    const trimmed = opts.baseUrl.replace(/\/+$/, '');
    this.api = trimmed.endsWith('/api/v1') ? trimmed : `${trimmed}/api/v1`;
    // Wrapped, not stored bare: workerd throws "Illegal invocation" when fetch is called with a foreign `this`.
    const f = opts.fetch ?? fetch;
    this.fetchImpl = (input, init) => f(input, init);
    this.headers = { accept: 'application/json' };
    if (opts.token) this.headers.authorization = `Bearer ${opts.token}`;
    if (opts.cfAccessClientId && opts.cfAccessClientSecret) {
      this.headers['cf-access-client-id'] = opts.cfAccessClientId;
      this.headers['cf-access-client-secret'] = opts.cfAccessClientSecret;
    }
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const init: RequestInit = { method, headers: { ...this.headers } };
    if (body !== undefined) {
      (init.headers as Record<string, string>)['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.api}${path}`, init);
    } catch (err) {
      throw new RegistryError(0, null, `Registry Service unreachable at ${this.api}: ${(err as Error).message}`);
    }
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON body; keep the text */
    }
    if (!res.ok) {
      const detail =
        typeof parsed === 'object' && parsed !== null
          ? ((parsed as { detail?: string; error?: string }).detail ?? (parsed as { error?: string }).error ?? text)
          : text;
      throw new RegistryError(res.status, parsed, `Registry Service ${method} ${path} → ${res.status}: ${detail}`);
    }
    return parsed as T;
  }

  health(): Promise<{ ok: boolean; stamp: string; rows: number }> {
    return this.request('GET', '/health');
  }

  registry(openOnly = false): Promise<RegistryEnvelope> {
    return this.request('GET', openOnly ? '/registry/open' : '/registry');
  }

  queue(chunk = 5, page = 0): Promise<QueueResponse> {
    return this.request('GET', `/queue?chunk=${encodeURIComponent(chunk)}&page=${encodeURIComponent(page)}`);
  }

  radar(days = 14): Promise<RadarResponse> {
    return this.request('GET', `/radar?days=${encodeURIComponent(days)}`);
  }

  judgments(batch: JudgmentBatch): Promise<JudgmentsResponse> {
    return this.request('POST', '/judgments', batch);
  }

  capture(items: CaptureItem[], actor: string): Promise<{ rows: Task[] }> {
    return this.request('POST', '/capture', { items, actor, source: 'mcp' });
  }

  close(id: string, body: { actor: string; human_judgment: true; done?: string; note?: string }): Promise<Task> {
    return this.request('POST', `/tasks/${encodeURIComponent(id)}/close`, { ...body, source: 'mcp' });
  }

  reopen(
    id: string,
    body: { actor: string; human_judgment: true; status: 'Planned' | 'Active' | 'Blocked' | 'Dropped'; note?: string }
  ): Promise<Task> {
    return this.request('POST', `/tasks/${encodeURIComponent(id)}/reopen`, { ...body, source: 'mcp' });
  }

  note(id: string, body: { actor: string; text: string }): Promise<Task> {
    return this.request('POST', `/tasks/${encodeURIComponent(id)}/note`, { ...body, source: 'mcp' });
  }
}
