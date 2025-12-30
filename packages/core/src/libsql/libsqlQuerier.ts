import type { Client, InValue, Transaction } from '@libsql/client';
import { Serialized } from '../querier/decorator/index.js';
import { AbstractSqlQuerier } from '../querier/index.js';
import { SqliteDialect } from '../sqlite/index.js';
import type { ExtraOptions, QueryUpdateResult } from '../type/index.js';

export class LibsqlQuerier extends AbstractSqlQuerier {
  private tx?: Transaction;

  constructor(
    readonly client: Client,
    readonly extra?: ExtraOptions,
  ) {
    super(new SqliteDialect(extra?.namingStrategy));
  }

  override async internalAll<T>(query: string, values?: unknown[]) {
    this.extra?.logger?.(query, values);
    const target = this.tx || this.client;
    const res = await target.execute({ sql: query, args: values as InValue[] });
    return res.rows as T[];
  }

  override async internalRun(query: string, values?: unknown[]) {
    this.extra?.logger?.(query, values);
    const target = this.tx || this.client;
    const res = await target.execute({ sql: query, args: values as InValue[] });
    const changes = res.rowsAffected;
    const lastInsertRowid = res.lastInsertRowid;
    const firstId = lastInsertRowid ? Number(lastInsertRowid) - (changes - 1) : undefined;
    const ids = firstId
      ? Array(changes)
          .fill(firstId)
          .map((i, index) => i + index)
      : [];
    return { changes, ids, firstId } satisfies QueryUpdateResult;
  }

  override get hasOpenTransaction() {
    return !!this.tx;
  }

  @Serialized()
  override async beginTransaction() {
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
  }
}
