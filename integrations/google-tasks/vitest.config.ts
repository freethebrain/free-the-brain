// Vitest project for the Google Tasks relay: plain Node. The .gs script runs in a vm context over
// stubbed Apps Script globals (test/gas.ts); the service lane talks to the REAL Registry Service
// on a worker thread over node:sqlite (test/service-thread.ts). No network, no credentials.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'google-tasks',
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
