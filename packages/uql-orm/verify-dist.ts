/**
 * Verifies every file `package.json` promises to consumers (main, types, bin,
 * and every "exports"/"browser" entry) actually exists and is non-empty in
 * `dist/`, and that the root import graph stays browser-safe.
 *
 * Run as part of `prepack` so a broken package can never be packed and
 * published - see CHANGELOG.md's "uql-orm@0.10.0 shipped only the browser
 * bundle" and "uql-orm@0.13.0 root import broke browser bundles" entries for
 * the incidents this guards against. Run `bun run verify.package` to check
 * locally (builds first, then verifies).
 */

import { readFileSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
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
collectPaths(pkg.browser, paths);

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
  console.error(`verify-dist: refusing to pack - ${paths.size} paths declared in package.json, but:`);
  for (const p of missing) console.error(`  MISSING: ${p}`);
  for (const p of empty) console.error(`  EMPTY:   ${p}`);
  console.error('\nRun `bun run build` (not just `tsc`) and retry.');
  process.exit(1);
}

// The root entrypoint must stay bundleable for the browser: frontend apps import entities/types
// from `uql-orm` directly, so a Node-only builtin anywhere in the root graph breaks their build
// (see CHANGELOG's "uql-orm@0.13.0 root import broke browser bundles" entry). Node-only modules
// must be remapped via the package.json `browser` map (like `context/context.js`), which browser
// bundlers (esbuild, Vite, webpack, Bun) apply while Node ignores it. Checked with a static walk
// of the dist import graph: tsc emits only plain static `import`/`export ... from` statements, so
// the invariant ("no Node builtin reachable from the root after applying the browser map") is
// fully decidable here without a bundler dependency. Bundler exit codes are not a substitute -
// Bun silently polyfills Node builtins for browser targets (verified: it passes on the exact
// graph that broke real Vite/esbuild consumers).
const browserMap: Record<string, string> = pkg.browser ?? {};
const isBuiltin = (specifier: string) => specifier.startsWith('node:') || builtinModules.includes(specifier);
const violations: string[] = [];
const seen = new Set<string>();
const queue = ['./dist/index.js'];
while (queue.length) {
  const relPath = queue.pop()!;
  const mapped = browserMap[relPath] ?? relPath;
  if (seen.has(mapped)) continue;
  seen.add(mapped);
  const source = readFileSync(join(pkgDir, mapped), 'utf8');
  for (const match of source.matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)) {
    const specifier = match[1]!;
    if (isBuiltin(specifier)) {
      violations.push(`${mapped} imports ${specifier}`);
    } else if (specifier.startsWith('.')) {
      queue.push(`./${join(mapped, '..', specifier).replace(/\\/g, '/')}`);
    }
    // bare specifiers (real deps) are the consumer bundler's concern, not a Node-builtin leak
  }
}

if (violations.length) {
  console.error('verify-dist: refusing to pack - the root entrypoint is no longer browser-safe:');
  for (const v of violations) console.error(`  ${v}`);
  console.error('\nRemap Node-only modules via the package.json `browser` field and retry.');
  process.exit(1);
}

console.log(
  `verify-dist: OK (${paths.size} declared paths present in dist/; root graph browser-safe across ${seen.size} modules)`,
);
