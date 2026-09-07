// In-memory stand-ins for the Apps Script globals gt-relay-v2.gs touches, plus the vm loader that
// runs the .gs file (plain JavaScript) against them. Everything is observable: API calls, files,
// properties, mails, triggers and log lines are recorded for the assertions.
//
// Fidelity notes, where the real platform has a behaviour the script depends on:
//   - Tasks.Tasks.list honours showCompleted:false, maxResults and pageToken (the script pages).
//   - Tasks.Tasks.patch throws when the task is not in that list (the script catches and re-inserts).
//   - DriveApp allows duplicate names (the script probes getFilesByName before creating).
//   - PropertiesService enforces the platform's 9 KB per-value limit ("Argument too large") —
//     a real quota the cursor design runs into; see FIT-ASSESSMENT.md.
//   - UrlFetchApp.fetch is synchronous and honours muteHttpExceptions; a non-2xx without it throws.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import type { ServiceBridge } from './service-bridge.ts';

export interface GTask {
  id: string;
  title: string;
  notes?: string;
  status: 'needsAction' | 'completed';
  updated: string;
  due?: string;
  parent?: string;
  position: string;
  completed?: string;
}
export interface GList {
  id: string;
  title: string;
  tasks: GTask[];
}

export interface DriveFile {
  name: string;
  content: string;
  mime: string;
  created: string;
}

export interface ApiCall {
  api: string;
  args: unknown[];
}

export interface Mail {
  to: string;
  subject: string;
  body: string;
}

export interface GasWorld {
  clock: { now: Date; set(iso: string): void };
  lists: GList[];
  files: DriveFile[];
  props: Map<string, string>;
  mails: Mail[];
  triggers: { handler: string; minutes: number }[];
  log: string[];
  calls: ApiCall[];
  fetches: { url: string; method: string; headers: Record<string, string>; payload: string | null; status: number }[];
  /** Fault injection: make the next createFile throw. */
  failNextCreateFile: Error | null;
  globals: Record<string, unknown>;
  addList(title: string): GList;
  addTask(listTitle: string, t: Partial<GTask> & { title: string }): GTask;
  addFile(name: string, content: string): DriveFile;
}

const FOLDER_ID = '1yZabLPGJAkxeu748rA89swQLDoFuMRu8';
const PROPERTY_VALUE_LIMIT = 9 * 1024; // Apps Script quota: 9 KB per property value

let seq = 0;
/** Google Tasks ids are opaque base64-ish strings of ~32 chars; the length matters for the property-size quota. */
function gtId(prefix: string): string {
  seq++;
  return `${prefix}${String(seq).padStart(4, '0')}`.padEnd(32, 'x');
}

function formatDate(date: Date, tz: string, pattern: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return pattern.replace('yyyy', get('year')).replace('MM', get('month')).replace('dd', get('day')).replace('HH', get('hour')).replace('mm', get('minute')).replace('ss', get('second'));
}

function iterator<T>(items: T[]) {
  let k = 0;
  return { hasNext: () => k < items.length, next: () => items[k++]! };
}

export function makeWorld(opts: { nowIso: string; bridge?: ServiceBridge; email?: string }): GasWorld {
  const email = opts.email ?? 'ftb@example.test';
  const clockState = { now: new Date(opts.nowIso) };
  const world: GasWorld = {
    clock: {
      get now() {
        return clockState.now;
      },
      set(iso: string) {
        clockState.now = new Date(iso);
      },
    },
    lists: [],
    files: [],
    props: new Map(),
    mails: [],
    triggers: [],
    log: [],
    calls: [],
    fetches: [],
    failNextCreateFile: null,
    globals: {},
    addList(title) {
      const l: GList = { id: gtId('list'), title, tasks: [] };
      world.lists.push(l);
      return l;
    },
    addTask(listTitle, t) {
      const l = world.lists.find((x) => x.title === listTitle);
      if (!l) throw new Error(`no list ${listTitle}`);
      const task: GTask = { id: gtId('task'), status: 'needsAction', updated: clockState.now.toISOString(), position: String(l.tasks.length).padStart(20, '0'), ...t };
      l.tasks.push(task);
      return task;
    },
    addFile(name, content) {
      const f: DriveFile = { name, content, mime: 'text/plain', created: clockState.now.toISOString() };
      world.files.push(f);
      return f;
    },
  };

  const record = (api: string, ...args: unknown[]) => world.calls.push({ api, args });
  const listById = (id: string) => {
    const l = world.lists.find((x) => x.id === id);
    if (!l) throw new Error(`Tasks API: list ${id} not found`);
    return l;
  };

  const Tasks = {
    Tasklists: {
      list() {
        record('Tasklists.list');
        return { items: world.lists.map((l) => ({ id: l.id, title: l.title })) };
      },
      insert(body: { title: string }) {
        record('Tasklists.insert', body);
        const l = world.addList(body.title);
        return { id: l.id, title: l.title };
      },
    },
    Tasks: {
      list(listId: string, q: { showCompleted?: boolean; showHidden?: boolean; maxResults?: number; pageToken?: string | null } = {}) {
        record('Tasks.list', listId, q);
        const l = listById(listId);
        let items = l.tasks.slice();
        if (q.showCompleted === false) items = items.filter((t) => t.status !== 'completed');
        const max = q.maxResults ?? 100;
        const start = q.pageToken ? Number(q.pageToken) : 0;
        const page = items.slice(start, start + max);
        const out: { items: GTask[]; nextPageToken?: string } = { items: page.map((t) => ({ ...t })) };
        if (start + max < items.length) out.nextPageToken = String(start + max);
        return out;
      },
      insert(body: Partial<GTask>, listId: string) {
        record('Tasks.insert', body, listId);
        const l = listById(listId);
        const t: GTask = { id: gtId('task'), title: body.title ?? '', status: body.status ?? 'needsAction', updated: clockState.now.toISOString(), position: String(l.tasks.length).padStart(20, '0') };
        if (body.notes !== undefined) t.notes = body.notes;
        if (body.due !== undefined) t.due = body.due;
        l.tasks.push(t);
        return { ...t };
      },
      patch(body: Partial<GTask>, listId: string, taskId: string) {
        record('Tasks.patch', body, listId, taskId);
        const l = listById(listId);
        const t = l.tasks.find((x) => x.id === taskId);
        if (!t) throw new Error(`Tasks API: task ${taskId} not found in list ${listId}`);
        Object.assign(t, body, { updated: clockState.now.toISOString() });
        if (body.status === 'completed') t.completed = clockState.now.toISOString();
        return { ...t };
      },
    },
  };

  const fileHandle = (f: DriveFile) => ({
    getName: () => f.name,
    getBlob: () => ({ getDataAsString: (_cs?: string) => f.content }),
  });
  const DriveApp = {
    getFolderById(id: string) {
      record('DriveApp.getFolderById', id);
      if (id !== FOLDER_ID) throw new Error(`Drive: folder ${id} not found`);
      return {
        getFiles: () => iterator(world.files.map(fileHandle)),
        getFilesByName: (name: string) => iterator(world.files.filter((f) => f.name === name).map(fileHandle)),
        createFile(name: string, content: string, mime: string) {
          record('DriveApp.createFile', name, mime);
          if (world.failNextCreateFile) {
            const e = world.failNextCreateFile;
            world.failNextCreateFile = null;
            throw e;
          }
          const f: DriveFile = { name, content, mime, created: clockState.now.toISOString() };
          world.files.push(f);
          return fileHandle(f);
        },
      };
    },
  };

  const props = {
    getProperty: (k: string) => world.props.get(k) ?? null,
    setProperty(k: string, v: string) {
      if (Buffer.byteLength(String(v), 'utf8') > PROPERTY_VALUE_LIMIT) throw new Error(`Argument too large: value (${Buffer.byteLength(String(v), 'utf8')} bytes > ${PROPERTY_VALUE_LIMIT})`);
      world.props.set(k, String(v));
      return props;
    },
    deleteProperty(k: string) {
      world.props.delete(k);
      return props;
    },
    getProperties: () => Object.fromEntries(world.props),
  };
  const PropertiesService = { getScriptProperties: () => props };

  const UrlFetchApp = {
    fetch(url: string, o: { method?: string; contentType?: string; payload?: string; headers?: Record<string, string>; muteHttpExceptions?: boolean } = {}) {
      const method = (o.method ?? 'get').toUpperCase();
      const headers: Record<string, string> = { ...(o.headers ?? {}) };
      if (o.contentType) headers['Content-Type'] = o.contentType;
      if (!opts.bridge) throw new Error(`UrlFetchApp: no service wired for ${url}`);
      const res = opts.bridge.fetchSync(method, url, headers, o.payload ?? null);
      world.fetches.push({ url, method, headers, payload: o.payload ?? null, status: res.status });
      if (res.status >= 400 && !o.muteHttpExceptions) throw new Error(`Request failed for ${url} returned code ${res.status}`);
      return { getResponseCode: () => res.status, getContentText: () => res.text, getAllHeaders: () => res.headers };
    },
  };

  const ScriptApp = {
    getProjectTriggers: () => world.triggers.map((t) => ({ getHandlerFunction: () => t.handler, _t: t })),
    deleteTrigger(h: { _t: { handler: string } }) {
      world.triggers = world.triggers.filter((t) => t !== h._t);
    },
    newTrigger(handler: string) {
      return {
        timeBased: () => ({
          everyMinutes: (minutes: number) => ({
            create() {
              world.triggers.push({ handler, minutes });
            },
          }),
        }),
      };
    },
  };

  /** The script's `new Date()` reads the world clock, so stamps are deterministic. */
  class FakeDate extends Date {
    constructor(...args: [] | [number | string | Date]) {
      if (args.length === 0) super(clockState.now.getTime());
      else super(args[0] as number);
    }
    static override now(): number {
      return clockState.now.getTime();
    }
  }

  world.globals = {
    Tasks,
    DriveApp,
    PropertiesService,
    UrlFetchApp,
    ScriptApp,
    MailApp: {
      sendEmail(to: string, subject: string, body: string) {
        world.mails.push({ to, subject, body });
      },
    },
    Session: { getEffectiveUser: () => ({ getEmail: () => email }) },
    Utilities: { formatDate },
    Logger: {
      log(s: unknown) {
        world.log.push(String(s));
      },
    },
    MimeType: { PLAIN_TEXT: 'text/plain' },
    Date: FakeDate,
    console,
  };
  return world;
}

export interface LoadedRelay {
  world: GasWorld;
  config: Record<string, any>;
  service: Record<string, string>;
  /** Call a top-level function of the script by name. */
  fn<T = unknown>(name: string, ...args: unknown[]): T;
}

/** Evaluate the .gs file in a fresh vm context over the world's globals. */
export function loadRelay(file: URL | string, world: GasWorld): LoadedRelay {
  const path = typeof file === 'string' ? file : fileURLToPath(file as unknown as string);
  const code = readFileSync(path, 'utf8');
  const ctx = vm.createContext({ ...world.globals });
  new vm.Script(code, { filename: basename(path) }).runInContext(ctx);
  return {
    world,
    config: vm.runInContext('CONFIG', ctx),
    service: vm.runInContext('SERVICE', ctx),
    fn(name, ...args) {
      const f = ctx[name];
      if (typeof f !== 'function') throw new Error(`script has no function ${name}`);
      return f(...args);
    },
  };
}
