// Inlines shared partials into the pages. No dependencies; run with `node build.mjs`.
//
//   src/pages/*.html      — one file per page; starts with <!-- @page key="value" … -->
//   src/partials/*.html   — shared fragments, pulled in with <!-- @include name -->
//   ./*.html              — the output, committed, served as-is by Cloudflare Pages
//
// Substitutions inside pages and partials:
//   {{title}} {{description}} {{path}} — from the page's @page comment
//   {{active:NAME}}                     — ` aria-current="page"` when the page's `name` is NAME

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const pagesDir = join(root, 'src', 'pages');
const partialsDir = join(root, 'src', 'partials');

const partials = new Map();
for (const f of await readdir(partialsDir)) {
  if (f.endsWith('.html')) partials.set(f.slice(0, -5), await readFile(join(partialsDir, f), 'utf8'));
}

function render(text, vars) {
  // includes first (they may carry variables of their own), then variables
  let out = text.replace(/<!--\s*@include\s+([\w-]+)\s*-->/g, (_, name) => {
    const p = partials.get(name);
    if (p === undefined) throw new Error(`unknown partial "${name}"`);
    return p.trimEnd();
  });
  out = out.replace(/\{\{active:([\w-]+)\}\}/g, (_, name) => (name === vars.name ? ' aria-current="page"' : ''));
  out = out.replace(/\{\{(\w+)\}\}/g, (m, key) => {
    if (!(key in vars)) throw new Error(`unknown variable "${key}" in ${vars.file}`);
    return vars[key];
  });
  return out;
}

let count = 0;
for (const file of await readdir(pagesDir)) {
  if (!file.endsWith('.html')) continue;
  const src = await readFile(join(pagesDir, file), 'utf8');
  const head = src.match(/^<!--\s*@page\s+([\s\S]*?)-->/);
  if (!head) throw new Error(`${file}: missing <!-- @page … --> header`);
  const vars = { file, name: file.slice(0, -5), path: file === 'index.html' ? '/' : `/${file.slice(0, -5)}` };
  for (const [, k, v] of head[1].matchAll(/(\w+)="([^"]*)"/g)) vars[k] = v;
  const body = src.slice(head[0].length).trimStart();
  await writeFile(join(root, file), render(body, vars));
  count++;
}
console.log(`built ${count} pages`);
