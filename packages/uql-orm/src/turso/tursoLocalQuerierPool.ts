import type { connect } from '@tursodatabase/database';
import { dialectOptionsFrom } from '../dialect/abstractDialect.js';
import { AbstractSharedHandleQuerierPool } from '../querier/abstractSharedHandleQuerierPool.js';
import { applySqlitePragmas } from '../sqlite/sqlitePragmas.js';
import { type SqliteDatabase, SqliteQuerier } from '../sqlite/sqliteQuerier.js';
import type { ExtraOptions } from '../type/index.js';
import { TursoLocalDialect } from './tursoLocalDialect.js';

/** The engine's own options: `readonly`, `timeout`, `encryption`, `experimental` and the rest. */
export type TursoLocalOptions = NonNullable<Parameters<typeof connect>[1]>;

/**
 * Pool for the embedded Turso engine (`@tursodatabase/database`), the Rust rewrite of SQLite.
 *
 * @remarks Kept on the `uql-orm/turso/local` entry point rather than `uql-orm/turso`, because this
 * package ships native binaries that do not resolve on edge runtimes. Separating them guarantees a
 * bundle targeting Workers never reaches the native import.
 */
export class TursoLocalQuerierPool extends AbstractSharedHandleQuerierPool<
  SqliteDatabase,
  SqliteQuerier,
  TursoLocalDialect
> {
  constructor(
    readonly filename = ':memory:',
    readonly opts?: TursoLocalOptions,
    extra?: ExtraOptions,
  ) {
    super(new TursoLocalDialect(dialectOptionsFrom(extra)), extra);
  }

  protected override async openDb(): Promise<SqliteDatabase> {
    const { connect } = await import('@tursodatabase/database');
    const db = await connect(this.filename, this.opts);
    // Integers as `bigint`, which the querier decodes exactly past 2^53.
    db.defaultSafeIntegers(true);
    await applySqlitePragmas(db);
    return db;
  }

  protected override buildQuerier(db: SqliteDatabase) {
    return new SqliteQuerier(db, this.dialect, this.extra);
  }
}
