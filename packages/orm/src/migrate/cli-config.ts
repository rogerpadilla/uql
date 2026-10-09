import { stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Config } from '../type/index.js';
import { UqlUsageError } from '../util/uqlError.js';

type ConfigModule = { default?: unknown };

type TsxApi = { register(): unknown };

/**
 * The project's own `tsx/esm/api` where Node must load a TypeScript config: Node's type stripping runs
 * no decorators, and Bun and Deno transform them natively. uql bundles no transpiler, so the project's
 * loader reads the project's `tsconfig.json`. Registered for the process, never imported through: an
 * import of its own would load the config's `uql-orm` apart from the CLI's, whose objects the other misreads.
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
    ? import(pathToFileURL(tsxApi).href).then((api: TsxApi) => {
        api.register();
        return import(url);
      })
    : import(url);
  const mod = await loading.catch((cause: unknown) => {
    throw importFailure(path, cause, process.versions, tsxApi);
  });
  return mod.default ?? mod;
}

/**
 * Why `path` failed to import. Only plain Node, which strips types without running decorators, can fail on
 * those, so only there does it point at a runtime that runs them: Bun, Deno, or the project's tsx.
 */
export function importFailure(
  path: string,
  cause: unknown,
  versions: { bun?: string; deno?: string },
  tsxApi: string | undefined,
): UqlUsageError {
  const message = cause instanceof Error ? cause.message : String(cause);
  const hint =
    tsxApi || versions.bun || versions.deno
      ? ''
      : '\nIf it reaches entity classes, their decorators need a runtime that transforms TypeScript, not ' +
        'just one that strips its types. Run the CLI with `bun`, or install tsx (`npm i -D tsx`), which the ' +
        'CLI uses when it finds one. See https://uql-orm.dev/migrations#running-the-cli';
  return new UqlUsageError(`Could not import ${path}: ${message}${hint}`, { cause });
}

/** Where the CLI looks for its config, in order, when it is given no path. */
const CONFIG_FILES = ['uql.config.ts', 'uql.config.js', 'uql.config.mjs', '.uqlrc.ts', '.uqlrc.js'];

/** The config at `customPath`, or the first of {@link CONFIG_FILES} in the working directory; the CLI validates it. */
export async function loadConfig(customPath?: string): Promise<Config> {
  for (const candidate of customPath ? [customPath] : CONFIG_FILES) {
    const fullPath = resolve(process.cwd(), candidate);
    const found = await stat(fullPath).then(
      () => true,
      () => false,
    );
    if (found) {
      return (await importConfig(fullPath)) as Config;
    }
  }
  throw new UqlUsageError(
    customPath
      ? `Could not find uql configuration file at ${customPath}`
      : 'Could not find uql configuration file. Create a uql.config.ts or uql.config.js file in your project root.',
  );
}
