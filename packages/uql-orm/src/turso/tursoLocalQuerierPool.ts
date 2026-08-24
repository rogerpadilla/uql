import { AbstractSharedHandleQuerierPool } from '../querier/abstractSharedHandleQuerierPool.js';
import type { ExtraOptions } from '../type/index.js';
import { TursoDialect } from './tursoDialect.js';
import { type TursoDatabase, TursoLocalQuerier } from './tursoLocalQuerier.js';

/** Subset of `DatabaseOpts` from `@tursodatabase/database`, declared locally to avoid the coupling. */
export type TursoLocalOptions = {
  readonly?: boolean;
  fileMustExist?: boolean;
  timeout?: number;
  defaultQueryTimeout?: number;
  tracing?: 'info' | 'debug' | 'trace';
};

/**
 * Pool for the embedded Turso engine (`@tursodatabase/database`), the Rust rewrite of SQLite.
 *
 * @remarks Kept on the `uql-orm/turso/local` entry point rather than `uql-orm/turso`, because this
 * package ships native binaries that do not resolve on edge runtimes. Separating them guarantees a
 * bundle targeting Workers never reaches the native import.
 */
export class TursoLocalQuerierPool extends AbstractSharedHandleQuerierPool<
  TursoDatabase,
  TursoLocalQuerier,
  TursoDialect
> {
  constructor(
    readonly filename: string = ':memory:',
    readonly opts?: TursoLocalOptions,
    extra?: ExtraOptions,
  ) {
    super(new TursoDialect({ namingStrategy: extra?.namingStrategy }), extra);
  }

  protected override async openDb(): Promise<TursoDatabase> {
    const { connect } = await import('@tursodatabase/database');
    // Annotated rather than cast, so the structural contract is checked against the real driver.
    const db: TursoDatabase = await connect(this.filename, this.opts);
    await db.pragma('journal_mode = WAL');
    await db.pragma('foreign_keys = ON');
    return db;
  }

  protected override buildQuerier(db: TursoDatabase) {
    return new TursoLocalQuerier(db, this.dialect, this.extra);
  }
}
