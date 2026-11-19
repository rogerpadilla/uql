import { withContext } from '../context/context.js';
import type { AbstractDialect } from '../dialect/index.js';
import {
  type ExtraOptions,
  type PoolRunOptions,
  opDoes,
  type Querier,
  type QuerierPool,
  type TransactionOptions,
  type UniversalQuerier,
  type UqlContext,
} from '../type/index.js';
import { currentTransaction } from './transaction.js';

/**
 * Base pool: dialect id and behavior come only from the `dialect` instance (see {@link QuerierPool}).
 */
export abstract class AbstractQuerierPool<Q extends Querier, D extends AbstractDialect> implements QuerierPool<Q, D> {
  constructor(
    readonly dialect: D,
    readonly extra?: ExtraOptions,
  ) {
    // Reading `policies` refuses a mode the engine cannot hold: read now, the pool is refused when built.
    void dialect.policies;
  }

  /**
   * get a querier from the pool.
   */
  abstract getQuerier(): Promise<Q>;

  /** The querier a read runs on outside a transaction: {@link getQuerier}'s, unless the pool reads elsewhere. */
  protected getReadQuerier(): Promise<Q> {
    return this.getQuerier();
  }

  getMigrationQuerier(): Promise<Q> {
    return this.getQuerier();
  }

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
   * Runs `callback` on the querier of the transaction this flow runs in, else on one acquired for it, a replica's
   * where the work is `readOnly` and the pool has some, and released after.
   */
  async withQuerier<T>(callback: (querier: Q) => Promise<T>, opts?: PoolRunOptions): Promise<T> {
    await using lent = await this.lend(opts?.readOnly);
    return await this.runScoped(opts?.context, () => callback(lent.querier));
  }

  /** Lends the querier of the transaction this flow runs in, kept, or an acquired one, released on dispose. */
  private async lend(readOnly: boolean | undefined): Promise<AsyncDisposable & { readonly querier: Q }> {
    const ambient = this.ambientQuerier();
    if (ambient) {
      return { querier: ambient, [Symbol.asyncDispose]: async () => {} };
    }
    const querier = await (readOnly ? this.getReadQuerier() : this.getQuerier());
    return { querier, [Symbol.asyncDispose]: () => querier[Symbol.asyncDispose]() };
  }

  /** Runs `op` as {@link withQuerier} does, read-only where it only reads. */
  private perform<T>(op: keyof UniversalQuerier, callback: (querier: Q) => Promise<T>): Promise<T> {
    return this.withQuerier(callback, { readOnly: opDoes(op, 'read') });
  }

  /** Run `fn` under `context` (an enclosing {@link withContext}) when provided, else run it as-is. */
  private runScoped<T>(context: UqlContext | undefined, fn: () => Promise<T>): Promise<T> {
    return context ? withContext(context, fn) : fn();
  }

  readonly findOneById: UniversalQuerier['findOneById'] = (...args) =>
    this.perform('findOneById', (querier) => querier.findOneById(...args));
  readonly findOne: UniversalQuerier['findOne'] = (...args) =>
    this.perform('findOne', (querier) => querier.findOne(...args));
  readonly findMany: UniversalQuerier['findMany'] = (...args) =>
    this.perform('findMany', (querier) => querier.findMany(...args));

  /**
   * The connection outlives the call: it is held until the iterator is drained or closed by a `break` or
   * `throw`. Abandoning the iterator leaks it, so consume it in a `for await`.
   */
  readonly findManyStream: UniversalQuerier['findManyStream'] = (...args) =>
    this.stream('findManyStream', (querier) => querier.findManyStream(...args));

  /** Streams `op` as {@link perform} runs one, on a querier held to the end of the iterator. */
  private async *stream<T>(op: keyof UniversalQuerier, read: (querier: Q) => AsyncIterable<T>): AsyncGenerator<T> {
    await using lent = await this.lend(opDoes(op, 'read'));
    yield* read(lent.querier);
  }

  readonly findManyAndCount: UniversalQuerier['findManyAndCount'] = (...args) =>
    this.perform('findManyAndCount', (querier) => querier.findManyAndCount(...args));
  readonly findManyPage: UniversalQuerier['findManyPage'] = (...args) =>
    this.perform('findManyPage', (querier) => querier.findManyPage(...args));
  readonly count: UniversalQuerier['count'] = (...args) => this.perform('count', (querier) => querier.count(...args));
  readonly exists: UniversalQuerier['exists'] = (...args) =>
    this.perform('exists', (querier) => querier.exists(...args));
  readonly aggregate: UniversalQuerier['aggregate'] = (...args) =>
    this.perform('aggregate', (querier) => querier.aggregate(...args));
  readonly estimatedCount: UniversalQuerier['estimatedCount'] = (...args) =>
    this.perform('estimatedCount', (querier) => querier.estimatedCount(...args));
  readonly insertOne: UniversalQuerier['insertOne'] = (...args) =>
    this.perform('insertOne', (querier) => querier.insertOne(...args));
  readonly insertMany: UniversalQuerier['insertMany'] = (...args) =>
    this.perform('insertMany', (querier) => querier.insertMany(...args));
  readonly updateOneById: UniversalQuerier['updateOneById'] = (...args) =>
    this.perform('updateOneById', (querier) => querier.updateOneById(...args));
  readonly updateMany: UniversalQuerier['updateMany'] = (...args) =>
    this.perform('updateMany', (querier) => querier.updateMany(...args));
  readonly upsertOne: UniversalQuerier['upsertOne'] = (...args) =>
    this.perform('upsertOne', (querier) => querier.upsertOne(...args));
  readonly upsertMany: UniversalQuerier['upsertMany'] = (...args) =>
    this.perform('upsertMany', (querier) => querier.upsertMany(...args));
  readonly saveOne: UniversalQuerier['saveOne'] = (...args) =>
    this.perform('saveOne', (querier) => querier.saveOne(...args));
  readonly saveMany: UniversalQuerier['saveMany'] = (...args) =>
    this.perform('saveMany', (querier) => querier.saveMany(...args));
  readonly deleteOneById: UniversalQuerier['deleteOneById'] = (...args) =>
    this.perform('deleteOneById', (querier) => querier.deleteOneById(...args));
  readonly deleteMany: UniversalQuerier['deleteMany'] = (...args) =>
    this.perform('deleteMany', (querier) => querier.deleteMany(...args));
  readonly restoreOneById: UniversalQuerier['restoreOneById'] = (...args) =>
    this.perform('restoreOneById', (querier) => querier.restoreOneById(...args));
  readonly restoreMany: UniversalQuerier['restoreMany'] = (...args) =>
    this.perform('restoreMany', (querier) => querier.restoreMany(...args));

  /** Closes what the pool holds: nothing where each querier closes its own connection, or there is none to close. */
  async end(): Promise<void> {}
}
