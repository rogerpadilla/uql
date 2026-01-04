import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Config } from '../type/index.js';

export async function loadConfig(customPath?: string): Promise<Config> {
  if (customPath) {
    const fullPath = resolve(process.cwd(), customPath);
    const exists = await stat(fullPath)
      .then(() => true)
      .catch(() => false);

    if (!exists) {
      throw new Error(`Could not find uql configuration file at ${customPath}`);
    }

    const fileUrl = pathToFileURL(fullPath).href;
    try {
      const config = await import(fileUrl);
      return config.default ?? config;
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
      const fileUrl = pathToFileURL(fullPath).href;
      const config = await import(fileUrl);
      return config.default ?? config;
    }
  }

  throw new Error(
    'Could not find uql configuration file. Create a uql.config.ts or uql.config.js file in your project root.',
  );
}
