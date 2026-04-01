import { describe, expect, it, vi } from 'vitest';
import { MariaDialect } from './mariaDialect.js';
import { MariadbQuerier } from './mariadbQuerier.js';

describe('MariadbQuerier', () => {
  it('should calculate changes from affectedRows', async () => {
    const query = vi.fn().mockResolvedValue({ affectedRows: 5, length: 0 });
    const conn = { query } as any;
    const dialect = new MariaDialect({});
    const querier = new MariadbQuerier(() => Promise.resolve(conn), dialect);
    (querier as any).conn = conn;

    const res = await querier.internalRun('UPDATE User SET name = ?', ['test']);
    expect(res.changes).toBe(5);
  });

  it('should calculate changes from length if affectedRows is missing', async () => {
    const query = vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]);
    const conn = { query } as any;
    const dialect = new MariaDialect({});
    const querier = new MariadbQuerier(() => Promise.resolve(conn), dialect);
    (querier as any).conn = conn;

    const res = await querier.internalRun('INSERT INTO User (name) VALUES (?) RETURNING id', ['test']);
    expect(res.changes).toBe(2);
  });

  it('should default changes to 0 if both affectedRows and length are missing', async () => {
    const query = vi.fn().mockResolvedValue({});
    const conn = { query } as any;
    const dialect = new MariaDialect({});
    const querier = new MariadbQuerier(() => Promise.resolve(conn), dialect);
    (querier as any).conn = conn;

    const res = await querier.internalRun('DELETE FROM User', []);
    expect(res.changes).toBe(0);
  });
});
