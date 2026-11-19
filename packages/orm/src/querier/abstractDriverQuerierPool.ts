import type { AbstractSqlDialect } from '../dialect/index.js';
import type { DriverPoolOptions, SqlQuerier } from '../type/index.js';
import { AbstractSqlQuerierPool } from './abstractSqlQuerierPool.js';

/**
 * A pool over a driver's own pools, `open`ed alike from a config each: the primary's, and one per read replica, which
 * a read and a `readOnly` unit of work run on. Their queriers share the pool's dialect and options, so a call inside
 * a transaction on any of them runs on its querier.
 */
export abstract class AbstractDriverQuerierPool<
  C,
  P,
  Q extends SqlQuerier,
  D extends AbstractSqlDialect,
> extends AbstractSqlQuerierPool<Q, D> {
  protected readonly primary: P;
  private readonly replicas: readonly P[];

  constructor(dialect: D, config: C, extra: DriverPoolOptions<C> | undefined, open: (config: C) => P) {
    // The replicas' configs hold credentials, so they stay out of the options every querier is handed.
    const { replicas = [], ...options } = extra ?? {};
    super(dialect, options);
    this.primary = open(config);
    this.replicas = replicas.map(open);
  }

  /** A querier on one of the driver's pools. */
  protected abstract querierOn(pool: P): Q;

  /** Closes one of the driver's pools. */
  protected abstract close(pool: P): Promise<void>;

  async getQuerier(): Promise<Q> {
    return this.querierOn(this.primary);
  }

  /** On a replica, any one, at random; on the primary where there is none. */
  protected override async getReadQuerier(): Promise<Q> {
    const { replicas } = this;
    return this.querierOn(replicas.length ? replicas[Math.floor(Math.random() * replicas.length)] : this.primary);
  }

  override async end(): Promise<void> {
    await Promise.all([this.primary, ...this.replicas].map((pool) => this.close(pool)));
  }
}
