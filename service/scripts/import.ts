// Node script: read a registry folder (newest snapshot + later deltas), print the SQL that seeds
// the tasks/meta tables. Usage: tsx scripts/import.ts ../data/registry > .import.sql
// then: wrangler d1 execute DB --local --file=.import.sql   (see README.md)
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { countRows, nextFreeId } from '@ftb/core';
import { planImport, toSqlText } from '../src/import.ts';

const dir = resolve(process.argv[2] ?? '../data/registry');
const files = readdirSync(dir)
  .filter((n) => n.endsWith('.md'))
  .map((name) => ({ name, content: readFileSync(join(dir, name), 'utf8') }));

const plan = planImport(files);
const counts = countRows(plan.registry.rows);
process.stderr.write(
  `Base ${plan.registry.baseStamp} + ${plan.registry.deltas.length} deltas (${plan.registry.deltas.map((d) => d.stamp).join(', ')}) → ${counts.total} rows: ${counts.open} open, ${counts.done} done, ${counts.dropped} dropped. Next free ID ${nextFreeId(plan.registry.rows)}.\n`,
);
for (const w of plan.registry.warnings) process.stderr.write(`warning: ${w}\n`);

process.stdout.write(`-- Free the Brain registry import, generated ${new Date().toISOString()}\n`);
process.stdout.write(`-- Source: ${dir}\n`);
for (const s of plan.statements) process.stdout.write(`${toSqlText(s)}\n`);
