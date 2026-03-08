import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Entity, Id } from '../entity/index.js';
import { SchemaAST } from '../schema/schemaAST.js';
import * as cli from './cli.js';
import * as cliConfig from './cli-config.js';
import type { Migrator } from './migrator.js';

@Entity()
class TestEntity {
  @Id() id?: number;
}

const { mockMigrator } = vi.hoisted(() => {
  return {
    mockMigrator: {
      setSchemaGenerator: vi.fn(),
      up: vi.fn().mockResolvedValue([]),
      down: vi.fn().mockResolvedValue([]),
      status: vi.fn().mockResolvedValue({ executed: [], pending: [] }),
      generate: vi.fn().mockResolvedValue('file.ts'),
      generateFromEntities: vi.fn().mockResolvedValue('file.ts'),
      sync: vi.fn().mockResolvedValue(undefined),
      pending: vi.fn().mockResolvedValue([]),
    },
  };
});

vi.mock('./migrator.js', () => {
  return {
    // biome-ignore lint/complexity/useArrowFunction: we need to return a function for the mock implementation
    Migrator: vi.fn().mockImplementation(function () {
      return mockMigrator;
    }),
  };
});

vi.mock('./cli-config.js', () => {
  return {
    loadConfig: vi.fn(),
  };
});

describe('CLI', () => {
  let mockPool: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPool = { dialect: 'sqlite', end: vi.fn() };
    vi.mocked(cliConfig.loadConfig).mockResolvedValue({ pool: mockPool });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  it('main up', async () => {
    await cli.main(['up']);
    expect(cliConfig.loadConfig).toHaveBeenCalledWith(undefined);
    expect(mockMigrator.up).toHaveBeenCalled();
  });

  it('main up with custom config', async () => {
    await cli.main(['--config', 'custom.config.ts', 'up']);
    expect(cliConfig.loadConfig).toHaveBeenCalledWith('custom.config.ts');
    expect(mockMigrator.up).toHaveBeenCalled();
  });

  it('main up with custom config (short flag)', async () => {
    await cli.main(['-c', 'custom.config.ts', 'up']);
    expect(cliConfig.loadConfig).toHaveBeenCalledWith('custom.config.ts');
    expect(mockMigrator.up).toHaveBeenCalled();
  });

  it('main down', async () => {
    await cli.main(['down']);
    expect(mockMigrator.down).toHaveBeenCalledWith({ step: 1 });
  });

  it('main status', async () => {
    await cli.main(['status']);
    expect(mockMigrator.status).toHaveBeenCalled();
  });

  it('main generate', async () => {
    await cli.main(['generate', 'test_migration']);
    expect(mockMigrator.generate).toHaveBeenCalledWith('test_migration');
  });

  it('main generate:entities', async () => {
    await cli.main(['generate:entities', 'initial']);
    expect(mockMigrator.generateFromEntities).toHaveBeenCalledWith('initial');
  });

  it('main sync', async () => {
    await cli.main(['sync']);
    expect(mockMigrator.sync).toHaveBeenCalledWith({ force: false });
  });

  it('main sync --force', async () => {
    await cli.main(['sync', '--force']);
    expect(mockMigrator.sync).toHaveBeenCalledWith({ force: true });
  });

  it('main help', async () => {
    await cli.main(['--help']);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
  });

  it('main unknown command', async () => {
    await cli.main(['unknown']);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Unknown command: unknown'));
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('runUp', async () => {
    mockMigrator.up.mockResolvedValue([{ name: 'm1', success: true }]);
    await cli.runUp(mockMigrator as unknown as Migrator, []);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Migrations complete: 1 successful, 0 failed'));

    mockMigrator.up.mockResolvedValue([]);
    await cli.runUp(mockMigrator as unknown as Migrator, []);
    expect(console.log).toHaveBeenCalledWith('No pending migrations.');

    mockMigrator.up.mockResolvedValue([{ name: 'm1', success: false }]);
    await cli.runUp(mockMigrator as unknown as Migrator, ['--to', 'm1', '--step', '1']);
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('runDown', async () => {
    mockMigrator.down.mockResolvedValue([{ name: 'm1', success: true }]);
    await cli.runDown(mockMigrator as unknown as Migrator, []);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Rollback complete: 1 successful, 0 failed'));

    mockMigrator.down.mockResolvedValue([]);
    await cli.runDown(mockMigrator as unknown as Migrator, []);
    expect(console.log).toHaveBeenCalledWith('No migrations to rollback.');

    mockMigrator.down.mockResolvedValue([{ name: 'm1', success: false }]);
    await cli.runDown(mockMigrator as unknown as Migrator, ['--to', 'm1', '--step', '1', '--all']);
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('runStatus', async () => {
    mockMigrator.status.mockResolvedValue({ executed: ['m1'], pending: ['m2'] });
    await cli.runStatus(mockMigrator as unknown as Migrator);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('✓ m1'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('○ m2'));

    mockMigrator.status.mockResolvedValue({ executed: [], pending: [] });
    await cli.runStatus(mockMigrator as unknown as Migrator);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('(none)'));
  });

  it('runPending', async () => {
    mockMigrator.pending.mockResolvedValue([{ name: 'm1' }]);
    await cli.runPending(mockMigrator as unknown as Migrator);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('○ m1'));

    mockMigrator.pending.mockResolvedValue([]);
    await cli.runPending(mockMigrator as unknown as Migrator);
    expect(console.log).toHaveBeenCalledWith('No pending migrations.');
  });

  it('runGenerate', async () => {
    await cli.runGenerate(mockMigrator as unknown as Migrator, ['add', 'user']);
    expect(mockMigrator.generate).toHaveBeenCalledWith('add_user');
  });

  it('runGenerateFromEntities', async () => {
    await cli.runGenerateFromEntities(mockMigrator as unknown as Migrator, ['init']);
    expect(mockMigrator.generateFromEntities).toHaveBeenCalledWith('init');
  });

  it('runSync', async () => {
    await cli.runSync(mockMigrator as unknown as Migrator, ['--force'], {});
    expect(mockMigrator.sync).toHaveBeenCalledWith({ force: true });
  });

  it('getSchemaGenerator', () => {
    expect(cli.getSchemaGenerator('postgres')).toBeDefined();
    expect(cli.getSchemaGenerator('mysql')).toBeDefined();
    expect(cli.getSchemaGenerator('sqlite')).toBeDefined();
    expect(cli.getSchemaGenerator('mongodb')).toBeDefined();
    expect(cli.getSchemaGenerator('unknown' as any)).toBeUndefined();
  });

  it('main should throw if pool is missing', async () => {
    vi.mocked(cliConfig.loadConfig).mockResolvedValue({ pool: undefined as any });
    await cli.main(['up']);
    expect(console.error).toHaveBeenCalledWith('Error:', 'pool is required in configuration');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('main should handle migration error', async () => {
    mockMigrator.up.mockRejectedValue(new Error('Migration failed'));
    await cli.main(['up']);
    expect(console.error).toHaveBeenCalledWith('Error:', 'Migration failed');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('main generate-entities (hyphenated alias)', async () => {
    await cli.main(['generate-entities', 'schema']);
    expect(mockMigrator.generateFromEntities).toHaveBeenCalledWith('schema');
  });

  it('main create (alias for generate)', async () => {
    await cli.main(['create', 'add_table']);
    expect(mockMigrator.generate).toHaveBeenCalledWith('add_table');
  });

  it('main pending', async () => {
    await cli.main(['pending']);
    expect(mockMigrator.pending).toHaveBeenCalled();
  });

  it('main -h (short help flag)', async () => {
    await cli.main(['-h']);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
  });

  it('main with no command shows help', async () => {
    await cli.main([]);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
  });

  it('getSchemaGenerator mariadb', () => {
    expect(cli.getSchemaGenerator('mariadb')).toBeDefined();
  });

  it('runSync with --push should use entity-to-db direction', async () => {
    const migrator = {
      ...mockMigrator,
      schemaIntrospector: { introspect: vi.fn().mockResolvedValue(new SchemaAST()) },
      sync: vi.fn(),
    } as unknown as Migrator;

    await cli.runSync(migrator, ['--push'], { entities: [TestEntity] });
    expect(console.log).toHaveBeenCalled();
  });

  it('runSync with --pull should use db-to-entity direction', async () => {
    const migrator = {
      ...mockMigrator,
      schemaIntrospector: { introspect: vi.fn().mockResolvedValue(new SchemaAST()) },
      sync: vi.fn(),
    } as unknown as Migrator;

    await cli.runSync(migrator, ['--pull'], { entities: [TestEntity] });
    expect(console.log).toHaveBeenCalled();
  });

  it('runSync with --direction bidirectional', async () => {
    const migrator = {
      ...mockMigrator,
      schemaIntrospector: { introspect: vi.fn().mockResolvedValue(new SchemaAST()) },
      sync: vi.fn(),
    } as unknown as Migrator;

    await cli.runSync(migrator, ['--direction', 'bidirectional'], { entities: [TestEntity] });
    expect(console.log).toHaveBeenCalled();
  });

  it('runSync with --dry-run', async () => {
    const migrator = {
      ...mockMigrator,
      schemaIntrospector: { introspect: vi.fn().mockResolvedValue(new SchemaAST()) },
      sync: vi.fn(),
    } as unknown as Migrator;

    await cli.runSync(migrator, ['--dry-run'], { entities: [TestEntity] });
    expect(console.log).toHaveBeenCalled();
  });

  it('runSync without entities or introspector falls back to migrator.sync', async () => {
    const migrator = { ...mockMigrator, sync: vi.fn() } as unknown as Migrator;
    await cli.runSync(migrator, [], {});
    expect(migrator.sync).toHaveBeenCalledWith({ force: false });
  });

  it('runGenerateFromDb should exit if no introspector', async () => {
    const migrator = { ...mockMigrator, schemaIntrospector: undefined } as unknown as Migrator;
    await cli.runGenerateFromDb(migrator, [], {});
    expect(console.error).toHaveBeenCalledWith('No introspector available. Check your pool configuration.');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('runDriftCheck should exit if no entities', async () => {
    await cli.runDriftCheck(mockMigrator as unknown as Migrator, { entities: [] });
    expect(console.error).toHaveBeenCalledWith('No entities configured. Add entities to your uql config.');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('runDriftCheck should report in_sync when schemas match', async () => {
    // Build an AST that matches the expected entity schema
    const { SchemaASTBuilder } = await import('../schema/schemaASTBuilder.js');
    const builder = new SchemaASTBuilder();
    const matchingAST = builder.fromEntities([TestEntity]);

    const migrator = {
      ...mockMigrator,
      schemaIntrospector: {
        introspect: vi.fn().mockResolvedValue(matchingAST),
      },
    } as unknown as Migrator;

    await cli.runDriftCheck(migrator, { entities: [TestEntity] });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Schema is in sync'));
  });

  it('main drift:check with config', async () => {
    // Modify shared mock to include introspector
    (mockMigrator as any).schemaIntrospector = { introspect: vi.fn().mockResolvedValue(new SchemaAST()) };

    vi.mocked(cliConfig.loadConfig).mockResolvedValue({
      pool: mockPool,
      entities: [TestEntity],
    });

    try {
      await cli.main(['drift:check']);
    } finally {
      // Clean up shared mock
      delete (mockMigrator as any).schemaIntrospector;
    }

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Checking for schema drift'));
  });

  it('main should not call pool.end if pool has no end method', async () => {
    const poolWithoutEnd = { dialect: 'sqlite' };
    vi.mocked(cliConfig.loadConfig).mockResolvedValue({ pool: poolWithoutEnd as any });

    await cli.main(['up']);
    expect(mockMigrator.up).toHaveBeenCalled();
  });
});
