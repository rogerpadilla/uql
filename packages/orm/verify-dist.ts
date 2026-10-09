/**
 * Pre-publish gate: every path `package.json` promises exists and is non-empty, every browser-facing
 * entry graph is free of Node builtins, no entry's declarations reach another entry's driver, every entry
 * point's declarations resolve in a project that has no ambient types and every entry runs there on each
 * runtime with no driver, and no entry exceeds its size budget.
 *
 * Runs at the end of `bun run build`, which `prepack` runs, so a stale or broken `dist/` cannot be
 * published. See CHANGELOG's "uql-orm@0.10.0 shipped only the browser bundle", "uql-orm@0.13.0
 * root import broke browser bundles" and "uql-orm@0.24.4 named `Buffer` in a public type" for the
 * incidents behind it.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

const pkgDir = import.meta.dirname;
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
const entries: string[] = Object.keys(pkg.exports).filter((entry) => entry !== './package.json');

const refusals: string[] = [];

/**
 * Records a refusal rather than exiting on it, so one failing check cannot hide the others. It used to
 * exit: a since-deleted `@types/bun` check then ran ahead of the size budgets and exited for two
 * releases, and `.` was over budget for both without a build ever saying so.
 */
function refuse(reason: string, problems: string[], hint: string): void {
  const lines = [`verify-dist: refusing to pack - ${reason}:`, ...problems.map((problem) => `  ${problem}`), '', hint];
  refusals.push(lines.join('\n'));
}

/** Exits on whatever has been recorded so far. Called once the checks that can still run have run. */
function settle(): void {
  if (refusals.length) {
    console.error(refusals.join('\n\n'));
    process.exit(1);
  }
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

  const problems: string[] = [];
  for (const relPath of paths) {
    try {
      if (statSync(join(pkgDir, relPath)).size === 0) problems.push(`EMPTY:   ${relPath}`);
    } catch {
      problems.push(`MISSING: ${relPath}`);
    }
  }

  if (problems.length) {
    refuse(
      `${paths.size} paths are declared in package.json, but`,
      problems,
      'Run `bun run build` (not just `tsc`) and retry.',
    );
  }
  return paths.size;
}

/**
 * A module's specifiers. tsc emits only statements opening a line (`import`/`export ... from`, `import '...'`)
 * and `import("...")` calls and types, so SQL quoting `from '...'` inside a string is not mistaken for one.
 */
function importsOf(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const pattern =
    /^(?:(?:import|export)\b[^;'"]*?\bfrom|import)\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/gm;
  return [...source.matchAll(pattern)].flatMap(([, statement, call]) => statement ?? call ?? []);
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
    for (const specifier of importsOf(join(pkgDir, mapped))) {
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

/** Every optional peer as a bundler or runtime names it: the declared ones, and Bun's built-ins. */
const PEERS = [...Object.keys(pkg.peerDependencies ?? {}), 'bun', 'bun:sqlite'];

/** `mysql2/promise` is the `mysql2` peer dependency, imported at a subpath. */
const packageOf = (specifier: string) =>
  specifier
    .split('/')
    .slice(0, specifier.startsWith('@') ? 2 : 1)
    .join('/');

/**
 * Each entry built on a driver or framework, and the peers it is for: `loads` it imports as it loads, so
 * a bare install cannot load it; `lazy` only its types and its use reach, so it loads bare, the "an edge
 * bundle pulls no native binaries" claim. Every other entry is for none, `d1` too: its binding is
 * structural. A map, not a set: `neon` once imported `pg` as it loaded, and a set excused it for a peer.
 */
const DRIVER_ENTRIES: Readonly<Record<string, { readonly loads?: string[]; readonly lazy?: string[] }>> = {
  './mysql': { loads: ['mysql2'] },
  './postgres': { loads: ['pg'] },
  './cockroachdb': { loads: ['pg'] },
  './mariadb': { loads: ['mariadb'] },
  './mssql': { loads: ['mssql'] },
  './mongodb': { loads: ['mongodb'] },
  './express': { loads: ['express'] },
  './nestjs': { loads: ['@nestjs/common', '@nestjs/core', 'rxjs'] },
  './neon': { loads: ['@neondatabase/serverless'] },
  './bun-sql': { loads: ['bun'] },
  './sqlite': { lazy: ['better-sqlite3'] },
  './libsql': { lazy: ['@libsql/client'] },
  './turso': { lazy: ['@tursodatabase/serverless'] },
  './turso/local': { lazy: ['@tursodatabase/database'] },
  './pglite': { lazy: ['@electric-sql/pglite'] },
  './d1': {},
};

/**
 * Each entry's declarations reach only the peers {@link DRIVER_ENTRIES} says it is for, so `uql-orm/postgres`
 * reaches `pg` and nothing reaches `mongodb` but `uql-orm/mongodb`. The tsc check below cannot tell: it has
 * to let an uninstalled peer's "Cannot find module" through, and `uql-orm@0.89.0` shipped `mongodb`'s `Db`
 * in the root's types that way.
 */
function checkPeerReach(): void {
  const leaks = new Map<string, string[]>();
  for (const entry of entries) {
    const target = pkg.exports[entry];
    const start = join(pkgDir, (typeof target === 'string' ? target : target.import).replace(/\.js$/, '.d.ts'));
    const { loads = [], lazy = [] } = DRIVER_ENTRIES[entry] ?? {};
    const isFor = new Set([...loads, ...lazy]);
    const seen = new Set<string>();
    const queue = [start];
    for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
      if (seen.has(file)) continue;
      seen.add(file);
      for (const specifier of importsOf(file)) {
        if (specifier.startsWith('.')) queue.push(resolve(file, '..', specifier.replace(/\.js$/, '.d.ts')));
        else if (!specifier.startsWith('node:') && !isFor.has(packageOf(specifier))) {
          const leak = `${relative(pkgDir, file)} imports ${specifier}`;
          leaks.set(leak, [...(leaks.get(leak) ?? []), specifierOf(entry)]);
        }
      }
    }
  }
  if (leaks.size) {
    refuse(
      "an entry's types reach a package it is not for",
      [...leaks].map(([leak, from]) => `${leak}, reached from ${from.join(', ')}`),
      'A consumer without that optional peer gets "Cannot find module" under `skipLibCheck: false`. Move the ' +
        "type to the driver's entry, or name it structurally.",
    );
  }
}

// Gzipped bytes per entry, peers external. Catches what the checks above cannot: a dev-only module
// becoming reachable from a consumer entry. Four suffice - the SQL drivers share one core, so the
// root moves with them. Deliberately per-entry and not a `dist` total: a total also counts
// declarations, so JSDoc spends it and it has to be raised for documentation alone, which is noise
// these budgets aren't. Each is the entry as measured plus 2%, rounded up to the next hundred, so
// raising one is deliberate - and the commit raising it says which module grew.
const BUDGETS: Record<string, number> = {
  // The root is decorators, types and helpers: no querier or dialect is reachable from it.
  '.': 9_400,
  './postgres': 41_200,
  './migrate': 63_300,
  './browser': 2_100,
};

async function checkSizeBudgets(): Promise<void> {
  const oversized: string[] = [];

  for (const [subpath, budget] of Object.entries(BUDGETS)) {
    const target = pkg.exports[subpath];
    const built = await Bun.build({
      entrypoints: [join(pkgDir, typeof target === 'string' ? target : target.import)],
      minify: true,
      target: 'node',
      format: 'esm',
      external: PEERS,
    });
    const output = built.outputs[0];
    if (!output) {
      // Without this the failure surfaces as `undefined.text()`, naming neither the entry nor the cause.
      refuse(`${subpath} does not bundle`, built.logs.map(String), 'Fix the entry point and retry.');
      continue;
    }
    const gzipped = Bun.gzipSync(await output.text(), { level: 9 }).length;
    if (gzipped > budget) {
      oversized.push(`${subpath}: ${gzipped} > ${budget} gzipped bytes (+${gzipped - budget})`);
    }
  }

  if (oversized.length) {
    refuse('over size budget', oversized, 'Usually a dev-only module became reachable from a consumer entry.');
  }
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
 * to hold is the case of a consumer who installed `uql-orm` and no driver, which is also where
 * {@link checkRuntimes} runs them.
 */
function checkDeclarationsStandalone(checkDir: string, installed: string): void {
  const output = typeCheck(checkDir);
  const inConsumer = consumerErrors(output, checkDir, installed);
  if (inConsumer.length) {
    refuse(
      'a consumer cannot use the published surface',
      inConsumer,
      'The entity in `entity.ts` is written the way the README says one is written. If the decorators ' +
        'now need `experimentalDecorators`, or a name moved off the root entry, that promise is broken.',
    );
  }
  const unresolved = ownUnresolvedNames(output, checkDir, installed);
  if (unresolved.length) {
    refuse(
      'the published types do not stand on their own in a consumer project',
      unresolved,
      'A public type is naming something only this repo has in scope. Prefer a structural type a consumer ' +
        'always has (`Uint8Array` over `Buffer`), or import the name instead of relying on an ambient global.',
    );
  }
}

const specifierOf = (entry: string) => (entry === '.' ? pkg.name : `${pkg.name}/${entry.slice(2)}`);

/** The runtimes the README claims, each running `smoke.mjs` in the consumer project. */
const RUNTIMES = [['node'], ['bun']];

/**
 * Each runtime loads every entry and builds a query where no optional peer is installed: `uql-orm@0.72.2`
 * failed `import 'uql-orm/migrate'` with "Cannot find package 'mongodb'", reached through the MongoDB introspector.
 */
function checkRuntimes(checkDir: string): void {
  cpSync(join(pkgDir, 'smoke.mjs'), join(checkDir, 'smoke.mjs'));
  writeFileSync(join(checkDir, 'peers.json'), JSON.stringify({ peers: PEERS, driverEntries: DRIVER_ENTRIES }));
  const broken = RUNTIMES.flatMap(([bin, ...args]) => {
    const { status, stdout, stderr, error } = spawnSync(bin, [...args, 'smoke.mjs'], {
      cwd: checkDir,
      encoding: 'utf8',
    });
    return status === 0 ? [] : [`${bin}: ${error?.message ?? (stderr || stdout).trim()}`];
  });
  if (broken.length) {
    refuse(
      'the package does not run on every runtime with no driver installed',
      broken,
      'Import driver code on use (`await import(...)`), or move what the entry needs out of the driver module.',
    );
  }
}

/**
 * Every entry loads on Node with its driver installed, as the repo has them: a driver that is CommonJS
 * exposes no named exports to an ESM import, and `uql-orm@0.99.0`'s `mssql` entry failed on that while
 * the check above, having no driver, skipped it. `bun` only exists inside Bun.
 */
function checkDriverLoads(): void {
  const files = entries
    .filter((entry) => !DRIVER_ENTRIES[entry]?.loads?.includes('bun'))
    .map((entry) => {
      const target = pkg.exports[entry];
      return join(pkgDir, typeof target === 'string' ? target : target.import);
    });
  const script = /*ts*/ `for (const file of ${JSON.stringify(files)}) {
    await import(file).catch((err) => { console.error(file + ': ' + String(err).split('\\n')[0]); process.exitCode = 1; });
  }`;
  const { status, stderr } = spawnSync('node', ['--input-type=module', '-e', script], {
    cwd: pkgDir,
    encoding: 'utf8',
  });
  if (status !== 0) {
    refuse(
      'an entry fails to load on Node with its driver installed',
      stderr.trim().split('\n'),
      "Import a CommonJS driver by its default export (`import mssql from 'mssql'`), not by named exports.",
    );
  }
}

/** The temp project the check runs in: `dist` installed as the only package, one entry file per export. */
function writeConsumerProject(): { checkDir: string; installed: string } {
  const checkDir = mkdtempSync(join(tmpdir(), 'uql-dts-'));
  const installed = join(checkDir, 'node_modules', pkg.name);

  mkdirSync(installed, { recursive: true });
  cpSync(join(pkgDir, 'dist'), join(installed, 'dist'), { recursive: true });
  writeFileSync(join(installed, 'package.json'), JSON.stringify(pkg));

  for (const [index, entry] of entries.entries()) {
    writeFileSync(join(checkDir, `entry${index}.ts`), `export * from '${specifierOf(entry)}';\n`);
  }
  // Re-exporting every entry proves the declarations resolve, but never applies one. The README
  // promises entities are "plain classes on the standard TC39 decorators: no `reflect-metadata`, no
  // `experimentalDecorators`", and the tsconfig below sets neither - so this file is that promise,
  // compiled. Without it the first thing to find out would be a consumer, or the docs build.
  writeFileSync(
    join(checkDir, 'entity.ts'),
    `import { Entity, Field, Id, ManyToOne, OneToMany } from '${pkg.name}';

@Entity()
export class Post {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) title?: string | null;
  @Field({ references: () => User }) authorId?: string | null;
  @ManyToOne({ entity: () => User, references: (post) => post.authorId }) author?: User;
}

@Entity()
export class User {
  @Id({ type: 'uuid' }) id?: string;
  @Field({ type: String }) email?: string | null;
  @OneToMany({ entity: () => Post, mappedBy: (post) => post.author }) posts?: Post[];
}
`,
  );
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
  return { checkDir, installed };
}

/** tsc's diagnostics for that project, empty when it is clean. */
function typeCheck(checkDir: string): string {
  try {
    // `cwd` pins what the reported paths are relative to, which is how they are matched against `dist`.
    execFileSync(join(pkgDir, '../../node_modules/.bin/tsc'), ['-p', checkDir], { encoding: 'utf8', cwd: checkDir });
    return '';
  } catch (error) {
    return (error as { stdout?: string }).stdout ?? '';
  }
}

/**
 * Diagnostics in the consumer's own files rather than in `dist`. {@link ownUnresolvedNames} discards
 * these deliberately - another package's declarations are that package's problem - which would also
 * discard the entity that exercises the decorators, so it is read separately.
 */
function consumerErrors(output: string, checkDir: string, installed: string): string[] {
  const problems: string[] = [];
  for (const line of output.split('\n')) {
    const match = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.+)$/.exec(line);
    if (!match) continue;
    const [, reported, row, , code, message] = match;
    const file = resolve(checkDir, reported);
    if (file.startsWith(join(installed, 'dist'))) continue;
    problems.push(`${relative(checkDir, file)}(${row}): ${code}: ${message}`);
  }
  return problems;
}

/** The diagnostics that are this package's problem: our own `dist`, minus what an absent peer explains. */
function ownUnresolvedNames(output: string, checkDir: string, installed: string): string[] {
  /** Declared optional, so a consumer who does not use that driver does not have its types either. */
  const isPeer = (specifier: string) => PEERS.includes(packageOf(specifier));
  /** A declaration file that imports a Node-only driver is Node-only, and its consumer has `@types/node`. */
  const driverBound = (file: string) => importsOf(file).some(isPeer);

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
  return unresolved;
}

// The only fatal one: the three below all read `dist`, so a missing path there makes them meaningless.
const declaredPaths = checkDeclaredPaths();
settle();

const browserModules = checkBrowserGraph();
checkPeerReach();
checkDriverLoads();
await checkSizeBudgets();
const { checkDir, installed } = writeConsumerProject();
try {
  checkDeclarationsStandalone(checkDir, installed);
  checkRuntimes(checkDir);
} finally {
  rmSync(checkDir, { recursive: true, force: true });
}
settle();

console.log(
  `verify-dist: OK (${declaredPaths} declared paths present; ${browserModules} browser-facing modules clean; ` +
    `${entries.length} entry points' types resolve with \`types: []\` and reach only the peers each is for; ` +
    `every entry loads and queries with no driver on ${RUNTIMES.map(([bin]) => bin).join(', ')}, and with its driver on node; ` +
    `${Object.keys(BUDGETS).length} entry budgets within limits)`,
);
