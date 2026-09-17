import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = {
  main: vi.fn(),
};

vi.mock('./cli.js', () => ({
  main: mocks.main,
}));

describe('bin', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    vi.resetModules();
    process.argv = ['node', '/any/path/bin.ts', 'arg1', 'arg2'];
    vi.spyOn(process, 'exit').mockImplementation(vi.fn<typeof process.exit>());
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.restoreAllMocks();
  });

  it('should call main with arguments', async () => {
    mocks.main.mockResolvedValue(undefined);

    await import('./bin.js');

    expect(mocks.main).toHaveBeenCalledWith(['arg1', 'arg2']);
  });

  it('should handle errors from main', async () => {
    const error = new Error('Test error');
    mocks.main.mockRejectedValue(error);

    await import('./bin.js');
    await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(1));

    expect(console.error).toHaveBeenCalledWith(error);
  });
});
