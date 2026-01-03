import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Dialect, NamingStrategy, QuerierPool } from '../type/index.js';

export interface CliConfig {
  pool?: QuerierPool;
  migrationsPath?: string;
  tableName?: string;
  dialect?: Dialect;
  entities?: unknown[];
  namingStrategy?: NamingStrategy;
}

export async function loadConfig(): Promise<CliConfig> {
  const configPaths = ['uql.config.ts', 'uql.config.js', 'uql.config.mjs', '.uqlrc.ts', '.uqlrc.js'];

  for (const configPath of configPaths) {
    const fullPath = resolve(process.cwd(), configPath);
    const fileUrl = pathToFileURL(fullPath).href;
    const config = await import(fileUrl).catch(() => undefined);
    if (config) {
      return config.default ?? config;
    }
  }

  throw new Error(
    'Could not find uql configuration file. ' + 'Create a uql.config.ts or uql.config.js file in your project root.',
  );
}
