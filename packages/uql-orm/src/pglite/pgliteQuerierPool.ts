import type { PGliteOptions } from '@electric-sql/pglite';
import { dialectOptionsFrom } from '../dialect/abstractDialect.js';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import { AbstractSharedHandleQuerierPool } from '../querier/abstractSharedHandleQuerierPool.js';
import type { ExtraOptions } from '../type/index.js';
import { decodeWideNumber } from '../util/wideNumber.js';
import { type PgliteDatabase, PgliteQuerier } from './pgliteQuerier.js';

/**
 * The driver's own options, minus the `dataDir` this pool takes as its first argument.
 *
 * @remarks Imported rather than restated so extensions and the filesystem hooks keep their real types:
 * `extensions: { vector }` from `@electric-sql/pglite-pgvector` is how a vector column becomes usable,
 * mirroring `LocalSqlitePoolOptions.extensions` for `sqlite-vec`. Type-only, like the `pg` imports in
 * `abstractPgQuerierPool.ts`, so nothing here reaches a runtime without the peer installed.
 */
export type PglitePoolOptions = Omit<PGliteOptions, 'dataDir'>;

/**
 * Pool for PGlite, Postgres compiled to WASM and run in this process. No server, no container.
 *
 * PGlite is single connection, so the shared-handle lifecycle is {@link AbstractSharedHandleQuerierPool}'s.
 * Where PGlite differs from the two SQLite-family pools there is that it does not refuse a second
 * `BEGIN`: a querier that opens a transaction while another already has one silently joins it, and that
 * one's `ROLLBACK` then discards both queriers' writes. Nothing reports it, so a unit of work that needs
 * a transaction of its own needs its own pool, and therefore its own database.
 *
 * @remarks Transactions are plain `BEGIN`/`COMMIT` statements rather than `db.transaction()`, whose
 * callback holds PGlite's transaction mutex and would block every other querier's reads until commit.
 * The cost is that PGlite cannot see the transaction, so it flushes to the filesystem after each
 * statement within one: pass `relaxedDurability: true` on a persistent `dataDir` to skip waiting on
 * those flushes.
 *
 * The dialect is plain `PostgresDialect`, `dialectName` included: PGlite *is* Postgres, so the
 * introspector, schema generator and CLI resolve to Postgres's. Both driver capabilities hold as
 * they are - PGlite serializes every built-in array type itself, and the `$n::jsonb` cast is what
 * makes its `Describe` report JSONB and pick its JSON serializer; a bare `$n` binds `[object Object]`.
 */
export class PgliteQuerierPool extends AbstractSharedHandleQuerierPool<PgliteDatabase, PgliteQuerier, PostgresDialect> {
  constructor(
    readonly dataDir = 'memory://',
    readonly opts?: PglitePoolOptions,
    extra?: ExtraOptions,
  ) {
    super(new PostgresDialect(dialectOptionsFrom(extra)), extra);
  }

  protected override async openDb(): Promise<PgliteDatabase> {
    const { PGlite, types } = await import('@electric-sql/pglite');
    // INT8 by the one wide-integer rule, where PGlite's own answers a `bigint` past 2^53; a caller's own
    // `parsers` still win. The declared return type is what checks {@link PgliteDatabase} against the
    // real driver, so no cast is needed here or anywhere below it.
    return PGlite.create(this.dataDir, {
      ...this.opts,
      parsers: { [types.INT8]: decodeWideNumber, ...this.opts?.parsers },
    });
  }

  protected override buildQuerier(db: PgliteDatabase) {
    return new PgliteQuerier(db, this.dialect, this.extra);
  }
}
