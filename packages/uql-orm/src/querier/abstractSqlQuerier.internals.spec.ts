import { describe, expect, it, vi } from 'vitest';
import { Entity, Field, Id, ManyToOne, OneToMany } from '../entity/index.js';
import { SqliteDialect } from '../sqlite/sqliteDialect.js';
import { createMockQuerierPool } from '../test/mockQuerierPool.js';
import type { ExtraOptions, Json, QueryUpdateResult, RawRow } from '../type/index.js';
import { AbstractSqlQuerier } from './abstractSqlQuerier.js';
import type { QueryError } from './queryError.js';

@Entity()
class HydratedChild {
  @Id({ type: Number })
  id?: number;
  @Field({ type: 'jsonb' })
  payload?: Json<{ b?: number }>;
  @Field({ references: () => HydratedParent })
  parentId?: number;
  @ManyToOne({ entity: () => HydratedParent })
  parent?: HydratedParent;
}

@Entity()
class HydratedParent {
  @Id({ type: Number })
  id?: number;
  @Field({ type: 'json' })
  settings?: Json<{ a?: number }>;
  @Field({ type: String })
  name?: string;
  @OneToMany({ entity: () => HydratedChild, mappedBy: 'parent' })
  children?: HydratedChild[];
}

/** Querier over canned driver rows: no database, so `internalAll` returns exactly what a test hands it. */
class StubSqlQuerier extends AbstractSqlQuerier {
  rows: RawRow[] = [];
  failOn?: string;
  failure: unknown = new Error('driver rejected the statement');
  releases = 0;
  handedBackWithOpenTransaction = false;

  constructor(extra?: ExtraOptions) {
    super(new SqliteDialect({}), extra);
  }

  protected override async internalAll<T>(): Promise<T[]> {
    return this.rows as T[];
  }

  protected override async *internalStream<T>(): AsyncIterable<T> {
    yield* this.rows as T[];
    throw new TypeError('driver stream failed');
  }

  protected override async internalRun(query: string): Promise<QueryUpdateResult> {
    if (query === this.failOn) {
      throw this.failure;
    }
    return { changes: 0 };
  }

  /** Records the transaction state at hand-back, which is what `release` is responsible for. */
  protected override async internalRelease(): Promise<void> {
    this.handedBackWithOpenTransaction = this.hasOpenTransaction;
    this.releases += 1;
  }
}

describe('AbstractSqlQuerier JSON hydration', () => {
  it('should parse JSON columns of the root entity', async () => {
    const querier = new StubSqlQuerier();
    querier.rows = [{ id: 1, settings: '{"a":1}', name: 'maz' }];

    const [found] = await querier.findMany(HydratedParent, {});

    expect(found.settings).toEqual({ a: 1 });
  });

  it('should keep the raw text when a JSON column does not hold JSON', async () => {
    const querier = new StubSqlQuerier();
    querier.rows = [{ id: 1, settings: 'not json' }];

    const [found] = await querier.findMany(HydratedParent, {});

    expect(found.settings).toBe('not json');
  });

  it('should parse JSON columns of a joined to-one relation', async () => {
    const querier = new StubSqlQuerier();
    querier.rows = [{ id: 2, payload: '{"b":2}', 'parent.id': 1, 'parent.settings': '{"a":1}' }];

    const [found] = await querier.findMany(HydratedChild, { $populate: { parent: true } });

    expect(found.payload).toEqual({ b: 2 });
    expect(found.parent?.settings).toEqual({ a: 1 });
  });

  /** A to-many relation arrives as an array of rows, each needing the same treatment. */
  it('should parse JSON columns of every element of a to-many relation', async () => {
    const querier = new StubSqlQuerier();
    querier.rows = [
      {
        id: 1,
        settings: '{"a":1}',
        children: [
          { id: 2, payload: '{"b":2}' },
          { id: 3, payload: '{"b":3}' },
        ],
      },
    ];

    const [found] = await querier.findMany(HydratedParent, {});

    expect(found.children).toEqual([
      { id: 2, payload: { b: 2 } },
      { id: 3, payload: { b: 3 } },
    ]);
  });

  /** A back-reference makes the row graph cyclic; hydration walks each object once. */
  it('should hydrate a cyclic row graph without recursing forever', async () => {
    const querier = new StubSqlQuerier();
    const child: RawRow = { id: 2, payload: '{"b":2}' };
    const row: RawRow = { id: 1, settings: '{"a":1}', children: [child] };
    child['parent'] = row;
    querier.rows = [row];

    const [found] = await querier.findMany(HydratedParent, {});

    expect(found.settings).toEqual({ a: 1 });
    expect(found.children?.[0].payload).toEqual({ b: 2 });
  });
});

describe('AbstractSqlQuerier error context', () => {
  /** Drains a stream query and returns the error the stub driver ends it with. */
  function streamError(querier: StubSqlQuerier, name?: string): Promise<QueryError> {
    const consume = async () => {
      for await (const _row of querier.findManyStream(HydratedParent, { $where: { name } })) {
        // drain until the stub driver throws
      }
    };
    return consume().then(
      () => expect.unreachable('the stub driver must end the stream with an error'),
      (err: QueryError) => err,
    );
  }

  /** Transaction statements are not run through `timed()`, so they attach their own query context. */
  it('should attach the failing BEGIN statement to the error', async () => {
    const querier = new StubSqlQuerier();
    querier.failOn = 'BEGIN TRANSACTION';

    await expect(querier.beginTransaction()).rejects.toMatchObject({ query: 'BEGIN TRANSACTION' });
    expect(querier.hasOpenTransaction).toBe(false);
  });

  it.each([
    ['COMMIT', (querier: StubSqlQuerier) => querier.commitTransaction()],
    ['ROLLBACK', (querier: StubSqlQuerier) => querier.rollbackTransaction()],
  ] as const)('should attach the failing %s statement to the error', async (statement, act) => {
    const querier = new StubSqlQuerier();
    await querier.beginTransaction();
    querier.failOn = statement;

    await expect(act(querier)).rejects.toMatchObject({ query: statement });
    // Still open, because the statement that would have ended it failed: a COMMIT can be refused with
    // the transaction left running, and something still has to roll that back.
    expect(querier.hasOpenTransaction).toBe(true);
  });

  /** The rollback a refused COMMIT still needs, which `release()` reaches on the way out. */
  it('should roll back a transaction whose COMMIT was refused', async () => {
    const querier = new StubSqlQuerier();
    await querier.beginTransaction();
    querier.failOn = 'COMMIT';

    await expect(querier.commitTransaction()).rejects.toMatchObject({ query: 'COMMIT' });
    querier.failOn = undefined;
    await querier.release();

    expect(querier.handedBackWithOpenTransaction).toBe(false);
    expect(querier.releases).toBe(1);
  });

  /**
   * The rollback failure is a consequence of the original error, so it must neither replace it nor
   * strand the connection. It used to do both: the flag stayed set, so `withQuerier`'s `finally` hit
   * `release()`, which threw `pending transaction` over the real error and returned nothing to the pool.
   */
  it('should keep the original error and still release when the ROLLBACK fails too', async () => {
    const querier = new StubSqlQuerier();
    const pool = createMockQuerierPool(new SqliteDialect({}), async () => querier);

    await expect(
      pool.transaction(async () => {
        querier.failOn = 'ROLLBACK';
        throw new TypeError('what actually went wrong');
      }),
    ).rejects.toThrow('what actually went wrong');

    expect(querier.releases).toBe(1);
  });

  /**
   * Handing the connection back is the whole job of `release`, so a rollback that fails on the way
   * cannot be allowed to skip it. Reported through the logger rather than thrown, since the caller is
   * usually already unwinding the error that left the transaction open.
   */
  it('should still release when the rollback it does on the way out fails', async () => {
    const logError = vi.fn();
    const querier = new StubSqlQuerier({ logger: { logError } });
    await querier.beginTransaction();
    querier.failOn = 'ROLLBACK';

    await expect(querier.release()).resolves.toBeUndefined();

    expect(querier.releases).toBe(1);
    expect(logError).toHaveBeenCalled();
  });

  it('should attach the query of a failed stream', async () => {
    const querier = new StubSqlQuerier();
    querier.rows = [{ id: 1, settings: '{"a":1}' }];

    const err = await streamError(querier);

    expect(err.query).toContain('SELECT');
    expect(err.values).toBeUndefined();
  });

  /** Bound values can carry PII, so they ride along only when the app already logs them. */
  it('should attach the values of a failed stream when the logger surfaces them', async () => {
    const querier = new StubSqlQuerier({ logger: { logQuery: vi.fn() }, logValues: true });

    const err = await streamError(querier, 'maz');

    expect(err.values).toEqual(['maz']);
  });

  it('should rethrow a non-Error driver rejection untouched', async () => {
    const querier = new StubSqlQuerier();
    await querier.beginTransaction();
    querier.failOn = 'COMMIT';
    querier.failure = 'plain string failure';

    await expect(querier.commitTransaction()).rejects.toBe('plain string failure');
  });
});
