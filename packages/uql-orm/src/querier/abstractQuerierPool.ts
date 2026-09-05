import { withContext } from '../context/context.js';
import type { AbstractDialect } from '../dialect/index.js';
import type {
  EntityData,
  EntityId,
  ExtraOptions,
  FieldKey,
  IdValue,
  PoolRunOptions,
  Querier,
  QuerierPool,
  QueryAggMap,
  QueryAggregate,
  QueryAggregateResult,
  QueryConflictPaths,
  QueryFilter,
  QueryFindResult,
  QueryGroupMap,
  QueryOneProjected,
  QueryOptions,
  QueryPage,
  QueryProjected,
  QuerySearch,
  QueryStreamProjected,
  QueryUpdateResult,
  RelationKey,
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

  findOneById<
    E extends object,
    const S extends FieldKey<E> = never,
    const V = true,
    const X extends FieldKey<E> = never,
    const P extends RelationKey<E> = never,
    const C extends RelationKey<E> = never,
  >(
    entity: Type<E>,
    id: EntityId<E>,
    q?: QueryOneProjected<E, S, V, X, P, C>,
    opts?: QueryOptions,
  ): Promise<QueryFindResult<E, S, V, X, P, C> | undefined> {
    return this.withQuerier((querier) => querier.findOneById(entity, id, q, opts));
  }

  findOne<
    E extends object,
    const S extends FieldKey<E> = never,
    const V = true,
    const X extends FieldKey<E> = never,
    const P extends RelationKey<E> = never,
    const C extends RelationKey<E> = never,
  >(
    entity: Type<E>,
    q: QueryOneProjected<E, S, V, X, P, C>,
    opts?: QueryOptions,
  ): Promise<QueryFindResult<E, S, V, X, P, C> | undefined> {
    return this.withQuerier((querier) => querier.findOne(entity, q, opts));
  }

  findMany<
    E extends object,
    const S extends FieldKey<E> = never,
    const V = true,
    const X extends FieldKey<E> = never,
    const P extends RelationKey<E> = never,
    const C extends RelationKey<E> = never,
  >(
    entity: Type<E>,
    q: QueryProjected<E, S, V, X, P, C>,
    opts?: QueryOptions,
  ): Promise<QueryFindResult<E, S, V, X, P, C>[]> {
    return this.withQuerier((querier) => querier.findMany(entity, q, opts));
  }

  /**
   * The connection outlives the call here: it is held until the iterator is drained or closed by a
   * `break`/`throw`. Abandoning the iterator instead leaks it until GC, so consume it in a `for await`.
   */
  async *findManyStream<
    E extends object,
    const S extends FieldKey<E> = never,
    const V = true,
    const X extends FieldKey<E> = never,
    const P extends RelationKey<E> = never,
  >(
    entity: Type<E>,
    q: QueryStreamProjected<E, S, V, X, P>,
    opts?: QueryOptions,
  ): AsyncGenerator<QueryFindResult<E, S, V, X, P>> {
    await using querier = await this.getQuerier();
    yield* querier.findManyStream(entity, q, opts);
  }

  findManyAndCount<
    E extends object,
    const S extends FieldKey<E> = never,
    const V = true,
    const X extends FieldKey<E> = never,
    const P extends RelationKey<E> = never,
    const C extends RelationKey<E> = never,
  >(
    entity: Type<E>,
    q: QueryProjected<E, S, V, X, P, C>,
    opts?: QueryOptions,
  ): Promise<[QueryFindResult<E, S, V, X, P, C>[], number]> {
    return this.withQuerier((querier) => querier.findManyAndCount(entity, q, opts));
  }

  count<E extends object>(entity: Type<E>, q?: QueryPage<E>, opts?: QueryOptions): Promise<number> {
    return this.withQuerier((querier) => querier.count(entity, q, opts));
  }

  exists<E extends object>(entity: Type<E>, q?: QueryFilter<E>, opts?: QueryOptions): Promise<boolean> {
    return this.withQuerier((querier) => querier.exists(entity, q, opts));
  }

  aggregate<E extends object, const G extends QueryGroupMap<E>, const A extends QueryAggMap<E>>(
    entity: Type<E>,
    q: QueryAggregate<E, G, A>,
    opts?: QueryOptions,
  ): Promise<QueryAggregateResult<E, G, A>[]> {
    return this.withQuerier((querier) => querier.aggregate(entity, q, opts));
  }

  estimatedCount<E extends object>(entity: Type<E>): Promise<number> {
    return this.withQuerier((querier) => querier.estimatedCount(entity));
  }

  insertOne<E extends object>(entity: Type<E>, payload: EntityData<E>): Promise<IdValue<E> | undefined> {
    return this.withQuerier((querier) => querier.insertOne(entity, payload));
  }

  insertMany<E extends object>(entity: Type<E>, payload: EntityData<E>[]): Promise<(IdValue<E> | undefined)[]> {
    return this.withQuerier((querier) => querier.insertMany(entity, payload));
  }

  updateOneById<E extends object>(
    entity: Type<E>,
    id: EntityId<E>,
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

  saveOne<E extends object>(entity: Type<E>, payload: EntityData<E>): Promise<IdValue<E> | undefined> {
    return this.withQuerier((querier) => querier.saveOne(entity, payload));
  }

  saveMany<E extends object>(entity: Type<E>, payload: EntityData<E>[]): Promise<(IdValue<E> | undefined)[]> {
    return this.withQuerier((querier) => querier.saveMany(entity, payload));
  }

  deleteOneById<E extends object>(entity: Type<E>, id: EntityId<E>, opts?: QueryOptions): Promise<number> {
    return this.withQuerier((querier) => querier.deleteOneById(entity, id, opts));
  }

  deleteMany<E extends object>(entity: Type<E>, q: QuerySearch<E>, opts?: QueryOptions): Promise<number> {
    return this.withQuerier((querier) => querier.deleteMany(entity, q, opts));
  }

  restoreOneById<E extends object>(entity: Type<E>, id: EntityId<E>): Promise<number> {
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
