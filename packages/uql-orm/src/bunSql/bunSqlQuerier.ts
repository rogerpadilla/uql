import type { SQL } from 'bun';
import type { AbstractSqlDialect } from '../dialect/index.js';
import { streamViaCursor } from '../postgres/pgCursorStream.js';
import { AbstractPoolQuerier } from '../querier/abstractPoolQuerier.js';
import type { ExtraOptions, RawRow } from '../type/index.js';
import { type BunSqlConn, type BunSqlResult, getAffectedRows, getInsertId, normalizeRows } from './bunSql.util.js';

/**
 * Querier for `bun:sql`, Bun's built-in driver for Postgres, MySQL, MariaDB, CockroachDB and SQLite.
 */
export class BunSqlQuerier extends AbstractPoolQuerier<BunSqlConn> {
  constructor(
    readonly sql: SQL,
    dialect: AbstractSqlDialect,
    connFactory: () => Promise<BunSqlConn>,
    override readonly extra?: ExtraOptions,
  ) {
    super(dialect, connFactory, extra);
  }

  override async internalAll<T>(query: string, values?: unknown[]) {
    const res = await this.execute<T>(query, values);
    return normalizeRows(res);
  }

  override async internalRun(query: string, values?: unknown[]) {
    const res = await this.execute<RawRow>(query, values);
    const rows = normalizeRows(res);

    // Bun's result metadata varies by query type; use the base builder to map safely.
    return this.buildUpdateResult({
      rows,
      changes: getAffectedRows(res),
      id: getInsertId(res),
      upsertStatus: res.affectedRows,
    });
  }

  /**
   * A server-side cursor where the engine has one, the base class's buffering where it does not.
   *
   * Bun's `SQL.Query` is a `Promise` with no cursor or async-iterator API
   * ([oven-sh/bun#17181](https://github.com/oven-sh/bun/issues/17181)), so the rows have to be paged
   * in SQL instead - which the Postgres wire family can do and MySQL and SQLite cannot.
   */
  protected override async *internalStream<T>(query: string, values?: unknown[]) {
    if (!this.dialect.features.serverSideCursors) {
      yield* super.internalStream<T>(query, values);
      return;
    }
    yield* streamViaCursor<T>(
      (sql, params) => this.internalAll<T>(sql, params),
      query,
      values,
      this.hasOpenTransaction,
    );
  }

  private async execute<T>(query: string, values?: unknown[]): Promise<BunSqlResult<T>> {
    // Safe: UQL parameters are strictly bound. .unsafe() correctly bypasses Bun's tagged template
    // literal parsing requirement so we can execute our dynamically compiled AST strings natively.
    return this.getConn().unsafe<BunSqlResult<T>>(query, values);
  }

  protected override async releaseConn(conn: BunSqlConn) {
    conn.release();
  }
}
