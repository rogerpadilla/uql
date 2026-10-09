import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { onTestFinished } from 'vitest';

/**
 * Write TypeScript source to a temp file and load its default export.
 *
 * Mirrors how {@link Migrator.loadMigration} reaches a user's migration: a plain `import()`, left to
 * whatever runtime is running. `vitest.config.ts` externalizes the temp dir so this run's esbuild
 * plugin stays out of the way, which makes the loader Node's own type stripping. That is the strictest
 * runtime uql supports and the one worth testing against; bun accepts syntax plain `node` rejects.
 */
export async function loadTsDefaultExport<T>(source: string): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'uql-ts-'));
  // `.mts`, not `.ts`: a temp dir carries no `package.json`, so a bare `.ts` is treated as CJS and the
  // default export arrives double-wrapped as `mod.default.default`.
  const filePath = join(dir, 'module.mts');
  await writeFile(filePath, source, 'utf8');
  try {
    const mod = (await import(pathToFileURL(filePath).href)) as { default: T };
    return mod.default;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** A migrations directory of the running test's own, removed when it finishes. */
export async function migrationsDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'uql-migrations-'));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** This checkout's `uql-orm` entry: a migration in a temp dir imports it, since it cannot resolve the package by name. */
export const UQL_ORM_SOURCE = fileURLToPath(new URL('../index.ts', import.meta.url));

/** `source` importing `uql-orm` from {@link UQL_ORM_SOURCE}. */
function importingUqlOrmSource(source: string): string {
  return source.replaceAll("from 'uql-orm'", `from ${JSON.stringify(UQL_ORM_SOURCE)}`);
}

/** Points the `uql-orm` import of the migration file at `path` at {@link UQL_ORM_SOURCE}; `''`, none generated, is left. */
export async function linkUqlOrmSource(path: string): Promise<void> {
  if (path) {
    await writeFile(path, importingUqlOrmSource(await readFile(path, 'utf8')));
  }
}

/**
 * Loads a migration's `source` through this run's transform, its `uql-orm` imports read from
 * {@link UQL_ORM_SOURCE}: plain node can load neither that nor the package from a temp dir.
 */
export async function loadMigrationSource<T>(source: string): Promise<T> {
  const filePath = join(await migrationsDir(), 'module.mts');
  await writeFile(filePath, importingUqlOrmSource(source), 'utf8');
  const mod = (await import(pathToFileURL(filePath).href)) as { default: T };
  return mod.default;
}
