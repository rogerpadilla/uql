import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Config } from '../type/index.js';

/** `jiti` (1.8 MB) makes `uql.config.ts` loadable; imported here so only projects with one pay for it. */
async function importConfig(path: string): Promise<unknown> {
  const { createJiti } = await import('jiti').catch(() => {
    throw new Error(
      "Loading a uql config file requires 'jiti'. Run `npm i -D jiti`, or pass the config inline instead of via a config file.",
    );
  });
  return createJiti(process.cwd()).import(path, { default: true });
}

export async function loadConfig(customPath?: string): Promise<Config> {
  if (customPath) {
    const fullPath = resolve(process.cwd(), customPath);
    const exists = await stat(fullPath)
      .then(() => true)
      .catch(() => false);

    if (!exists) {
      throw new Error(`Could not find uql configuration file at ${customPath}`);
    }

    try {
      const config = await importConfig(fullPath);
      return config as Config;
    } catch (error) {
      throw new Error(`Could not load configuration file at ${customPath}: ${(error as Error).message}`);
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

  throw new Error(
    'Could not find uql configuration file. Create a uql.config.ts or uql.config.js file in your project root.',
  );
}
