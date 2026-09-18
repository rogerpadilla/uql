import * as fs from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Entity, Field, Id } from '../entity/index.js';
import { buildSchemaAST } from '../schema/schemaASTBuilder.js';
import { SqliteDialect } from '../sqlite/sqliteDialect.js';
import { createMockQuerier, createMockQuerierPool } from '../test/index.js';
import { runGenerateFromDb } from './cli.js';
import { Migrator } from './migrator.js';

vi.mock('node:fs', () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

@Entity({ name: 'shops' })
class Shop {
  @Id({ type: Number }) id?: number;
  @Field({ type: String, columnType: 'varchar', length: 100 }) name?: string | null;
}

/** Migrator whose introspection reports the `shops` table. */
function createMigrator(): Migrator {
  const migrator = new Migrator(createMockQuerierPool(new SqliteDialect(), async () => createMockQuerier()));
  vi.spyOn(migrator.schemaIntrospector, 'introspect').mockResolvedValue(buildSchemaAST([Shop]));
  return migrator;
}

describe('runGenerateFromDb', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('should write one entity file per introspected table to the default directory', async () => {
    await runGenerateFromDb(createMigrator(), []);

    expect(fs.mkdirSync).toHaveBeenCalledWith('./src/entities', { recursive: true });
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    const [filePath, code] = vi.mocked(fs.writeFileSync).mock.calls[0];
    expect(filePath).toBe('src/entities/Shop.ts');
    expect(code).toContain("@Entity({ name: 'shops' })");
    expect(code).toContain('export class Shop {');
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Found 1 table(s): shops'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Generated 1 entities'));
  });

  it.each(['--output', '-o'])('should honour %s as the output directory, creating it', async (flag) => {
    await runGenerateFromDb(createMigrator(), [flag, 'generated/models']);

    expect(fs.mkdirSync).toHaveBeenCalledWith('generated/models', { recursive: true });
    expect(vi.mocked(fs.writeFileSync).mock.calls[0][0]).toBe('generated/models/Shop.ts');
  });

  it('should ignore an output flag with no value after it', async () => {
    await runGenerateFromDb(createMigrator(), ['--output']);

    expect(vi.mocked(fs.writeFileSync).mock.calls[0][0]).toBe('src/entities/Shop.ts');
  });
});
