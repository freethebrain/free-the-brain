// Vitest project for the service: runs the tests inside workerd with a real (local) D1 via
// @cloudflare/vitest-pool-workers. Migrations are read here (Node side) and applied in the setup
// file; the real registry files are read here too and handed to the worker as a binding, because
// the worker itself has no filesystem.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

const REGISTRY_DIR = resolve(import.meta.dirname, '../data/registry');

function registryFiles(): { name: string; content: string }[] {
  if (!existsSync(REGISTRY_DIR)) return [];
  return readdirSync(REGISTRY_DIR)
    .filter((n) => n.endsWith('.md'))
    .map((name) => ({ name, content: readFileSync(join(REGISTRY_DIR, name), 'utf8') }));
}

export default defineConfig(async () => {
  const migrations = await readD1Migrations(join(import.meta.dirname, 'migrations'));
  return {
    resolve: { alias: { '@ftb/core': resolve(import.meta.dirname, '../packages/core/src/index.ts') } },
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations, REGISTRY_FILES: registryFiles() },
        },
      }),
    ],
    test: {
      name: 'service',
      include: ['test/**/*.test.ts'],
      setupFiles: ['./test/apply-migrations.ts'],
    },
  };
});
