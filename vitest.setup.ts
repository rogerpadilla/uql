import { vi } from 'vitest';

vi.mock('bun', () => {
  function SQL() {
    return {
      unsafe: vi.fn(),
      reserve: vi.fn().mockResolvedValue({
        unsafe: vi.fn(),
        release: vi.fn(),
      }),
      close: vi.fn(),
    };
  }

  // Bun SQL instances/classes are functions with properties.
  SQL.unsafe = vi.fn();
  SQL.reserve = vi.fn();
  SQL.close = vi.fn();

  return { SQL };
});
