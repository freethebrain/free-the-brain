// Test helper: loads the real registry files from data/registry (gitignored, read-only) so the
// parser is exercised on the actual archive. Tests that need it skip when the folder is absent.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { RegistryFile } from '../src/index.ts';

export const REGISTRY_DIR = resolve(import.meta.dirname, '../../../data/registry');
export const BASE_STAMP = '2026-08-31-1137';
export const LATER_DELTAS = [
  '2026-08-31-1153',
  '2026-09-01-2014',
  '2026-09-01-2104',
  '2026-09-03-2321',
  '2026-09-03-2322',
  '2026-09-04-1425',
  '2026-09-06-1438',
  '2026-09-06-1442',
  '2026-09-06-1445',
];

export const hasRegistry = existsSync(join(REGISTRY_DIR, `Task Registry — ${BASE_STAMP}.md`));

export function loadRegistryFiles(): RegistryFile[] {
  return readdirSync(REGISTRY_DIR)
    .filter((n) => n.endsWith('.md'))
    .map((name) => ({ name, content: readFileSync(join(REGISTRY_DIR, name), 'utf8') }));
}

export function readRegistryFile(name: string): string {
  return readFileSync(join(REGISTRY_DIR, name), 'utf8');
}
