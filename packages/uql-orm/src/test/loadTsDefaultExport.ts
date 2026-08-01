import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Write TypeScript source to a temp file and load its default export.
 *
 * Use in tests to check that generated `.ts` actually runs. The file lands outside the project, so
 * the test runner's own transform cannot reach it; `tsx` (a devDependency here, never a peer) supplies
 * the transpile that a real user's runtime would.
 */
export async function loadTsDefaultExport<T>(source: string): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'uql-ts-'));
  // `.mts`, not `.ts`: a temp dir carries no `package.json`, so a bare `.ts` is treated as CJS and the
  // default export arrives double-wrapped as `mod.default.default`.
  const filePath = join(dir, 'module.mts');
  await writeFile(filePath, source, 'utf8');
  try {
    const { tsImport } = await import('tsx/esm/api');
    const mod = (await tsImport(pathToFileURL(filePath).href, import.meta.url)) as { default: T };
    return mod.default;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
