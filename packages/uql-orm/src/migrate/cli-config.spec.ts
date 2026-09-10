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
    const configContent = 'export default { pool: { dialect: { dialectName: "sqlite" } } }';
    await fs.writeFile(configPath, configContent);
    const config = await loadConfig();
    expect(config.pool.dialect.dialectName).toBe('sqlite');
  });

  it('loadConfig should load a TypeScript config when the runtime can transpile it', async () => {
    const tsConfigPath = path.resolve(process.cwd(), 'uql.config.ts');
    const configContent = /** ts */ `
      export default {
        pool: { dialect: { dialectName: "postgres" } },
        entities: []
      } satisfies any; // dummy type check
    `;
    try {
      await fs.writeFile(tsConfigPath, configContent);
      const config = await loadConfig();
      expect(config.pool.dialect.dialectName).toBe('postgres');
    } finally {
      await fs.unlink(tsConfigPath).catch(() => {});
    }
  });

  it('loadConfig should load config from custom path', async () => {
    const customConfigPath = path.resolve(process.cwd(), 'custom-uql.config.js');
    const configContent = 'export default { pool: { dialect: { dialectName: "mysql" } } }';
    try {
      await fs.writeFile(customConfigPath, configContent);
      const config = await loadConfig('custom-uql.config.js');
      expect(config.pool.dialect.dialectName).toBe('mysql');
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

  it('loadConfig should name a config that fails to import', async () => {
    const brokenPath = path.resolve(process.cwd(), 'broken-uql.config.js');
    try {
      await fs.writeFile(brokenPath, 'export default {');
      await expect(loadConfig('broken-uql.config.js')).rejects.toThrow(
        `Could not load configuration file at broken-uql.config.js: Could not import ${brokenPath}`,
      );
    } finally {
      await fs.unlink(brokenPath).catch(() => {});
    }
  });

  it('loadConfig should read a config with no default export as the module itself', async () => {
    const namedPath = path.resolve(process.cwd(), 'named-uql.config.js');
    try {
      await fs.writeFile(namedPath, 'export const pool = { dialect: { dialectName: "sqlite" } };');
      const config = await loadConfig('named-uql.config.js');
      expect(config.pool.dialect.dialectName).toBe('sqlite');
    } finally {
      await fs.unlink(namedPath).catch(() => {});
    }
  });

  it('loadConfig should throw if custom config path not found', async () => {
    await expect(loadConfig('non-existent.config.js')).rejects.toThrow(
      'Could not find uql configuration file at non-existent.config.js',
    );
  });
});
