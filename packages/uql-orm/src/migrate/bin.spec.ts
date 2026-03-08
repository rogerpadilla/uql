import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  main: vi.fn(),
}));

vi.mock('./cli.js', () => ({
  main: mocks.main,
}));

describe('bin', () => {
  const originalArgv = process.argv;
  const originalExit = process.exit;
  const originalConsoleError = console.error;

  beforeEach(() => {
    vi.resetModules();
    process.argv = [...originalArgv];
    // Mock argv[1] to match the file path so the script runs
    process.argv[1] = new URL('./bin.ts', import.meta.url).pathname;
    // Mock process.exit to prevent test process termination
    process.exit = vi.fn() as any;
    console.error = vi.fn();
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exit = originalExit;
    console.error = originalConsoleError;
    vi.clearAllMocks();
  });

  it('should call main with arguments', async () => {
    // Arbitrary path, doesn't matter now that we don't check for isMain
    const binPath = '/any/path/bin.ts';
    process.argv = ['node', binPath, 'arg1', 'arg2'];
    mocks.main.mockResolvedValue(undefined);

    await import('./bin.js');

    expect(mocks.main).toHaveBeenCalledWith(['arg1', 'arg2']);
  });

  it('should handle errors from main', async () => {
    const error = new Error('Test error');
    mocks.main.mockRejectedValue(error);

    await import('./bin.js');

    // Wait for the promise chain to settle
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(console.error).toHaveBeenCalledWith(error);
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
