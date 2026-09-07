// Setup file: apply the D1 migrations to the isolated test database before each test file.
import { applyD1Migrations, env } from 'cloudflare:test';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
