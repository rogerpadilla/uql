import type { PGliteOptions } from '@electric-sql/pglite';
import { dialectOptionsFrom } from '../dialect/abstractDialect.js';
import { PG_DECODERS } from '../postgres/pgWireTypes.js';
import { AbstractSharedHandleQuerierPool } from '../querier/abstractSharedHandleQuerierPool.js';
import type { ExtraOptions } from '../type/index.js';
import { PgliteDialect } from './pgliteDialect.js';
import { type PgliteDatabase, PgliteQuerier } from './pgliteQuerier.js';

/** PGlite's own options but `dataDir`, the pool's first argument; `extensions: { vector }` enables pgvector. Type-only. */
export type PglitePoolOptions = Omit<PGliteOptions, 'dataDir'>;

/**
 * A pool for PGlite, Postgres in WASM in this process, on one connection. A second `BEGIN` silently joins
 * the open transaction, so a unit of work needing its own needs its own pool. Transactions are plain
 * statements, so pass `relaxedDurability` on a persistent `dataDir` to skip a flush per statement.
 */
export class PgliteQuerierPool extends AbstractSharedHandleQuerierPool<PgliteDatabase, PgliteQuerier, PgliteDialect> {
  constructor(
    readonly dataDir = 'memory://',
    readonly opts?: PglitePoolOptions,
    extra?: ExtraOptions,
  ) {
    super(new PgliteDialect(dialectOptionsFrom(extra)), extra);
  }

  protected override async openDb(): Promise<PgliteDatabase> {
    const { PGlite } = await import('@electric-sql/pglite');
    // Every Postgres-wire pool's decoders, which PGlite applies to an array's elements too; a caller's own
    // `parsers` still win. The declared return type is what checks {@link PgliteDatabase} against the real
    // driver, so no cast is needed below it.
    return PGlite.create(this.dataDir, {
      ...this.opts,
      parsers: { ...Object.fromEntries(PG_DECODERS), ...this.opts?.parsers },
    });
  }

  protected override buildQuerier(db: PgliteDatabase) {
    return new PgliteQuerier(db, this.dialect, this.extra);
  }
}
