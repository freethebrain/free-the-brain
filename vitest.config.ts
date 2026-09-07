// Root vitest config: `npm test` runs every workspace project that has its own vitest config.
// client/ mcp/ site/ are built by other agents; they are picked up here only if they add a config.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/core', 'service'],
  },
});
