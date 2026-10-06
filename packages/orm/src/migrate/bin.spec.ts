import { afterEach, describe, expect, it, vi } from 'vitest';

describe('bin', () => {
  const originalArgv = process.argv;

  afterEach(() => {
    process.argv = originalArgv;
    vi.restoreAllMocks();
  });

  it('should run the CLI on the arguments after the script', async () => {
    process.argv = ['node', '/any/path/bin.js', '--help'];
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await import('./bin.js');

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Usage: uql-orm/migrate <command> [options]'));
  });
});
