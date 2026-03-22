import type { SQL } from 'bun';
import type { AbstractSqlDialect } from '../dialect/index.js';
import { AbstractSqlQuerier } from '../querier/abstractSqlQuerier.js';
import type { ExtraOptions, RawRow } from '../type/index.js';

export class BunSqlQuerier extends AbstractSqlQuerier {
  constructor(
    readonly sql: SQL,
    dialect: AbstractSqlDialect,
    override readonly extra?: ExtraOptions,
  ) {
    super(dialect, extra);
  }

  override internalAll<T>(query: string, values?: unknown[]) {
    // Safe: UQL parameters are strictly bound. .unsafe() correctly bypasses Bun's tagged template
    // literal parsing requirement so we can execute our dynamically compiled AST strings natively.
    return this.sql.unsafe(query, values as unknown[]) as Promise<T[]>;
  }

  override async internalRun(query: string, values?: unknown[]) {
    // Safe: UQL parameters are strictly bound. .unsafe() correctly bypasses Bun's tagged template
    // literal parsing requirement so we can execute our dynamically compiled AST strings natively.
    const res = (await this.sql.unsafe(query, values as unknown[])) as RawRow[] & {
      count?: number;
      affectedRows?: number;
      lastInsertRowid?: number | bigint;
    };

    // Bun's result metadata varies by query type; use the unified builder to map safely.
    return this.buildUpdateResult({
      rows: res,
      changes: res.affectedRows ?? res.count ?? 0,
      id: res.lastInsertRowid,
      upsertStatus: res.affectedRows,
    });
  }

  override async internalRelease() {
    if (this.hasOpenTransaction) {
      throw TypeError('pending transaction');
    }
    // Bun's SQL client is typically an app-level singleton or pool that doesn't
    // require manual release at the individual querier level.
  }
}
