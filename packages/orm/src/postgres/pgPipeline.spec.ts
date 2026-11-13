import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { pipelined } from './pgPipeline.js';

/** A connection recording what a query writes to it, binding each value as the wire would. */
function recordingConnection() {
  const written: string[] = [];
  const connection = {
    parsedStatements: {},
    submittedNamedStatements: {},
    stream: { cork() {}, uncork() {} },
    written,
    parse: ({ text }: { text: string }) => written.push(`parse ${text}`),
    bind: ({ values, valueMapper }: { values: unknown[]; valueMapper: (value: unknown) => unknown }) => {
      values.forEach((value) => valueMapper(value));
      written.push('bind');
    },
    describe: () => written.push('describe'),
    execute: () => written.push('execute'),
    close: () => written.push('close'),
    flush: () => written.push('flush'),
    sync: () => written.push('sync'),
  };
  return connection;
}

/** A client running a query against `connection`, with node-postgres' own `Query` on its class. */
function clientOn(connection: ReturnType<typeof recordingConnection>) {
  class Recording {
    static readonly Query: unknown = Reflect.get(Client, 'Query');
    getTypeParser() {
      return String;
    }
    /** Submitted to the connection, as `pg` submits a query object; a text one is never sent here. */
    query(query: unknown) {
      Reflect.get(Object(query), 'submit')?.call(query, connection);
      return Promise.resolve({ rows: [] });
    }
  }
  return new Recording();
}

describe('a pipelined list', () => {
  it("should write each statement's Parse, Bind and Execute, then one Sync", () => {
    const connection = recordingConnection();
    void pipelined(clientOn(connection), [
      { sql: 'SELECT 1', values: [] },
      { sql: 'SELECT $1', values: [2] },
    ]);
    expect(connection.written).toEqual([
      'parse SELECT 1',
      'bind',
      'describe',
      'execute',
      'parse SELECT $1',
      'bind',
      'describe',
      'execute',
      'sync',
    ]);
  });

  it('should stop at a value that cannot be bound, naming its statement past the leading ones', async () => {
    const connection = recordingConnection();
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    const run = pipelined(
      clientOn(connection),
      [
        { sql: 'BEGIN', values: [] },
        { sql: 'SELECT $1', values: [circular] },
        { sql: 'SELECT 3', values: [] },
      ],
      1,
    );
    await expect(run).rejects.toMatchObject({ statementIndex: 0 });
    expect(connection.written.filter((step) => step.startsWith('parse'))).toEqual(['parse BEGIN', 'parse SELECT $1']);
    expect(connection.written.at(-1)).toBe('sync');
  });

  it("should run the statements in turn where the client's Query cannot be pipelined, as pg-native's", async () => {
    const ran: string[] = [];
    class Native {
      static readonly Query = class {
        submit() {}
      };
      getTypeParser() {
        return String;
      }
      query(sql: unknown) {
        ran.push(String(sql));
        return Promise.resolve(sql === 'SELECT 2' ? Promise.reject(new Error('refused')) : { rows: [], rowCount: 0 });
      }
    }
    const statements = [
      { sql: 'BEGIN', values: [] },
      { sql: 'SELECT 1', values: [] },
      { sql: 'SELECT 2', values: [] },
      { sql: 'SELECT 3', values: [] },
    ];
    await expect(pipelined(new Native(), statements, 1)).rejects.toMatchObject({ statementIndex: 1 });
    expect(ran).toEqual(['BEGIN', 'SELECT 1', 'SELECT 2']);
  });
});
