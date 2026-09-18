import type { connect } from '@tursodatabase/database';
import { dialectOptionsFrom } from '../dialect/abstractDialect.js';
import { AbstractLocalSqliteQuerierPool } from '../sqlite/localSqliteQuerierPool.js';
import type { SqliteDatabase } from '../sqlite/sqliteQuerier.js';
import type { ExtraOptions } from '../type/index.js';
import { TursoLocalDialect } from './tursoLocalDialect.js';

/** The engine's own options: `readonly`, `timeout`, `encryption`, `experimental` and the rest. */
export type TursoLocalOptions = NonNullable<Parameters<typeof connect>[1]>;

/** A pool for the embedded Turso engine, on `uql-orm/turso/local` so its native binaries stay out of edge bundles. */
export class TursoLocalQuerierPool extends AbstractLocalSqliteQuerierPool<SqliteDatabase, TursoLocalDialect> {
  constructor(
    readonly filename = ':memory:',
    readonly opts?: TursoLocalOptions,
    extra?: ExtraOptions,
  ) {
    super(new TursoLocalDialect(dialectOptionsFrom(extra)), extra);
  }

  protected override async createDb(): Promise<SqliteDatabase> {
    const { connect } = await import('@tursodatabase/database');
    const db = await connect(this.filename, this.opts);
    db.defaultSafeIntegers(true);
    return db;
  }
}
