import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from './cli-config.js';

describe('cli-config', () => {
  const configPath = path.resolve(process.cwd(), 'uql.config.js');

  afterEach(async () => {
    try {
      await fs.unlink(configPath);
    } catch {}
  });

  it('loadConfig should load config from uql.config.js', async () => {
    const configContent = 'export default { pool: { dialect: "sqlite" } }';
    await fs.writeFile(configPath, configContent);
    const config = await loadConfig();
    expect(config.pool.dialect).toBe('sqlite');
  });

  it('loadConfig should load TypeScript config using jiti', async () => {
    const tsConfigPath = path.resolve(process.cwd(), 'uql.config.ts');
    const configContent = /** ts */ `
      export default {
        pool: { dialect: "postgres" },
        entities: []
      } satisfies any; // dummy type check
    `;
    try {
      await fs.writeFile(tsConfigPath, configContent);
      const config = await loadConfig();
      expect(config.pool.dialect).toBe('postgres');
    } finally {
      await fs.unlink(tsConfigPath).catch(() => {});
    }
  });

  it('loadConfig should load config from custom path', async () => {
    const customConfigPath = path.resolve(process.cwd(), 'custom-uql.config.js');
    const configContent = 'export default { pool: { dialect: "mysql" } }';
    try {
      await fs.writeFile(customConfigPath, configContent);
      const config = await loadConfig('custom-uql.config.js');
      expect(config.pool.dialect).toBe('mysql');
    } finally {
      await fs.unlink(customConfigPath).catch(() => {});
    }
  });

  it('loadConfig should throw if no config found', async () => {
    // Ensure no config file exists
    const configFiles = ['uql.config.ts', 'uql.config.js', 'uql.config.mjs', '.uqlrc.ts', '.uqlrc.js'];
    for (const file of configFiles) {
      try {
        await fs.unlink(path.resolve(process.cwd(), file));
      } catch {}
    }

    await expect(loadConfig()).rejects.toThrow('Could not find uql configuration file');
  });

  it('loadConfig should throw if custom config path not found', async () => {
    await expect(loadConfig('non-existent.config.js')).rejects.toThrow(
      'Could not find uql configuration file at non-existent.config.js',
    );
  });
});
