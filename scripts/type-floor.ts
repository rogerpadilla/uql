/**
 * The oldest TypeScript a consuming project can compile `dist` with, library checks on: the version the docs
 * and the skill state. Below it the declarations fail (`Uint8Array<...>` is generic from 5.7). Build first.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $ } from 'bun';
import { writeFixture } from './typeFixture.js';

const MIN_TYPESCRIPT = '5.7';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const built = resolve(root, 'packages/orm/dist/index.d.ts');

if (!(await Bun.file(built).exists())) {
  throw new Error(`no declarations at ${built} - run 'bun run build' first.`);
}

const dir = mkdtempSync(resolve(tmpdir(), 'uql-type-floor-'));
try {
  writeFixture(dir, built, 1, { target: 'es2022', skipLibCheck: false });
  const out = await $`bunx -p typescript@${MIN_TYPESCRIPT} tsc -p ${dir}`.nothrow().text();
  const errors = out.split('\n').filter((line) => line.includes('error TS'));
  if (errors.length) {
    console.error(`TypeScript ${MIN_TYPESCRIPT} does not compile a project using uql-orm:\n${errors.join('\n')}`);
    process.exit(1);
  }
  console.log(`type-floor: TypeScript ${MIN_TYPESCRIPT} compiles a project using uql-orm, library checks on.`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
