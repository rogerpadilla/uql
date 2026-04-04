import type { Client, InValue, Transaction } from '@libsql/client';
import { Serialized } from '../querier/decorator/index.js';
import { AbstractSqliteQuerier } from '../sqlite/abstractSqliteQuerier.js';
import type { SqliteDialect } from '../sqlite/sqliteDialect.js';
import type { ExtraOptions, TransactionOptions } from '../type/index.js';

/** Connection lifecycle for a {@link LibsqlQuerier} (separate from {@link ExtraOptions}). */
export type LibsqlQuerierConnectionOptions = {
  /** When set, {@link release} closes {@link LibsqlQuerier.client} (one-shot migration connections). */
  closeClientOnRelease?: boolean;
};

export class LibsqlQuerier extends AbstractSqliteQuerier {
  private tx?: Transaction;
  private readonly closeClientOnRelease: boolean;

  constructor(
    readonly client: Client,
    dialect: SqliteDialect,
    override readonly extra?: ExtraOptions,
    connection?: LibsqlQuerierConnectionOptions,
  ) {
    super(dialect, extra);
    this.closeClientOnRelease = connection?.closeClientOnRelease ?? false;
  }

  override async internalAll<T>(query: string, values?: unknown[]) {
    const target = this.tx || this.client;
    const res = await target.execute({ sql: query, args: values as InValue[] });
    return res.rows as T[];
  }

  override async internalRun(query: string, values?: unknown[]) {
    const target = this.tx || this.client;
    const res = await target.execute({ sql: query, args: values as InValue[] });
    return this.buildUpdateResult({ changes: res.rowsAffected, id: res.lastInsertRowid });
  }

  override get hasOpenTransaction() {
    return !!this.tx;
  }

  @Serialized()
  override async beginTransaction(_opts?: TransactionOptions) {
    if (this.tx) {
      throw TypeError('pending transaction');
    }
    this.tx = await this.client.transaction('write');
  }

  @Serialized()
  override async commitTransaction() {
    if (!this.tx) {
      throw TypeError('not a pending transaction');
    }
    await this.tx.commit();
    this.tx = undefined;
  }

  @Serialized()
  override async rollbackTransaction() {
    if (!this.tx) {
      throw TypeError('not a pending transaction');
    }
    await this.tx.rollback();
    this.tx = undefined;
  }

  override async internalRelease() {
    if (this.tx) {
      this.tx.close();
    }
    if (this.closeClientOnRelease) {
      this.client.close();
    }
  }
}
