import type { PGliteOptions } from '@electric-sql/pglite';
import { dialectOptionsFrom } from '../dialect/abstractDialect.js';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import { AbstractSharedHandleQuerierPool } from '../querier/abstractSharedHandleQuerierPool.js';
import type { ExtraOptions } from '../type/index.js';
import { decodeWideNumber } from '../util/wideNumber.js';
import { type PgliteDatabase, PgliteQuerier } from './pgliteQuerier.js';

/** PGlite's own options but `dataDir`, the pool's first argument; `extensions: { vector }` enables pgvector. Type-only. */
export type PglitePoolOptions = Omit<PGliteOptions, 'dataDir'>;

/**
 * A pool for PGlite, Postgres in WASM in this process, on one connection. A second `BEGIN` silently joins
 * the open transaction, so a unit of work needing its own needs its own pool. Transactions are plain
 * statements, so pass `relaxedDurability` on a persistent `dataDir` to skip a flush per statement.
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
