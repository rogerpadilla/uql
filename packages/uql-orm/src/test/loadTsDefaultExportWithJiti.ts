import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJiti } from 'jiti';

/**
 * Write TypeScript source to a temp file and load its default export via jiti.
 *
 * Use in tests to mirror how `uql-migrate` loads `.ts` migrations. At runtime, the migrator loads
 * on-disk files with native `import()`; this helper matches CLI-style jiti resolution for generated strings.
 */
export async function loadTsDefaultExportWithJiti<T>(source: string, uqlOrmPackageRoot: string): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'uql-jiti-'));
  const filePath = join(dir, 'module.ts');
  await writeFile(filePath, source, 'utf8');
  try {
    const jiti = createJiti(uqlOrmPackageRoot);
    return (await jiti.import(filePath, { default: true })) as T;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
