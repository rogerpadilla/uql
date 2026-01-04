import type { AbstractSqlDialect } from '../dialect/index.js';
import type { ExtraOptions } from '../type/index.js';
import { AbstractSqlQuerier } from './abstractSqlQuerier.js';

export abstract class AbstractPoolQuerier<C> extends AbstractSqlQuerier {
  protected conn?: C;

  constructor(
    dialect: AbstractSqlDialect,
    protected readonly connect: () => Promise<C>,
    override readonly extra?: ExtraOptions,
  ) {
    super(dialect, extra);
  }

  protected async lazyConnect() {
    this.conn ??= await this.connect();
  }

  override async internalRelease() {
    if (this.hasOpenTransaction) {
      throw TypeError('pending transaction');
    }
    if (!this.conn) {
      return;
    }
    await this.releaseConn(this.conn);
    this.conn = undefined;
  }

  protected abstract releaseConn(conn: C): Promise<void>;
}
