/**
 * Verifies every file `package.json` promises to consumers (main, types, bin,
 * and every "exports" entry) actually exists and is non-empty in `dist/`.
 *
 * Run as part of `prepack` so a partial build (e.g. from a stale
 * `tsc -b` incremental cache) can never be packed and published — see
 * CHANGELOG.md's "uql-orm@0.10.0 shipped only the browser bundle" entry for
 * the incident this guards against.
 */

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const pkgDir = import.meta.dirname;
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));

function collectPaths(value: unknown, into: Set<string>): void {
  if (typeof value === 'string') {
    if (value.startsWith('./dist/')) into.add(value);
    return;
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) collectPaths(v, into);
  }
}

const paths = new Set<string>();
collectPaths(pkg.main, paths);
collectPaths(pkg.types, paths);
collectPaths(pkg.bin, paths);
collectPaths(pkg.exports, paths);

const missing: string[] = [];
const empty: string[] = [];
for (const relPath of paths) {
  const absPath = join(pkgDir, relPath);
  try {
    const stat = statSync(absPath);
    if (stat.size === 0) empty.push(relPath);
  } catch {
    missing.push(relPath);
  }
}

if (missing.length || empty.length) {
  console.error(`verify-dist: refusing to pack — ${paths.size} paths declared in package.json, but:`);
  for (const p of missing) console.error(`  MISSING: ${p}`);
  for (const p of empty) console.error(`  EMPTY:   ${p}`);
  console.error('\nRun `bun run build` (not just `tsc`) and retry.');
  process.exit(1);
}

console.log(`verify-dist: OK (${paths.size} declared paths present in dist/)`);
