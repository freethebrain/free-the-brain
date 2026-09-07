// Worker entry: exports the Hono app's fetch handler. All logic lives in app.ts so tests can
// build the app with a fake clock.
import { createApp } from './app.ts';

const app = createApp();

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<{ DB: D1Database }>;
