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
// becoming reachable from a consumer entry. Four suffice - the SQL drivers share one core, so the
// root moves with them. Deliberately per-entry and not a `dist` total: a total also counts
// declarations, so JSDoc spends it and it has to be raised for documentation alone, which is noise
// these budgets aren't. Each is the entry as measured plus 2%, rounded up to the next hundred, so
// raising one is deliberate - and the CHANGELOG entry for that release says which module grew.
const BUDGETS: Record<string, number> = {
  '.': 27_300,
  './postgres': 24_500,
  './migrate': 48_200,
  './browser': 2_000,
};

async function checkSizeBudgets(): Promise<void> {
  const external = [...Object.keys(pkg.peerDependencies ?? {}), 'bun', 'bun:sqlite'];
  const oversized: string[] = [];

  for (const [subpath, budget] of Object.entries(BUDGETS)) {
    const target = pkg.exports[subpath];
    const built = await Bun.build({
      entrypoints: [join(pkgDir, typeof target === 'string' ? target : target.import)],
      minify: true,
      target: 'node',
      format: 'esm',
      external,
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
 * to hold is the case of a consumer who installed `uql-orm` and no driver.
 */
function checkDeclarationsStandalone(): void {
  const { checkDir, installed } = writeConsumerProject();
  try {
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
  } finally {
    rmSync(checkDir, { recursive: true, force: true });
  }
}

/** The temp project the check runs in: `dist` installed as the only package, one entry file per export. */
function writeConsumerProject(): { checkDir: string; installed: string } {
  const specifierOf = (entry: string) => (entry === '.' ? pkg.name : `${pkg.name}/${entry.slice(2)}`);
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
  @Field({ type: String }) title?: string;
  @ManyToOne({ entity: () => User }) author?: User;
}

@Entity()
export class User {
  @Id({ type: 'uuid' }) id?: string;
  @Field({ type: String }) email?: string;
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

/** The diagnostics that are this package's problem: our own `dist`, minus what an absent peer explains. */
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

function ownUnresolvedNames(output: string, checkDir: string, installed: string): string[] {
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
  return unresolved;
}

// The only fatal one: the three below all read `dist`, so a missing path there makes them meaningless.
const declaredPaths = checkDeclaredPaths();
settle();

const browserModules = checkBrowserGraph();
await checkSizeBudgets();
checkDeclarationsStandalone();
settle();

console.log(
  `verify-dist: OK (${declaredPaths} declared paths present; ${browserModules} browser-facing modules clean; ` +
    `${entries.length} entry points' types resolve with \`types: []\`; ` +
    `${Object.keys(BUDGETS).length} entry budgets within limits)`,
);
