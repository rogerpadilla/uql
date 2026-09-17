import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

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
