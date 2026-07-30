/**
 * Pre-publish gate: every path `package.json` promises exists and is non-empty, every browser-facing
 * entry graph is free of Node builtins, and no entry exceeds its size budget.
 *
 * Runs at the end of `bun run build` and again from `prepack`, so a stale or broken `dist/` cannot be
 * published. See CHANGELOG's "uql-orm@0.10.0 shipped only the browser bundle" and "uql-orm@0.13.0
 * root import broke browser bundles" for the incidents behind it.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join } from 'node:path';

const pkgDir = import.meta.dirname;
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));

function refuse(reason: string, problems: string[], hint: string): never {
  console.error(`verify-dist: refusing to pack - ${reason}:`);
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(`\n${hint}`);
  process.exit(1);
}

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
  refuse(
    `${paths.size} paths are declared in package.json, but`,
    [...missing.map((p) => `MISSING: ${p}`), ...empty.map((p) => `EMPTY:   ${p}`)],
    'Run `bun run build` (not just `tsc`) and retry.',
  );
}

// Node-only modules must be remapped via the package.json `browser` map (like `context/context.js`),
// which browser bundlers apply and Node ignores. A static walk suffices because tsc emits only plain
// `import`/`export ... from` and bare side-effect `import '...'`. A bundler would not substitute: Bun
// silently polyfills Node builtins for
// browser targets, passing on the exact graph that broke real Vite/esbuild consumers.
const browserMap: Record<string, string> = pkg.browser ?? {};
const isBuiltin = (specifier: string) => specifier.startsWith('node:') || builtinModules.includes(specifier);
const violations: string[] = [];
const seen = new Set<string>();

function walkForBuiltins(entry: string): void {
  const queue = [entry];
  for (let relPath = queue.pop(); relPath !== undefined; relPath = queue.pop()) {
    const mapped = browserMap[relPath] ?? relPath;
    if (seen.has(mapped)) continue;
    seen.add(mapped);
    const source = readFileSync(join(pkgDir, mapped), 'utf8');
    for (const [, specifier] of source.matchAll(/(?:\bfrom|\bimport\(?)\s*['"]([^'"]+)['"]/g)) {
      if (specifier === undefined) continue;
      if (isBuiltin(specifier)) {
        violations.push(`${mapped} imports ${specifier}`);
      } else if (specifier.startsWith('.')) {
        queue.push(`./${join(mapped, '..', specifier).replace(/\\/g, '/')}`);
      }
      // bare specifiers (real deps) are the consumer bundler's concern, not a Node-builtin leak
    }
  }
}

// `./browser` is the client entry and `./http` backs it; the root counts because frontend apps
// import entities and types from `uql-orm` directly.
for (const entry of ['./dist/index.js', './dist/browser/index.js', './dist/http/index.js']) {
  walkForBuiltins(entry);
}

if (violations.length) {
  refuse(
    'a browser-facing entrypoint is no longer browser-safe',
    violations,
    'Remap Node-only modules via the package.json `browser` field and retry.',
  );
}

// Gzipped bytes per entry, peers external. Catches what the checks above cannot: a dev-only module
// becoming reachable from a consumer entry, which leaves the `dist` total unchanged. Four suffice -
// the SQL drivers share one core, so the root moves with them.
const BUDGETS: Record<string, number> = {
  '.': 23_800,
  './postgres': 19_300,
  './migrate': 43_000,
  './browser': 1_700,
};
const DIST_BYTES_BUDGET = 1_040_000;

const external = [...Object.keys(pkg.peerDependencies ?? {}), 'bun', 'bun:sqlite'];
const oversized: string[] = [];

function totalBytes(dir: string): number {
  let bytes = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    bytes += entry.isDirectory() ? totalBytes(path) : statSync(path).size;
  }
  return bytes;
}

const distBytes = totalBytes(join(pkgDir, 'dist'));
if (distBytes > DIST_BYTES_BUDGET) {
  oversized.push(`dist/ total: ${distBytes} > ${DIST_BYTES_BUDGET} bytes`);
}

for (const [subpath, budget] of Object.entries(BUDGETS)) {
  const target = pkg.exports[subpath];
  const entry = typeof target === 'string' ? target : target.import;
  const built = await Bun.build({
    entrypoints: [join(pkgDir, entry)],
    minify: true,
    target: 'node',
    format: 'esm',
    external,
  });
  const gzipped = Bun.gzipSync(await built.outputs[0].text(), { level: 9 }).length;
  if (gzipped > budget) {
    oversized.push(`${subpath}: ${gzipped} > ${budget} gzipped bytes (+${gzipped - budget})`);
  }
}

if (oversized.length) {
  refuse('over size budget', oversized, 'Usually a dev-only module became reachable from a consumer entry.');
}

console.log(
  `verify-dist: OK (${paths.size} declared paths present; ${seen.size} browser-facing modules clean; ` +
    `dist ${Math.round(distBytes / 1024)} KB and ${Object.keys(BUDGETS).length} entry budgets within limits)`,
);
