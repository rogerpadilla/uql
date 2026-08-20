import type { AbstractSqlDialect } from '../dialect/index.js';
import type { ExtraOptions } from '../type/index.js';
import { AbstractSqlQuerier } from './abstractSqlQuerier.js';

export abstract class AbstractPoolQuerier<C> extends AbstractSqlQuerier {
  protected conn: C | undefined;

  protected getConn(): C {
    if (!this.conn) throw new TypeError('pool querier not connected');
    return this.conn;
  }

  constructor(
    dialect: AbstractSqlDialect,
    protected readonly connect: () => Promise<C>,
    override readonly extra?: ExtraOptions,
  ) {
    super(dialect, extra);
  }

  protected override async lazyConnect() {
    await super.lazyConnect();
    this.conn ??= await this.connect();
  }

  override async internalRelease(discard: boolean) {
    const conn = this.conn;
    if (!conn) {
      return;
    }
    // Cleared even when the hand-back fails: keeping a connection the pool has already been given
    // back means the next `release()` returns it twice, which pg reports as an already-released client.
    this.conn = undefined;
    await this.releaseConn(conn, discard);
  }

  protected abstract releaseConn(conn: C, discard: boolean): Promise<void>;
}
