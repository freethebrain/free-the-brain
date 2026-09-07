// Bindings visible inside the test worker (see vitest.config.ts). `Cloudflare.Env` is the global
// interface the pool types `env` with; declarations merge.
import type { D1Migration } from '@cloudflare/vitest-pool-workers';

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      TEST_MIGRATIONS: D1Migration[];
      REGISTRY_FILES: { name: string; content: string }[];
    }
  }
}

export {};
