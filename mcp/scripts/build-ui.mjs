// Copies the official ext-apps browser bundle into src/generated/ so the Worker
// build can inline it into the MCP App view (wrangler Text module rule). The Node
// entry reads the same file straight from node_modules at startup instead.
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const src = require.resolve('@modelcontextprotocol/ext-apps/app-with-deps');
const outDir = join(here, '..', 'src', 'generated');
mkdirSync(outDir, { recursive: true });
copyFileSync(src, join(outDir, 'ext-apps-bundle.txt'));
writeFileSync(join(outDir, '.gitignore'), '*\n!.gitignore\n!modules.d.ts\n');
console.log(`ext-apps bundle → ${join(outDir, 'ext-apps-bundle.txt')}`);
