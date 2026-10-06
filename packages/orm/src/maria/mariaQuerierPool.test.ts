import { describe, expect, it } from 'vitest';
import { AbstractSqlQuerierPoolIt } from '../querier/abstractSqlQuerierPool-test.js';
import { createSpec, mariadbConnection } from '../test/index.js';
import type { MariadbQuerier } from './mariadbQuerier.js';
import { MariadbQuerierPool } from './mariadbQuerierPool.js';

export class MariadbQuerierPoolIt extends AbstractSqlQuerierPoolIt<MariadbQuerier> {
  constructor() {
    super(() => new MariadbQuerierPool({ ...mariadbConnection(), trace: true }));
  }
}

createSpec(new MariadbQuerierPoolIt());

describe('MariadbQuerierPool', () => {
  /** `mariadb` emits `error` when it cannot open a connection, and an unheard `error` event ends the process. */
  it('should log a connection the pool could not open rather than crash', async () => {
    const { promise: logged, resolve } = Promise.withResolvers<string>();
    const pool = new MariadbQuerierPool(
      { host: '127.0.0.1', port: 1, connectionLimit: 1, initializationTimeout: 50 },
      { logger: { logError: (message) => resolve(message) } },
    );

    expect(await logged).toBe('MariaDB pool connection encountered an error');
    await pool.end();
  });
});
