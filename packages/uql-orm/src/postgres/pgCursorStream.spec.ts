import { describe, expect, it } from 'vitest';
import { streamViaCursor } from './pgCursorStream.js';

type Row = { id: number };

/** Answers `FETCH` with slices of `rows` and records every statement it was asked to run. */
function fakeExec(rows: Row[], onFetch?: (batch: number) => void) {
  const statements: string[] = [];
  const values: (unknown[] | undefined)[] = [];
  let cursor = 0;
  let batch = 0;
  const exec = async (query: string, params?: unknown[]) => {
    statements.push(query);
    values.push(params);
    if (!query.startsWith('FETCH')) {
      return [];
    }
    onFetch?.(++batch);
    const size = Number(query.split(' ')[2]);
    const page = rows.slice(cursor, cursor + size);
    cursor += page.length;
    return page;
  };
  return { exec, statements, values };
}

const collect = async (stream: AsyncIterable<Row>) => {
  const rows: Row[] = [];
  for await (const row of stream) {
    rows.push(row);
  }
  return rows;
};

const kinds = (statements: string[]) => statements.map((s) => s.split(' ')[0]);

describe('streamViaCursor', () => {
  it('should open a transaction, declare the cursor, and commit once drained', async () => {
    const { exec, statements, values } = fakeExec([{ id: 1 }, { id: 2 }]);

    expect(await collect(streamViaCursor<Row>(exec, 'SELECT id FROM u WHERE id > $1', [0]))).toEqual([
      { id: 1 },
      { id: 2 },
    ]);

    expect(kinds(statements)).toEqual(['BEGIN', 'DECLARE', 'FETCH', 'CLOSE', 'COMMIT']);
    expect(statements[1]).toContain('CURSOR FOR SELECT id FROM u WHERE id > $1');
    expect(values[1]).toEqual([0]);
  });

  it('should bind the values to the declaration only', async () => {
    const { exec, values } = fakeExec([{ id: 1 }]);
    await collect(streamViaCursor<Row>(exec, 'SELECT id FROM u', [7]));
    expect(values).toEqual([undefined, [7], undefined, undefined, undefined]);
  });

  it('should keep fetching while a batch comes back full', async () => {
    const rows = Array.from({ length: 250 }, (_, i) => ({ id: i }));
    const { exec, statements } = fakeExec(rows);

    expect(await collect(streamViaCursor<Row>(exec, 'SELECT id FROM u'))).toEqual(rows);

    expect(kinds(statements)).toEqual(['BEGIN', 'DECLARE', 'FETCH', 'FETCH', 'FETCH', 'CLOSE', 'COMMIT']);
  });

  it('should leave the transaction to the caller when one is already open', async () => {
    const { exec, statements } = fakeExec([{ id: 1 }]);

    await collect(streamViaCursor<Row>(exec, 'SELECT id FROM u', undefined, true));

    expect(kinds(statements)).toEqual(['DECLARE', 'FETCH', 'CLOSE']);
  });

  it('should name each cursor distinctly, so two streams share a connection', async () => {
    const first = fakeExec([{ id: 1 }]);
    const second = fakeExec([{ id: 2 }]);

    await collect(streamViaCursor<Row>(first.exec, 'SELECT id FROM u'));
    await collect(streamViaCursor<Row>(second.exec, 'SELECT id FROM u'));

    expect(first.statements[1]).not.toEqual(second.statements[1]);
    expect(first.statements[1]).toMatch(/^DECLARE _uql_cursor_\d+ CURSOR FOR /);
  });

  it('should close the cursor and roll back when the consumer stops early', async () => {
    const { exec, statements } = fakeExec(Array.from({ length: 250 }, (_, i) => ({ id: i })));

    for await (const row of streamViaCursor<Row>(exec, 'SELECT id FROM u')) {
      expect(row).toEqual({ id: 0 });
      break;
    }

    expect(kinds(statements)).toEqual(['BEGIN', 'DECLARE', 'FETCH', 'CLOSE', 'COMMIT']);
  });

  it('should roll back and report the original failure when a fetch throws', async () => {
    const { exec, statements } = fakeExec([{ id: 1 }], (batch) => {
      if (batch > 0) {
        throw new Error('connection lost');
      }
    });

    await expect(collect(streamViaCursor<Row>(exec, 'SELECT id FROM u'))).rejects.toThrow('connection lost');
    expect(kinds(statements)).toEqual(['BEGIN', 'DECLARE', 'FETCH', 'CLOSE', 'ROLLBACK']);
  });

  it('should not let a failing cleanup mask the original failure', async () => {
    const statements: string[] = [];
    const exec = async (query: string) => {
      statements.push(query);
      if (query.startsWith('FETCH')) {
        throw new Error('connection lost');
      }
      if (query.startsWith('CLOSE')) {
        throw new Error('cursor already gone');
      }
      return [];
    };

    await expect(collect(streamViaCursor<Row>(exec, 'SELECT id FROM u'))).rejects.toThrow('connection lost');
    expect(kinds(statements)).toEqual(['BEGIN', 'DECLARE', 'FETCH', 'CLOSE', 'ROLLBACK']);
  });
});
