import type { ReservedSQL, SQL } from 'bun';
import type { AbstractSqlDialect } from '../dialect/index.js';
import { AbstractPoolQuerier } from '../querier/abstractPoolQuerier.js';
import type { ExtraOptions, RawRow } from '../type/index.js';
import { type BunSqlResult, getAffectedRows, getInsertId, isReservedConnection, normalizeRows } from './bunSql.util.js';

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

  private async execute<T>(query: string, values?: unknown[]): Promise<BunSqlResult<T>> {
    // Safe: UQL parameters are strictly bound. .unsafe() correctly bypasses Bun's tagged template
    // literal parsing requirement so we can execute our dynamically compiled AST strings natively.
    return this.conn!.unsafe<BunSqlResult<T>>(query, values);
  }

  protected override async releaseConn(conn: ReservedSQL) {
    if (isReservedConnection(conn)) {
      await conn.release();
    }
  }
}
