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
      async findMany(entity: object, query: any): Promise<any[]> {
        return [];
      }
    }

    const querier = new MockQuerier();
    await querier.findMany(class User {}, { id: 1 });

    expect(logQuery).toHaveBeenCalledWith('findMany', [expect.any(Function), { id: 1 }], expect.any(Number));
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

  it('should attach the query to a thrown error, even without a logger', async () => {
    class MockQuerier {
      @Log()
      async all(query: string, values?: any[]) {
        throw new Error('syntax error');
      }
    }

    const querier = new MockQuerier();
    const err = await querier.all('SELECT 1', [123]).catch((e) => e);
    expect(err).toMatchObject({ message: 'syntax error', query: 'SELECT 1' });
    expect(err.values).toBeUndefined();
  });

  it('should not overwrite a query already present on the error', async () => {
    class MockQuerier {
      @Log()
      async all(query: string) {
        const err = new Error('boom') as Error & { query?: string };
        err.query = 'ORIGINAL';
        throw err;
      }
    }

    const querier = new MockQuerier();
    await expect(querier.all('SELECT 1')).rejects.toMatchObject({ query: 'ORIGINAL' });
  });
});
