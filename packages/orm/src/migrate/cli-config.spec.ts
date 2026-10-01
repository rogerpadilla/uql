import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig, tsxApiFor } from './cli-config.js';

/** A project holding a stub `tsx` whose `tsImport` answers a config tagged with the loader. */
async function projectWithTsx(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'uql-tsx-'));
  const tsx = path.join(dir, 'node_modules', 'tsx');
  await fs.mkdir(path.join(tsx, 'dist'), { recursive: true });
  await fs.writeFile(
    path.join(tsx, 'package.json'),
    JSON.stringify({ name: 'tsx', type: 'module', exports: { './esm/api': './dist/api.js' } }),
  );
  await fs.writeFile(
    path.join(tsx, 'dist', 'api.js'),
    'export const tsImport = async () => ({ default: { pool: { dialect: { dialectName: "loadedByTsx" } } } });',
  );
  await fs.writeFile(path.join(dir, 'uql.config.ts'), 'export default {};');
  return dir;
}

describe('cli-config', () => {
  const configPath = path.resolve(process.cwd(), 'uql.config.js');

  afterEach(async () => {
    try {
      await fs.unlink(configPath);
    } catch {}
  });

  it('should load config from uql.config.js', async () => {
    const configContent = 'export default { pool: { dialect: { dialectName: "sqlite" } } }';
    await fs.writeFile(configPath, configContent);
    const config = await loadConfig();
    expect(config.pool.dialect.dialectName).toBe('sqlite');
  });

  it('should load a TypeScript config when the runtime can transpile it', async () => {
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

  it('should load config from a custom path', async () => {
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

  it('should throw where no config is found', async () => {
    // Ensure no config file exists
    const configFiles = ['uql.config.ts', 'uql.config.js', 'uql.config.mjs', '.uqlrc.ts', '.uqlrc.js'];
    for (const file of configFiles) {
      try {
        await fs.unlink(path.resolve(process.cwd(), file));
      } catch {}
    }

    await expect(loadConfig()).rejects.toThrow('Could not find uql configuration file');
  });

  it('should name a config that fails to import', async () => {
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

  it('should read a config with no default export as the module itself', async () => {
    const namedPath = path.resolve(process.cwd(), 'named-uql.config.js');
    try {
      await fs.writeFile(namedPath, 'export const pool = { dialect: { dialectName: "sqlite" } };');
      const config = await loadConfig('named-uql.config.js');
      expect(config.pool.dialect.dialectName).toBe('sqlite');
    } finally {
      await fs.unlink(namedPath).catch(() => {});
    }
  });

  it('should import a TypeScript config through the tsx the project installed', async () => {
    const dir = await projectWithTsx();
    try {
      const config = await loadConfig(path.join(dir, 'uql.config.ts'));
      expect(config.pool.dialect.dialectName).toBe('loadedByTsx');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('should find the tsx beside a TypeScript config', async () => {
    const dir = await projectWithTsx();
    try {
      expect(tsxApiFor(path.join(dir, 'uql.config.ts'), {})).toBe(
        await fs.realpath(path.join(dir, 'node_modules', 'tsx', 'dist', 'api.js')),
      );
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('should leave a JavaScript config to the runtime', async () => {
    const dir = await projectWithTsx();
    try {
      expect(tsxApiFor(path.join(dir, 'uql.config.js'), {})).toBeUndefined();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('should leave a TypeScript config to Bun', async () => {
    const dir = await projectWithTsx();
    try {
      expect(tsxApiFor(path.join(dir, 'uql.config.ts'), { bun: '1.4.2' })).toBeUndefined();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('should leave a TypeScript config to Deno', async () => {
    const dir = await projectWithTsx();
    try {
      expect(tsxApiFor(path.join(dir, 'uql.config.ts'), { deno: '2.5.0' })).toBeUndefined();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('should leave a TypeScript config to the runtime where the project has no tsx', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'uql-no-tsx-'));
    try {
      expect(tsxApiFor(path.join(dir, 'uql.config.ts'), {})).toBeUndefined();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('should name tsx where a config fails to import', async () => {
    const brokenPath = path.resolve(process.cwd(), 'broken-tsx-uql.config.js');
    try {
      await fs.writeFile(brokenPath, 'export default {');
      await expect(loadConfig('broken-tsx-uql.config.js')).rejects.toThrow(
        'install tsx (`npm i -D tsx`), which the CLI uses when it finds one. See https://uql-orm.dev/migrations#running-the-cli',
      );
    } finally {
      await fs.unlink(brokenPath).catch(() => {});
    }
  });

  it('should throw where a custom config path is not found', async () => {
    await expect(loadConfig('non-existent.config.js')).rejects.toThrow(
      'Could not find uql configuration file at non-existent.config.js',
    );
  });
});
