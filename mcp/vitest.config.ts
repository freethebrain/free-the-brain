import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // @cloudflare/workers-oauth-provider imports the workerd built-in; under Node it gets a stub.
    alias: { 'cloudflare:workers': fileURLToPath(new URL('./test/stubs/cloudflare-workers.ts', import.meta.url)) },
  },
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 20000,
    environment: 'node',
    // Inlined so the alias above applies to the package's own import.
    server: { deps: { inline: ['@cloudflare/workers-oauth-provider'] } },
  },
});
