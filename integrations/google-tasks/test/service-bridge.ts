// Main-thread handle on the service thread: spawns it, waits for "ready", and offers SYNCHRONOUS
// HTTP and SQL calls (postMessage + Atomics.wait on a SharedArrayBuffer) so the Apps Script's
// blocking UrlFetchApp.fetch can be stubbed faithfully against the real service.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

export interface SeedRow {
  id: string;
  task: string;
  category: string;
  u: string | null;
  i: string | null;
  status: string;
  recorded: string;
  triaged: string | null;
  deadline: string | null;
  deadline_type: string | null;
  deadline_kind: string | null;
  done: string | null;
  notes: string;
  blocker: string | null;
  updated_at: string;
}

export interface SyncResponse {
  status: number;
  headers: Record<string, string>;
  text: string;
}

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url) as unknown as string);
const MIGRATION = here('../../../service/migrations/0001_init.sql');
const THREAD = here('./service-thread.ts');
const BUFFER_BYTES = 4 * 1024 * 1024;

export class ServiceBridge {
  private readonly worker: Worker;
  private readonly ready: Promise<void>;
  readonly origin = 'http://registry.test';

  constructor(opts: { seed: SeedRow[]; stamp: string; env: Record<string, string>; nowIso: string }) {
    this.worker = new Worker(THREAD, {
      workerData: { migrationSql: readFileSync(MIGRATION, 'utf8'), ...opts },
      execArgv: ['--no-warnings'], // node:sqlite's ExperimentalWarning would otherwise print once per run
      stderr: false,
    });
    this.ready = new Promise<void>((resolve, reject) => {
      this.worker.once('message', (m) => (m?.kind === 'ready' ? resolve() : reject(new Error(`unexpected first message ${JSON.stringify(m)}`))));
      this.worker.once('error', reject);
      this.worker.once('exit', (code) => reject(new Error(`service thread exited early (${code})`)));
    });
  }

  waitReady(): Promise<void> {
    return this.ready;
  }

  private call<T>(msg: Record<string, unknown>): T {
    const sab = new SharedArrayBuffer(BUFFER_BYTES);
    const header = new Int32Array(sab, 0, 2);
    this.worker.postMessage({ ...msg, sab });
    const r = Atomics.wait(header, 0, 0, 20_000);
    if (r === 'timed-out') throw new Error('service thread did not answer within 20s');
    const bytes = new Uint8Array(sab, 8, header[1]);
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as T & { error?: string };
    if (payload.error) throw new Error(`service thread: ${payload.error}`);
    return payload;
  }

  /** A blocking HTTP round trip through the real app. */
  fetchSync(method: string, url: string, headers: Record<string, string> = {}, body: string | null = null): SyncResponse {
    return this.call<SyncResponse>({ kind: 'http', method: method.toUpperCase(), url, headers, body });
  }

  /** Read the service's tables directly (assertions on the judgments log, say). */
  sql<T = Record<string, unknown>>(sql: string, params: (string | number | null)[] = []): T[] {
    return this.call<{ rows: T[] }>({ kind: 'sql', sql, params }).rows;
  }

  /** Back to the seed: tasks, judgments, pending changes and meta. */
  reset(): void {
    this.call({ kind: 'reset' });
  }

  async close(): Promise<void> {
    await this.worker.terminate();
  }
}
