import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Config } from '../type/index.js';

/**
 * Loads the config with a plain `import()`, leaving TypeScript to whatever runs the CLI.
 *
 * @remarks uql deliberately bundles no transpiler. The config imports the entity classes, so whoever
 * loads it decides which decorator spec their decorators are invoked with, and only the runtime knows
 * the project's `tsconfig.json`. Bun and `node --import tsx` both get it right; a bundled loader would
 * be guessing, and `jiti` guessed wrong (it hardcodes the legacy transform, so standard decorators were
 * called as `(prototype, key)` and every field was silently dropped).
 *
 * Node's own type stripping covers a config that is only types plus a plain object, which is why the
 * error below distinguishes the two cases: decorators are not erasable syntax, so a config that reaches
 * decorated entity classes needs a runtime that actually transforms them.
 */
async function importConfig(path: string): Promise<unknown> {
  const mod = (await import(pathToFileURL(path).href).catch((cause: unknown) => {
    throw new TypeError(
      `Could not import ${path}: ${(cause as Error)?.message}\n` +
        'If it reaches entity classes, their decorators need a runtime that transforms TypeScript, not ' +
        'just one that strips its types. Run the CLI with `bun`, or with `node --import tsx` ' +
        '(`npm i -D tsx`). A JavaScript config, or passing the config inline, needs neither.',
      { cause },
    );
  })) as { default?: unknown };
  return mod.default ?? mod;
}

export async function loadConfig(customPath?: string): Promise<Config> {
  if (customPath) {
    const fullPath = resolve(process.cwd(), customPath);
    const exists = await stat(fullPath)
      .then(() => true)
      .catch(() => false);

    if (!exists) {
      throw new TypeError(`Could not find uql configuration file at ${customPath}`);
    }

    try {
      const config = await importConfig(fullPath);
      return config as Config;
    } catch (error) {
      throw new TypeError(`Could not load configuration file at ${customPath}: ${(error as Error).message}`);
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

  throw new TypeError(
    'Could not find uql configuration file. Create a uql.config.ts or uql.config.js file in your project root.',
  );
}
