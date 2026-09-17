// Makes a `wrangler deploy --dry-run --outdir=<dir>` output self-contained for the dashboard's
// single-file Worker editor: wrangler emits the ext-apps UI bundle as a separate Text module
// (`import x from "./<hash>-ext-apps-bundle.txt"`); this script inlines it as a string literal.
//
//   npx wrangler deploy --dry-run --outdir=../deploy/mcp && node scripts/inline-bundle.mjs ../deploy/mcp
//
// Writes <dir>/worker.js in place (the .txt and the source map are left alone) and prints the size.
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dir = resolve(process.argv[2] ?? '../deploy/mcp');
const file = join(dir, 'worker.js');
let src = readFileSync(file, 'utf8');
const re = /^import\s+(\w+)\s+from\s+"(\.\/[^"]+\.txt)";\s*$/gm;
let n = 0;
src = src.replace(re, (_m, name, rel) => {
  const text = readFileSync(join(dir, rel), 'utf8');
  n++;
  return `var ${name} = ${JSON.stringify(text)};`;
});
if (n === 0) {
  console.log(`${file}: no .txt module imports found; already self-contained.`);
} else {
  writeFileSync(file, src);
  console.log(`${file}: inlined ${n} text module(s) → ${statSync(file).size} bytes`);
}
if (/^import\s/m.test(src)) {
  console.error('warning: the bundle still has import statements:');
  for (const line of src.split('\n')) if (/^import\s/.test(line)) console.error('  ' + line);
  process.exit(1);
}
