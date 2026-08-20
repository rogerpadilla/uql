import { withContext } from '../context/context.js';
import type { AbstractDialect } from '../dialect/index.js';
import type {
  EntityData,
  ExtraOptions,
  IdValue,
  PoolRunOptions,
  Querier,
  QuerierPool,
  Query,
  QueryAggMap,
  QueryAggregate,
  QueryAggregateResult,
  QueryConflictPaths,
  QueryGroupMap,
  QueryOne,
  QueryOptions,
  QuerySearch,
  QueryUpdateResult,
  TransactionOptions,
  Type,
  UpdatePayload,
  UqlContext,
} from '../type/index.js';

/**
 * Base pool: dialect id and behavior come only from the `dialect` instance (see {@link QuerierPool}).
 */
export abstract class AbstractQuerierPool<Q extends Querier, D extends AbstractDialect> implements QuerierPool<Q, D> {
  constructor(
    readonly dialect: D,
    readonly extra?: ExtraOptions,
  ) {}

  /**
   * get a querier from the pool.
   */
  abstract getQuerier(): Promise<Q>;

  /**
   * get a querier from the pool and run the given callback inside a transaction.
   *
   * The pool acquired the connection, so the pool releases it: `withQuerier` owns that half and
   * `querier.transaction` owns begin/commit/rollback. Neither knows about the other's job.
   */
  transaction<T>(callback: (querier: Q) => Promise<T>, opts?: TransactionOptions & PoolRunOptions): Promise<T> {
    return this.withQuerier((querier) => querier.transaction(() => callback(querier), opts), opts);
  }

  /**
   * get a querier from the pool, run the given callback, and release the querier.
   */
  async withQuerier<T>(callback: (querier: Q) => Promise<T>, opts?: PoolRunOptions): Promise<T> {
    const querier = await this.getQuerier();
    try {
      return await this.runScoped(opts?.context, () => callback(querier));
    } finally {
      await querier.release();
    }
  }

  /** Run `fn` under `context` (an enclosing {@link withContext}) when provided, else run it as-is. */
  private runScoped<T>(context: UqlContext | undefined, fn: () => Promise<T>): Promise<T> {
    return context ? withContext(context, fn) : fn();
  }

  findOneById<E extends object>(
    entity: Type<E>,
    id: IdValue<E>,
    q?: QueryOne<E>,
    opts?: QueryOptions,
  ): Promise<E | undefined> {
    return this.withQuerier((querier) => querier.findOneById(entity, id, q, opts));
  }

  findOne<E extends object>(entity: Type<E>, q: QueryOne<E>, opts?: QueryOptions): Promise<E | undefined> {
    return this.withQuerier((querier) => querier.findOne(entity, q, opts));
  }

  findMany<E extends object>(entity: Type<E>, q: Query<E>, opts?: QueryOptions): Promise<E[]> {
    return this.withQuerier((querier) => querier.findMany(entity, q, opts));
  }

  /**
   * The connection outlives the call here: it is held until the iterator is drained or closed by a
   * `break`/`throw`. Abandoning the iterator instead leaks it until GC, so consume it in a `for await`.
   */
  async *findManyStream<E extends object>(entity: Type<E>, q: Query<E>, opts?: QueryOptions): AsyncGenerator<E> {
    await using querier = await this.getQuerier();
    yield* querier.findManyStream(entity, q, opts);
  }

  findManyAndCount<E extends object>(entity: Type<E>, q: Query<E>, opts?: QueryOptions): Promise<[E[], number]> {
    return this.withQuerier((querier) => querier.findManyAndCount(entity, q, opts));
  }

  count<E extends object>(entity: Type<E>, q?: QuerySearch<E>, opts?: QueryOptions): Promise<number> {
    return this.withQuerier((querier) => querier.count(entity, q, opts));
  }

  aggregate<E extends object, const G extends QueryGroupMap<E>, const A extends QueryAggMap<E>>(
    entity: Type<E>,
    q: QueryAggregate<E, G, A>,
    opts?: QueryOptions,
  ): Promise<QueryAggregateResult<E, G, A>[]> {
    return this.withQuerier((querier) => querier.aggregate(entity, q, opts));
  }

  insertOne<E extends object>(entity: Type<E>, payload: EntityData<E>): Promise<IdValue<E> | undefined> {
    return this.withQuerier((querier) => querier.insertOne(entity, payload));
  }

  insertMany<E extends object>(entity: Type<E>, payload: EntityData<E>[]): Promise<IdValue<E>[]> {
    return this.withQuerier((querier) => querier.insertMany(entity, payload));
  }

  updateOneById<E extends object>(
    entity: Type<E>,
    id: IdValue<E>,
    payload: UpdatePayload<E>,
    opts?: QueryOptions,
  ): Promise<number> {
    return this.withQuerier((querier) => querier.updateOneById(entity, id, payload, opts));
  }

  updateMany<E extends object>(
    entity: Type<E>,
    q: QuerySearch<E>,
    payload: UpdatePayload<E>,
    opts?: QueryOptions,
  ): Promise<number> {
    return this.withQuerier((querier) => querier.updateMany(entity, q, payload, opts));
  }

  upsertOne<E extends object>(
    entity: Type<E>,
    conflictPaths: QueryConflictPaths<E>,
    payload: EntityData<E>,
  ): Promise<QueryUpdateResult> {
    return this.withQuerier((querier) => querier.upsertOne(entity, conflictPaths, payload));
  }

  upsertMany<E extends object>(
    entity: Type<E>,
    conflictPaths: QueryConflictPaths<E>,
    payload: EntityData<E>[],
  ): Promise<QueryUpdateResult> {
    return this.withQuerier((querier) => querier.upsertMany(entity, conflictPaths, payload));
  }

  saveOne<E extends object>(entity: Type<E>, payload: EntityData<E>): Promise<IdValue<E>> {
    return this.withQuerier((querier) => querier.saveOne(entity, payload));
  }

  saveMany<E extends object>(entity: Type<E>, payload: EntityData<E>[]): Promise<IdValue<E>[]> {
    return this.withQuerier((querier) => querier.saveMany(entity, payload));
  }

  deleteOneById<E extends object>(entity: Type<E>, id: IdValue<E>, opts?: QueryOptions): Promise<number> {
    return this.withQuerier((querier) => querier.deleteOneById(entity, id, opts));
  }

  deleteMany<E extends object>(entity: Type<E>, q: QuerySearch<E>, opts?: QueryOptions): Promise<number> {
    return this.withQuerier((querier) => querier.deleteMany(entity, q, opts));
  }

  restoreOneById<E extends object>(entity: Type<E>, id: IdValue<E>): Promise<number> {
    return this.withQuerier((querier) => querier.restoreOneById(entity, id));
  }

  restoreMany<E extends object>(entity: Type<E>, q: QuerySearch<E>): Promise<number> {
    return this.withQuerier((querier) => querier.restoreMany(entity, q));
  }

  /**
   * end the pool.
   */
  abstract end(): Promise<void>;
}
