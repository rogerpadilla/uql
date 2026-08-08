/**
 * Pre-publish gate: every path `package.json` promises exists and is non-empty, every browser-facing
 * entry graph is free of Node builtins, every entry point's declarations resolve in a project that has
 * no ambient types, and no entry exceeds its size budget.
 *
 * Runs at the end of `bun run build` and again from `prepack`, so a stale or broken `dist/` cannot be
 * published. See CHANGELOG's "uql-orm@0.10.0 shipped only the browser bundle", "uql-orm@0.13.0
 * root import broke browser bundles" and "uql-orm@0.24.4 named `Buffer` in a public type" for the
 * incidents behind it.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

const pkgDir = import.meta.dirname;
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
const entries: string[] = Object.keys(pkg.exports).filter((entry) => entry !== './package.json');
const specifierOf = (entry: string) => (entry === '.' ? pkg.name : `${pkg.name}/${entry.slice(2)}`);
/** `mysql2/promise` is the `mysql2` peer dependency, imported at a subpath. */
const packageOf = (specifier: string) =>
  specifier
    .split('/')
    .slice(0, specifier.startsWith('@') ? 2 : 1)
    .join('/');
/** Declared optional, so a consumer who does not use that driver does not have its types either. */
const isPeer = (specifier: string) => {
  const name = packageOf(specifier);
  return name in (pkg.peerDependencies ?? {}) || name === 'bun';
};

function refuse(reason: string, problems: string[], hint: string): never {
  console.error(`verify-dist: refusing to pack - ${reason}:`);
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(`\n${hint}`);
  process.exit(1);
}

/** Every `dist` path the manifest promises a consumer, present and non-empty. */
function checkDeclaredPaths(): number {
  function collect(value: unknown, into: Set<string>): void {
    if (typeof value === 'string') {
      if (value.startsWith('./dist/')) into.add(value);
      return;
    }
    if (value && typeof value === 'object') {
      for (const nested of Object.values(value)) collect(nested, into);
    }
  }

  const paths = new Set<string>();
  for (const field of [pkg.main, pkg.types, pkg.bin, pkg.exports, pkg.browser]) collect(field, paths);

  const missing: string[] = [];
  const empty: string[] = [];
  for (const relPath of paths) {
    try {
      if (statSync(join(pkgDir, relPath)).size === 0) empty.push(relPath);
    } catch {
      missing.push(relPath);
    }
  }

  if (missing.length || empty.length) {
    refuse(
      `${paths.size} paths are declared in package.json, but`,
      [...missing.map((path) => `MISSING: ${path}`), ...empty.map((path) => `EMPTY:   ${path}`)],
      'Run `bun run build` (not just `tsc`) and retry.',
    );
  }
  return paths.size;
}

/**
 * Node-only modules must be remapped via the package.json `browser` map (like `context/context.js`),
 * which browser bundlers apply and Node ignores. A static walk suffices because tsc emits only plain
 * `import`/`export ... from` and bare side-effect `import '...'`. A bundler would not substitute: Bun
 * silently polyfills Node builtins for browser targets, passing on the exact graph that broke real
 * Vite/esbuild consumers.
 */
function checkBrowserGraph(): number {
  const browserMap: Record<string, string> = pkg.browser ?? {};
  const isBuiltin = (specifier: string) => specifier.startsWith('node:') || builtinModules.includes(specifier);
  const violations: string[] = [];
  const seen = new Set<string>();

  // `./browser` is the client entry and `./http` backs it; the root counts because frontend apps
  // import entities and types from `uql-orm` directly.
  const queue = ['./dist/index.js', './dist/browser/index.js', './dist/http/index.js'];
  for (let relPath = queue.pop(); relPath !== undefined; relPath = queue.pop()) {
    const mapped = browserMap[relPath] ?? relPath;
    if (seen.has(mapped)) continue;
    seen.add(mapped);
    const source = readFileSync(join(pkgDir, mapped), 'utf8');
    for (const [, specifier] of source.matchAll(/(?:\bfrom|\bimport\(?)\s*['"]([^'"]+)['"]/g)) {
      if (specifier === undefined) continue;
      if (isBuiltin(specifier)) violations.push(`${mapped} imports ${specifier}`);
      else if (specifier.startsWith('.')) queue.push(`./${join(mapped, '..', specifier).replace(/\\/g, '/')}`);
      // bare specifiers (real deps) are the consumer bundler's concern, not a Node-builtin leak
    }
  }

  if (violations.length) {
    refuse(
      'a browser-facing entrypoint is no longer browser-safe',
      violations,
      'Remap Node-only modules via the package.json `browser` field and retry.',
    );
  }
  return seen.size;
}

// Gzipped bytes per entry, peers external. Catches what the checks above cannot: a dev-only module
// becoming reachable from a consumer entry, which leaves the `dist` total unchanged. Four suffice -
// the SQL drivers share one core, so the root moves with them.
// `.` and `./postgres` carry ~+500 each for read-side decoding; see the CHANGELOG entry for it.
const BUDGETS: Record<string, number> = {
  '.': 25_200,
  './postgres': 20_700,
  './migrate': 43_000,
  './browser': 1_700,
};
// Raw bytes of everything in `dist`, comments included: `tsc` keeps them in the emitted `.js` as well as
// the `.d.ts`, so prose spends this budget as readily as code does, and a raise for documentation is
// expected. (`removeComments` is not the answer - it strips the `.d.ts` JSDoc too, taking every consumer's
// editor hover with it, which measured a 35% smaller `dist` and was still not worth it.) A *per-entry*
// gzipped budget moving is the signal that matters: that is the leaked-module case they exist to catch.
const DIST_BYTES_BUDGET = 1_100_000;

async function checkSizeBudgets(): Promise<number> {
  function totalBytes(dir: string): number {
    let bytes = 0;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      bytes += entry.isDirectory() ? totalBytes(path) : statSync(path).size;
    }
    return bytes;
  }

  const external = [...Object.keys(pkg.peerDependencies ?? {}), 'bun', 'bun:sqlite'];
  const oversized: string[] = [];
  const distBytes = totalBytes(join(pkgDir, 'dist'));
  if (distBytes > DIST_BYTES_BUDGET) {
    oversized.push(`dist/ total: ${distBytes} > ${DIST_BYTES_BUDGET} bytes`);
  }

  for (const [subpath, budget] of Object.entries(BUDGETS)) {
    const target = pkg.exports[subpath];
    const built = await Bun.build({
      entrypoints: [join(pkgDir, typeof target === 'string' ? target : target.import)],
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
  return distBytes;
}

/**
 * Every entry point's declarations, checked the way a consumer's project sees them: `types: []`, so no
 * ambient globals, and `skipLibCheck: false`, so a name our own `.d.ts` cannot resolve is reported where
 * it is written. This repo's tsconfig has `types: ["@types/bun"]`, which puts `Buffer` and the rest in
 * scope everywhere and makes this class of bug invisible until a consumer hits it: `uql-orm@0.24.4`
 * named `Buffer` in a public union, that union collapsed to `any` in any project without `@types/node`,
 * and `FieldKey` silently stopped checking field names for every browser consumer.
 *
 * `dist` is copied to a directory of its own because `types: []` alone is not enough here: every driver
 * is a dev dependency of this repo, and `mongodb`'s or `better-sqlite3`'s declarations pull `@types/node`
 * into the program, which puts `Buffer` back in scope and hides the very thing being looked for. What has
 * to hold is the case of a consumer who installed `uql-orm` and no driver.
 */
function checkDeclarationsStandalone(): void {
  const checkDir = mkdtempSync(join(tmpdir(), 'uql-dts-'));
  const installed = join(checkDir, 'node_modules', pkg.name);
  mkdirSync(installed, { recursive: true });
  cpSync(join(pkgDir, 'dist'), join(installed, 'dist'), { recursive: true });
  writeFileSync(join(installed, 'package.json'), JSON.stringify(pkg));

  for (const [index, entry] of entries.entries()) {
    writeFileSync(join(checkDir, `entry${index}.ts`), `export * from '${specifierOf(entry)}';\n`);
  }
  writeFileSync(
    join(checkDir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'es2025',
        // What a browser consumer has, and no more.
        lib: ['esnext', 'dom'],
        module: 'preserve',
        moduleResolution: 'bundler',
        strict: true,
        skipLibCheck: false,
        noEmit: true,
        types: [],
      },
      include: ['*.ts'],
    }),
  );

  let output = '';
  try {
    // `cwd` pins what the reported paths are relative to, which is how they are matched against `dist`.
    execFileSync(join(pkgDir, '../../node_modules/.bin/tsc'), ['-p', checkDir], { encoding: 'utf8', cwd: checkDir });
  } catch (error) {
    output = (error as { stdout?: string }).stdout ?? '';
  }

  /** A declaration file that imports a Node-only driver is Node-only, and its consumer has `@types/node`. */
  const driverBound = (file: string) =>
    [...readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)].some(([, specifier]) => isPeer(specifier));

  const unresolved: string[] = [];
  for (const line of output.split('\n')) {
    const match = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.+)$/.exec(line);
    if (!match) continue;
    const [, reported, row, , code, message] = match;
    const file = resolve(checkDir, reported);
    // Another package's declarations are that package's problem, not ours.
    if (!file.startsWith(join(installed, 'dist'))) continue;
    // An uninstalled optional peer, which is the expected state for a consumer who does not use it.
    if (code === 'TS2307') continue;
    if (code === 'TS2591' && driverBound(file)) continue;
    unresolved.push(`${relative(installed, file)}(${row}): ${code}: ${message}`);
  }

  rmSync(checkDir, { recursive: true, force: true });

  if (unresolved.length) {
    refuse(
      'the published types do not stand on their own in a consumer project',
      unresolved,
      'A public type is naming something only this repo has in scope. Prefer a structural type a consumer ' +
        'always has (`Uint8Array` over `Buffer`), or import the name instead of relying on an ambient global.',
    );
  }
}

const declaredPaths = checkDeclaredPaths();
const browserModules = checkBrowserGraph();
const distBytes = await checkSizeBudgets();
checkDeclarationsStandalone();

console.log(
  `verify-dist: OK (${declaredPaths} declared paths present; ${browserModules} browser-facing modules clean; ` +
    `${entries.length} entry points' types resolve with \`types: []\`; ` +
    `dist ${Math.round(distBytes / 1024)} KB and ${Object.keys(BUDGETS).length} entry budgets within limits)`,
);
