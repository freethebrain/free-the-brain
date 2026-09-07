// Root vitest config: `npm test` runs every workspace project that has its own vitest config.
// client/ mcp/ site/ are built by other agents; they are picked up here only if they add a config.
// integrations/google-tasks is not an npm workspace (nothing to install); its tests resolve from the root.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/core', 'service', 'client', 'mcp', 'integrations/google-tasks'],
  },
});
