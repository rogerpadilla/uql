import { withContext } from '../context/context.js';
import type { AbstractDialect } from '../dialect/index.js';
import type {
  ExtraOptions,
  IdValue,
  PoolRunOptions,
  Querier,
  QuerierPool,
  Query,
  QueryAggMap,
  QueryAggregate,
  QueryAggregateResult,
  QueryGroupMap,
  QueryOne,
  QueryOptions,
  QuerySearch,
  TransactionOptions,
  Type,
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
   */
  async transaction<T>(callback: (querier: Q) => Promise<T>, opts?: TransactionOptions & PoolRunOptions): Promise<T> {
    const querier = await this.getQuerier();
    return this.runScoped(opts?.context, () => querier.transaction(() => callback(querier), opts));
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

  findManyAndCount<E extends object>(entity: Type<E>, q: Query<E>, opts?: QueryOptions): Promise<[E[], number]> {
    return this.withQuerier((querier) => querier.findManyAndCount(entity, q, opts));
  }

  count<E extends object>(entity: Type<E>, q: QuerySearch<E>, opts?: QueryOptions): Promise<number> {
    return this.withQuerier((querier) => querier.count(entity, q, opts));
  }

  aggregate<E extends object, const G extends QueryGroupMap<E>, const A extends QueryAggMap<E>>(
    entity: Type<E>,
    q: QueryAggregate<E, G, A>,
    opts?: QueryOptions,
  ): Promise<QueryAggregateResult<E, G, A>[]> {
    return this.withQuerier((querier) => querier.aggregate(entity, q, opts));
  }

  /**
   * end the pool.
   */
  abstract end(): Promise<void>;
}
