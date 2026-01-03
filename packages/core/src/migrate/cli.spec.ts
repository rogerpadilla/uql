import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as cli from './cli.js';
import * as cliConfig from './cli-config.js';

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
    await cli.runUp(mockMigrator as any, []);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Migrations complete: 1 successful, 0 failed'));

    mockMigrator.up.mockResolvedValue([]);
    await cli.runUp(mockMigrator as any, []);
    expect(console.log).toHaveBeenCalledWith('No pending migrations.');

    mockMigrator.up.mockResolvedValue([{ name: 'm1', success: false }]);
    await cli.runUp(mockMigrator as any, ['--to', 'm1', '--step', '1']);
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('runDown', async () => {
    mockMigrator.down.mockResolvedValue([{ name: 'm1', success: true }]);
    await cli.runDown(mockMigrator as any, []);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Rollback complete: 1 successful, 0 failed'));

    mockMigrator.down.mockResolvedValue([]);
    await cli.runDown(mockMigrator as any, []);
    expect(console.log).toHaveBeenCalledWith('No migrations to rollback.');

    mockMigrator.down.mockResolvedValue([{ name: 'm1', success: false }]);
    await cli.runDown(mockMigrator as any, ['--to', 'm1', '--step', '1', '--all']);
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('runStatus', async () => {
    mockMigrator.status.mockResolvedValue({ executed: ['m1'], pending: ['m2'] });
    await cli.runStatus(mockMigrator as any);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('✓ m1'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('○ m2'));

    mockMigrator.status.mockResolvedValue({ executed: [], pending: [] });
    await cli.runStatus(mockMigrator as any);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('(none)'));
  });

  it('runPending', async () => {
    mockMigrator.pending.mockResolvedValue([{ name: 'm1' }]);
    await cli.runPending(mockMigrator as any);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('○ m1'));

    mockMigrator.pending.mockResolvedValue([]);
    await cli.runPending(mockMigrator as any);
    expect(console.log).toHaveBeenCalledWith('No pending migrations.');
  });

  it('runGenerate', async () => {
    await cli.runGenerate(mockMigrator as any, ['add', 'user']);
    expect(mockMigrator.generate).toHaveBeenCalledWith('add_user');
  });

  it('runGenerateFromEntities', async () => {
    await cli.runGenerateFromEntities(mockMigrator as any, ['init']);
    expect(mockMigrator.generateFromEntities).toHaveBeenCalledWith('init');
  });

  it('runSync', async () => {
    await cli.runSync(mockMigrator as any, ['--force']);
    expect(mockMigrator.sync).toHaveBeenCalledWith({ force: true });
  });

  it('getSchemaGenerator', () => {
    expect(cli.getSchemaGenerator('postgres')).toBeDefined();
    expect(cli.getSchemaGenerator('mysql')).toBeDefined();
    expect(cli.getSchemaGenerator('sqlite')).toBeDefined();
    expect(cli.getSchemaGenerator('mongodb')).toBeDefined();
    expect(() => cli.getSchemaGenerator('unknown' as any)).toThrow('Unknown dialect: unknown');
  });
});
