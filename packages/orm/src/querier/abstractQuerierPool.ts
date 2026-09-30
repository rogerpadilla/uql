import { withContext } from '../context/context.js';
import type { AbstractDialect } from '../dialect/index.js';
import type {
  ExtraOptions,
  PoolRunOptions,
  Querier,
  QuerierPool,
  TransactionOptions,
  UniversalQuerier,
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

  readonly findOneById: UniversalQuerier['findOneById'] = (entity, id, q, opts) =>
    this.withQuerier((querier) => querier.findOneById(entity, id, q, opts));
  readonly findOne: UniversalQuerier['findOne'] = (entity, q, opts) =>
    this.withQuerier((querier) => querier.findOne(entity, q, opts));
  readonly findMany: UniversalQuerier['findMany'] = (entity, q, opts) =>
    this.withQuerier((querier) => querier.findMany(entity, q, opts));

  /**
   * The connection outlives the call: it is held until the iterator is drained or closed by a `break` or
   * `throw`. Abandoning the iterator leaks it until GC, so consume it in a `for await`.
   */
  readonly findManyStream: UniversalQuerier['findManyStream'] = (entity, q, opts) =>
    this.streamWithQuerier((querier) => querier.findManyStream(entity, q, opts));

  private async *streamWithQuerier<T>(read: (querier: Q) => AsyncIterable<T>): AsyncGenerator<T> {
    await using querier = await this.getQuerier();
    yield* read(querier);
  }

  readonly findManyAndCount: UniversalQuerier['findManyAndCount'] = (entity, q, opts) =>
    this.withQuerier((querier) => querier.findManyAndCount(entity, q, opts));
  readonly findManyPage: UniversalQuerier['findManyPage'] = (entity, q, opts) =>
    this.withQuerier((querier) => querier.findManyPage(entity, q, opts));
  readonly count: UniversalQuerier['count'] = (entity, q, opts) =>
    this.withQuerier((querier) => querier.count(entity, q, opts));
  readonly exists: UniversalQuerier['exists'] = (entity, q, opts) =>
    this.withQuerier((querier) => querier.exists(entity, q, opts));
  readonly aggregate: UniversalQuerier['aggregate'] = (entity, q, opts) =>
    this.withQuerier((querier) => querier.aggregate(entity, q, opts));
  readonly estimatedCount: UniversalQuerier['estimatedCount'] = (entity) =>
    this.withQuerier((querier) => querier.estimatedCount(entity));
  readonly insertOne: UniversalQuerier['insertOne'] = (entity, payload) =>
    this.withQuerier((querier) => querier.insertOne(entity, payload));
  readonly insertMany: UniversalQuerier['insertMany'] = (entity, payload) =>
    this.withQuerier((querier) => querier.insertMany(entity, payload));
  readonly updateOneById: UniversalQuerier['updateOneById'] = (entity, id, payload, opts) =>
    this.withQuerier((querier) => querier.updateOneById(entity, id, payload, opts));
  readonly updateMany: UniversalQuerier['updateMany'] = (entity, q, payload, opts) =>
    this.withQuerier((querier) => querier.updateMany(entity, q, payload, opts));
  readonly upsertOne: UniversalQuerier['upsertOne'] = (entity, conflictPaths, payload) =>
    this.withQuerier((querier) => querier.upsertOne(entity, conflictPaths, payload));
  readonly upsertMany: UniversalQuerier['upsertMany'] = (entity, conflictPaths, payload) =>
    this.withQuerier((querier) => querier.upsertMany(entity, conflictPaths, payload));
  readonly saveOne: UniversalQuerier['saveOne'] = (entity, payload) =>
    this.withQuerier((querier) => querier.saveOne(entity, payload));
  readonly saveMany: UniversalQuerier['saveMany'] = (entity, payload) =>
    this.withQuerier((querier) => querier.saveMany(entity, payload));
  readonly deleteOneById: UniversalQuerier['deleteOneById'] = (entity, id, opts) =>
    this.withQuerier((querier) => querier.deleteOneById(entity, id, opts));
  readonly deleteMany: UniversalQuerier['deleteMany'] = (entity, q, opts) =>
    this.withQuerier((querier) => querier.deleteMany(entity, q, opts));
  readonly restoreOneById: UniversalQuerier['restoreOneById'] = (entity, id) =>
    this.withQuerier((querier) => querier.restoreOneById(entity, id));
  readonly restoreMany: UniversalQuerier['restoreMany'] = (entity, q) =>
    this.withQuerier((querier) => querier.restoreMany(entity, q));

  /**
   * end the pool.
   */
  abstract end(): Promise<void>;
}
