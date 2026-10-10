import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { importFailure, loadConfig, tsxApiFor } from './cli-config.js';

/**
 * A project holding a stub `tsx` whose `register` marks the process, and a config reading the mark: imported by
 * the process itself once registered, so it shares the module instances the CLI loaded. Its API has a CommonJS
 * build beside the ESM one, as the real package does, whose `register` fails on Node 22.
 */
async function projectWithTsx(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'uql-tsx-'));
  const tsx = path.join(dir, 'node_modules', 'tsx');
  await fs.mkdir(path.join(tsx, 'dist'), { recursive: true });
  await fs.writeFile(
    path.join(tsx, 'package.json'),
    JSON.stringify({
      name: 'tsx',
      exports: {
        './package.json': './package.json',
        './esm/api': {
          import: { default: './dist/api.mjs' },
          require: { default: './dist/api.cjs' },
        },
      },
    }),
  );
  await fs.writeFile(
    path.join(tsx, 'dist', 'api.mjs'),
    'export const register = () => { globalThis.uqlTsxRegistered = true; return async () => {}; };',
  );
  await fs.writeFile(
    path.join(tsx, 'dist', 'api.cjs'),
    'exports.register = () => { throw new Error("the CommonJS build registered"); };',
  );
  await fs.writeFile(
    path.join(dir, 'uql.config.ts'),
    'export default { pool: { dialect: { dialectName: globalThis.uqlTsxRegistered ? "registeredTsx" : "none" } } };',
  );
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

  it('should name a config that fails to import, pointing plain Node at a runtime that runs decorators', async () => {
    const brokenPath = path.resolve(process.cwd(), 'broken-uql.config.js');
    try {
      await fs.writeFile(brokenPath, 'export default {');
      const error = loadConfig('broken-uql.config.js');
      await expect(error).rejects.toThrow(`Could not import ${brokenPath}`);
      await expect(error).rejects.toThrow('decorators need a runtime that transforms TypeScript');
    } finally {
      await fs.unlink(brokenPath).catch(() => {});
    }
  });

  it.each([
    ['Bun', { bun: '1.4.2' }, undefined],
    ['tsx', {}, '/app/node_modules/tsx/esm/api'],
  ])('should not point at a runtime for decorators when %s already runs them', (_name, versions, tsxApi) => {
    expect(importFailure('/app/uql.config.ts', new Error('boom'), versions, tsxApi).message).toBe(
      'Could not import /app/uql.config.ts: boom',
    );
  });

  it('should name a thrown value that is no Error', () => {
    expect(importFailure('/app/uql.config.ts', 'boom', { bun: '1.4.2' }, undefined).message).toBe(
      'Could not import /app/uql.config.ts: boom',
    );
  });

  it('should pass on what a config threw as it loaded', async () => {
    const throwingPath = path.resolve(process.cwd(), 'throwing-uql.config.js');
    try {
      await fs.writeFile(throwingPath, "throw new Error('DATABASE_URL is missing');");
      const error = loadConfig('throwing-uql.config.js');
      await expect(error).rejects.toThrow(`Could not import ${throwingPath}: DATABASE_URL is missing`);
    } finally {
      await fs.unlink(throwingPath).catch(() => {});
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

  it('should import a TypeScript config once the tsx the project installed is registered', async () => {
    const dir = await projectWithTsx();
    try {
      const config = await loadConfig(path.join(dir, 'uql.config.ts'));
      expect(config.pool.dialect.dialectName).toBe('registeredTsx');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('should find the tsx beside a TypeScript config', async () => {
    const dir = await projectWithTsx();
    try {
      expect(tsxApiFor(path.join(dir, 'uql.config.ts'), {})).toBe(
        await fs.realpath(path.join(dir, 'node_modules', 'tsx', 'dist', 'api.mjs')),
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
