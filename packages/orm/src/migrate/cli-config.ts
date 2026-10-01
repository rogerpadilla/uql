import { stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Config } from '../type/index.js';
import { UqlUsageError } from '../util/uqlError.js';

type ConfigModule = { default?: unknown };

type TsxApi = { tsImport(specifier: string, parentURL: string): Promise<ConfigModule> };

/**
 * The project's own `tsx/esm/api` where Node must load a TypeScript config: Node's type stripping runs
 * no decorators, and Bun and Deno transform them natively. uql bundles no transpiler, so the project's
 * loader reads the project's `tsconfig.json`.
 */
export function tsxApiFor(path: string, versions: { bun?: string; deno?: string }): string | undefined {
  if (!/\.[mc]?ts$/.test(path) || versions.bun || versions.deno) {
    return undefined;
  }
  try {
    return createRequire(path).resolve('tsx/esm/api');
  } catch {
    return undefined;
  }
}

async function importConfig(path: string): Promise<unknown> {
  const url = pathToFileURL(path).href;
  const tsxApi = tsxApiFor(path, process.versions);
  const loading: Promise<ConfigModule> = tsxApi
    ? import(pathToFileURL(tsxApi).href).then((api: TsxApi) => api.tsImport(url, import.meta.url))
    : import(url);
  const mod = await loading.catch((cause: unknown) => {
    throw new UqlUsageError(
      `Could not import ${path}: ${(cause as Error)?.message}\n` +
        'If it reaches entity classes, their decorators need a runtime that transforms TypeScript, not ' +
        'just one that strips its types. Run the CLI with `bun`, or install tsx (`npm i -D tsx`), which the ' +
        'CLI uses when it finds one. See https://uql-orm.dev/migrations#running-the-cli',
      { cause },
    );
  });
  return mod.default ?? mod;
}

export async function loadConfig(customPath?: string): Promise<Config> {
  if (customPath) {
    const fullPath = resolve(process.cwd(), customPath);
    const exists = await stat(fullPath)
      .then(() => true)
      .catch(() => false);

    if (!exists) {
      throw new UqlUsageError(`Could not find uql configuration file at ${customPath}`);
    }

    try {
      const config = await importConfig(fullPath);
      return config as Config;
    } catch (error) {
      throw new UqlUsageError(`Could not load configuration file at ${customPath}: ${(error as Error).message}`);
    }
  }

  const configPaths = ['uql.config.ts', 'uql.config.js', 'uql.config.mjs', '.uqlrc.ts', '.uqlrc.js'];

  for (const configPath of configPaths) {
    const fullPath = resolve(process.cwd(), configPath);
    const exists = await stat(fullPath)
      .then(() => true)
      .catch(() => false);

    if (exists) {
      const config = await importConfig(fullPath);
      return config as Config;
    }
  }

  throw new UqlUsageError(
    'Could not find uql configuration file. Create a uql.config.ts or uql.config.js file in your project root.',
  );
}
