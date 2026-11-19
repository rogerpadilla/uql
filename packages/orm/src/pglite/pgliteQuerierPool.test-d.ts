/**
 * What a PGlite pool runs on: a `PGlite` it opens, or a handle the caller opens, as a `PGliteWorker` sharing one
 * database across tabs. Type-checked by `bun run ts` only.
 */
import type { PGlite } from '@electric-sql/pglite';
import type { PGliteWorker } from '@electric-sql/pglite/worker';
import { expectTypeOf } from 'vitest';
import type { PgliteDatabase } from './pgliteQuerier.js';
import { PgliteQuerierPool } from './pgliteQuerierPool.js';

declare const worker: PGliteWorker;

expectTypeOf<PGlite>().toExtend<PgliteDatabase>();
expectTypeOf<PGliteWorker>().toExtend<PgliteDatabase>();

new PgliteQuerierPool(async () => worker);
new PgliteQuerierPool(async () => worker, { schema: 'tenant' });
new PgliteQuerierPool('idb://app', { relaxedDurability: true }, { schema: 'tenant' });

// @ts-expect-error a handle the caller opens takes PGlite's options where it is opened
new PgliteQuerierPool(async () => worker, { relaxedDurability: true });
