import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createJiti } from 'jiti';
import type { Config } from '../type/index.js';

export async function loadConfig(customPath?: string): Promise<Config> {
  const jiti = createJiti(process.cwd());

  if (customPath) {
    const fullPath = resolve(process.cwd(), customPath);
    const exists = await stat(fullPath)
      .then(() => true)
      .catch(() => false);

    if (!exists) {
      throw new Error(`Could not find uql configuration file at ${customPath}`);
    }

    try {
      const config = await jiti.import(fullPath, { default: true });
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
      const config = await jiti.import(fullPath, { default: true });
      return config as Config;
    }
  }

  throw new Error(
    'Could not find uql configuration file. Create a uql.config.ts or uql.config.js file in your project root.',
  );
}
