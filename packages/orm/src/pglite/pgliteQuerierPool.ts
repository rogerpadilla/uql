import type { PGliteOptions } from '@electric-sql/pglite';
import { dialectOptionsFrom } from '../dialect/abstractDialect.js';
import { PG_DECODERS, wireDecoders } from '../postgres/pgWireTypes.js';
import { AbstractSharedHandleQuerierPool } from '../querier/abstractSharedHandleQuerierPool.js';
import type { Except, ExtraOptions } from '../type/index.js';
import { PgliteDialect } from './pgliteDialect.js';
import { type PgliteDatabase, PgliteQuerier, type PgliteQueryOptions } from './pgliteQuerier.js';

/** PGlite's own options but `dataDir`, the pool's first argument; `extensions: { vector }` enables pgvector. Type-only. */
export type PglitePoolOptions = Except<PGliteOptions, 'dataDir'>;

/** Opens the handle a pool runs on, as a `PGliteWorker` sharing one database across tabs: `() => PGliteWorker.create(worker)`. */
export type PgliteOpen = () => Promise<PgliteDatabase>;

type OpenedHere = [dataDir?: string, opts?: PglitePoolOptions, extra?: ExtraOptions];
type OpenedByCaller = [open: PgliteOpen, extra?: ExtraOptions];

function openedByCaller(args: OpenedHere | OpenedByCaller): args is OpenedByCaller {
  return typeof args[0] === 'function';
}

/**
 * A pool for PGlite, Postgres in WASM, on one connection: a `dataDir` it opens, or a handle `open` answers. Its
 * transactions hold PGlite's own lock, which every caller of the handle waits on, another tab's included. Pass
 * `relaxedDurability` on a persistent `dataDir` to skip a flush per statement.
 */
export class PgliteQuerierPool extends AbstractSharedHandleQuerierPool<PgliteDatabase, PgliteQuerier, PgliteDialect> {
  readonly #open: PgliteOpen;
  /** uql's decoders, sent with each statement on a handle the caller opened, whose own parsers stay its owner's. */
  #queryOptions?: PgliteQueryOptions;

  constructor(dataDir?: string, opts?: PglitePoolOptions, extra?: ExtraOptions);
  constructor(open: PgliteOpen, extra?: ExtraOptions);
  constructor(...args: OpenedHere | OpenedByCaller) {
    const byCaller = openedByCaller(args);
    const extra = byCaller ? args[1] : args[2];
    super(new PgliteDialect(dialectOptionsFrom(extra)), extra);
    this.#open = byCaller ? () => this.#decodingPerQuery(args[0]) : () => openPglite(args[0], args[1]);
  }

  protected override openDb(): Promise<PgliteDatabase> {
    return this.#open();
  }

  async #decodingPerQuery(open: PgliteOpen): Promise<PgliteDatabase> {
    const db = await open();
    this.#queryOptions = { parsers: Object.fromEntries(wireDecoders((oid) => db.parsers[oid] ?? String)) };
    return db;
  }

  protected override buildQuerier(db: PgliteDatabase) {
    return new PgliteQuerier(db, this.dialect, this.extra, this.#queryOptions);
  }
}

/**
 * PGlite with every Postgres-wire pool's decoders, which it applies to an array's elements too, a caller's own
 * `parsers` overriding them.
 */
async function openPglite(dataDir = 'memory://', opts?: PglitePoolOptions): Promise<PgliteDatabase> {
  const { PGlite } = await import('@electric-sql/pglite');
  return PGlite.create(dataDir, { ...opts, parsers: { ...Object.fromEntries(PG_DECODERS), ...opts?.parsers } });
}
