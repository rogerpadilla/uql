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
import { currentTransaction } from './transaction.js';

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

  /** The querier of the transaction this flow runs in, where this pool handed it out. */
  private ambientQuerier(): Q | undefined {
    const querier = currentTransaction()?.querier;
    return querier && this.isOwn(querier) ? querier : undefined;
  }

  /** Whether this pool handed `querier` out: each pool builds a dialect of its own, which its queriers carry. */
  private isOwn(querier: Querier): querier is Q {
    return 'dialect' in querier && querier.dialect === this.dialect;
  }

  /** Runs `callback` in a transaction on a querier of the pool, or as a savepoint of the one this flow runs in. */
  transaction<T>(callback: (querier: Q) => Promise<T>, opts?: TransactionOptions & PoolRunOptions): Promise<T> {
    return this.withQuerier((querier) => querier.transaction(() => callback(querier), opts), opts);
  }

  /**
   * get a querier from the pool, run the given callback, and release the querier.
   */
  async withQuerier<T>(callback: (querier: Q) => Promise<T>, opts?: PoolRunOptions): Promise<T> {
    const ambient = this.ambientQuerier();
    if (ambient) {
      return this.runScoped(opts?.context, () => callback(ambient));
    }
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

  readonly findOneById: UniversalQuerier['findOneById'] = (...args) =>
    this.withQuerier((querier) => querier.findOneById(...args));
  readonly findOne: UniversalQuerier['findOne'] = (...args) => this.withQuerier((querier) => querier.findOne(...args));
  readonly findMany: UniversalQuerier['findMany'] = (...args) =>
    this.withQuerier((querier) => querier.findMany(...args));

  /**
   * The connection outlives the call: it is held until the iterator is drained or closed by a `break` or
   * `throw`. Abandoning the iterator leaks it, so consume it in a `for await`.
   */
  readonly findManyStream: UniversalQuerier['findManyStream'] = (...args) =>
    this.streamWithQuerier((querier) => querier.findManyStream(...args));

  private async *streamWithQuerier<T>(read: (querier: Q) => AsyncIterable<T>): AsyncGenerator<T> {
    const ambient = this.ambientQuerier();
    if (ambient) {
      yield* read(ambient);
      return;
    }
    await using querier = await this.getQuerier();
    yield* read(querier);
  }

  readonly findManyAndCount: UniversalQuerier['findManyAndCount'] = (...args) =>
    this.withQuerier((querier) => querier.findManyAndCount(...args));
  readonly findManyPage: UniversalQuerier['findManyPage'] = (...args) =>
    this.withQuerier((querier) => querier.findManyPage(...args));
  readonly count: UniversalQuerier['count'] = (...args) => this.withQuerier((querier) => querier.count(...args));
  readonly exists: UniversalQuerier['exists'] = (...args) => this.withQuerier((querier) => querier.exists(...args));
  readonly aggregate: UniversalQuerier['aggregate'] = (...args) =>
    this.withQuerier((querier) => querier.aggregate(...args));
  readonly estimatedCount: UniversalQuerier['estimatedCount'] = (...args) =>
    this.withQuerier((querier) => querier.estimatedCount(...args));
  readonly insertOne: UniversalQuerier['insertOne'] = (...args) =>
    this.withQuerier((querier) => querier.insertOne(...args));
  readonly insertMany: UniversalQuerier['insertMany'] = (...args) =>
    this.withQuerier((querier) => querier.insertMany(...args));
  readonly updateOneById: UniversalQuerier['updateOneById'] = (...args) =>
    this.withQuerier((querier) => querier.updateOneById(...args));
  readonly updateMany: UniversalQuerier['updateMany'] = (...args) =>
    this.withQuerier((querier) => querier.updateMany(...args));
  readonly upsertOne: UniversalQuerier['upsertOne'] = (...args) =>
    this.withQuerier((querier) => querier.upsertOne(...args));
  readonly upsertMany: UniversalQuerier['upsertMany'] = (...args) =>
    this.withQuerier((querier) => querier.upsertMany(...args));
  readonly saveOne: UniversalQuerier['saveOne'] = (...args) => this.withQuerier((querier) => querier.saveOne(...args));
  readonly saveMany: UniversalQuerier['saveMany'] = (...args) =>
    this.withQuerier((querier) => querier.saveMany(...args));
  readonly deleteOneById: UniversalQuerier['deleteOneById'] = (...args) =>
    this.withQuerier((querier) => querier.deleteOneById(...args));
  readonly deleteMany: UniversalQuerier['deleteMany'] = (...args) =>
    this.withQuerier((querier) => querier.deleteMany(...args));
  readonly restoreOneById: UniversalQuerier['restoreOneById'] = (...args) =>
    this.withQuerier((querier) => querier.restoreOneById(...args));
  readonly restoreMany: UniversalQuerier['restoreMany'] = (...args) =>
    this.withQuerier((querier) => querier.restoreMany(...args));

  /**
   * end the pool.
   */
  abstract end(): Promise<void>;
}
