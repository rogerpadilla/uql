import { describe, expect, it, vi } from 'vitest';
import { Log } from './log.js';

describe('Log decorator', () => {
  it('should log query execution', async () => {
    const logQuery = vi.fn();
    class MockQuerier {
      logger = { logQuery } as any;
      @Log()
      async all(query: string, values?: any[]) {
        return [{ id: 1 }];
      }
    }

    const querier = new MockQuerier();
    const result = await querier.all('SELECT 1', [123]);

    expect(result).toEqual([{ id: 1 }]);
    expect(logQuery).toHaveBeenCalledWith('SELECT 1', [123], expect.any(Number));
  });

  it('should log query execution even on error', async () => {
    const logQuery = vi.fn();
    class MockQuerier {
      logger = { logQuery } as any;
      @Log()
      async run(query: string, values?: any[]) {
        throw new Error('fail');
      }
    }

    const querier = new MockQuerier();
    await expect(querier.run('INSERT 1')).rejects.toThrow('fail');

    expect(logQuery).toHaveBeenCalledWith('INSERT 1', undefined, expect.any(Number));
  });

  it('should log method name for non-standard methods', async () => {
    const logQuery = vi.fn();
    class MockQuerier {
      logger = { logQuery } as any;
      @Log()
      async findMany(entity: string, query: any): Promise<any[]> {
        return [];
      }
    }

    const querier = new MockQuerier();
    await querier.findMany('User', { id: 1 });

    expect(logQuery).toHaveBeenCalledWith('findMany', ['User', { id: 1 }], expect.any(Number));
  });

  it('should do nothing if logger is not present', async () => {
    class MockQuerier {
      @Log()
      async all(query: string): Promise<any[]> {
        return [];
      }
    }

    const querier = new MockQuerier();
    const result = await querier.all('SELECT 1');
    expect(result).toEqual([]);
  });
});
