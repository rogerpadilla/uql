import type { ReservedSQL, SQL } from 'bun';
import type { AbstractSqlDialect } from '../dialect/index.js';
import { AbstractPoolQuerier } from '../querier/abstractPoolQuerier.js';
import type { ExtraOptions } from '../type/index.js';
import { buildUpdateResult } from '../util/index.js';
import { type BunSqlResult, getAffectedRows, isReservedConnection } from './bunSql.util.js';

export class BunSqlQuerier extends AbstractPoolQuerier<ReservedSQL> {
  constructor(
    readonly sql: SQL,
    dialect: AbstractSqlDialect,
    connFactory: () => Promise<ReservedSQL>,
    override readonly extra?: ExtraOptions,
  ) {
    super(dialect, connFactory, extra);
  }

  override async internalAll<T>(query: string, values?: unknown[]) {
    // Safe: UQL parameters are strictly bound. .unsafe() correctly bypasses Bun's tagged template
    // literal parsing requirement so we can execute our dynamically compiled AST strings natively.
    return this.conn!.unsafe<BunSqlResult<T>>(query, values);
  }

  override async internalRun(query: string, values?: unknown[]) {
    // Safe: UQL parameters are strictly bound. .unsafe() correctly bypasses Bun's tagged template
    const res = await this.conn!.unsafe<BunSqlResult>(query, values);

    // Bun's result metadata varies by query type; use the unified builder to map safely.
    return buildUpdateResult({
      rows: res,
      changes: getAffectedRows(res),
      id: res.lastInsertRowid,
      insertIdStrategy: this.dialect.insertIdStrategy,
      upsertStatus: res.affectedRows,
    });
  }

  protected override async releaseConn(conn: ReservedSQL) {
    // Only release if the connection is a reserved one (e.g. native Postgres/MySQL)
    if (isReservedConnection(conn)) {
      conn.release();
    }
  }
}
