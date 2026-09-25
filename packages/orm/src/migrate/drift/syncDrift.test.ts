import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, onTestFinished } from 'vitest';
import { Entity, Field, Id, Index } from '../../entity/index.js';
import { driftOf } from '../../test/drift.js';
import { provisioningTimeout } from '../../test/index.js';
import { dropTables, SQL_POOLS } from '../../test/sqlPools.js';
import type { SyncOptions, Type } from '../../type/index.js';
import { Migrator } from '../migrator.js';

const TABLE = 'drift_sync_user';

/** Uniqueness said both ways an entity can, on the field and as a one-column unique index, and defaults. */
@Index((user) => [user.handle], { name: 'drift_sync_handle_uk', unique: true })
@Index((user) => [user.region, user.code], { name: 'drift_sync_pair_uk', unique: true })
@Entity({ name: TABLE })
class DriftUniqueUser {
  @Id({ type: Number }) id?: number;
  @Field({ type: String, length: 100, unique: true }) email?: string | null;
  @Field({ type: String, length: 100 }) handle?: string | null;
  @Field({ type: String, length: 20 }) region?: string | null;
  @Field({ type: String, length: 20 }) code?: string | null;
  @Field({ type: String, length: 20, defaultValue: 'active' }) status?: string | null;
  @Field({ type: Number, defaultValue: 0 }) score?: number | null;
  @Field({ type: Date }) seenAt?: Date | null;
}

const DATED = 'drift_sync_dated';

/** A timestamp as an older schema built it: no zone, and whole seconds. */
@Entity({ name: DATED })
class DatedBefore {
  @Id({ type: Number }) id?: number;
  @Field({ type: Date, columnType: 'timestamp', precision: 0 }) at?: Date | null;
}

@Entity({ name: DATED })
class DatedAfter {
  @Id({ type: Number }) id?: number;
  @Field({ type: Date }) at?: Date | null;
}

const SHAPE = 'drift_sync_shape';

/** The table as built before: `email` not unique, an index under a legacy name, and one over `code` alone. */
@Index((row) => [row.region], { name: 'legacy_region' })
@Index((row) => [row.code], { name: 'drift_sync_shape_code_idx' })
@Entity({ name: SHAPE })
class ShapeBefore {
  @Id({ type: Number }) id?: number;
  @Field({ type: String, length: 100 }) email?: string | null;
  @Field({ type: String, length: 20 }) region?: string | null;
  @Field({ type: String, length: 20 }) code?: string | null;
}

/** What the entity says now: the same `region` index under uql's name, and the `code` one widened. */
@Index((row) => [row.region])
@Index((row) => [row.code, row.region], { name: 'drift_sync_shape_code_idx' })
@Entity({ name: SHAPE })
class ShapeAfter {
  @Id({ type: Number }) id?: number;
  @Field({ type: String, length: 100 }) email?: string | null;
  @Field({ type: String, length: 20 }) region?: string | null;
  @Field({ type: String, length: 20 }) code?: string | null;
}

/** `ShapeBefore` with `email` made unique. */
@Index((row) => [row.region], { name: 'legacy_region' })
@Index((row) => [row.code], { name: 'drift_sync_shape_code_idx' })
@Entity({ name: SHAPE })
class ShapeUnique {
  @Id({ type: Number }) id?: number;
  @Field({ type: String, length: 100, unique: true }) email?: string | null;
  @Field({ type: String, length: 20 }) region?: string | null;
  @Field({ type: String, length: 20 }) code?: string | null;
}

/** `ShapeUnique` without `email`, whose drop takes its unique index with it. */
@Index((row) => [row.region], { name: 'legacy_region' })
@Index((row) => [row.code], { name: 'drift_sync_shape_code_idx' })
@Entity({ name: SHAPE })
class ShapeNoEmail {
  @Id({ type: Number }) id?: number;
  @Field({ type: String, length: 20 }) region?: string | null;
  @Field({ type: String, length: 20 }) code?: string | null;
}

/** Every engine reads back what `sync` built as what the entity said, however it holds it. */
describe.each(SQL_POOLS)('drift and sync (%s)', (_engine, connect) => {
  const pool = connect();
  afterAll(() => pool.end());

  const syncOf = (entity: Type<object>, options: SyncOptions) =>
    new Migrator(pool, { entities: [entity] }).sync({ logging: false, ...options });
  const planOf = (entity: Type<object>, options: SyncOptions) =>
    new Migrator(pool, { entities: [entity] }).planSync(options);

  it(
    'should report no drift, and plan nothing, for a table it just synced',
    async () => {
      await syncOf(DriftUniqueUser, { force: true });

      expect(await driftOf(pool, DriftUniqueUser, TABLE)).toEqual([]);
      expect(await planOf(DriftUniqueUser, { safe: false })).toEqual([]);
    },
    provisioningTimeout,
  );

  /** An older timestamp, zoneless and in whole seconds, is altered to the one a `Date` field declares, once. */
  it(
    'should widen an older timestamp to the one a Date field declares',
    async () => {
      await syncOf(DatedBefore, { force: true });

      await syncOf(DatedAfter, { safe: false });

      expect(await driftOf(pool, DatedAfter, DATED)).toEqual([]);
      expect(await planOf(DatedAfter, { safe: false })).toEqual([]);
    },
    provisioningTimeout,
  );

  /** A unique column is a unique index, so a sync adds one and drops one as it does any other. */
  it(
    'should add a uniqueness the database lacks, and drop one the entity no longer declares',
    async () => {
      await syncOf(ShapeBefore, { force: true });

      expect(await driftOf(pool, ShapeUnique, SHAPE)).toEqual([
        { type: 'missing_index', index: 'drift_sync_shape__email_idx' },
      ]);

      await syncOf(ShapeUnique, {});
      expect(await driftOf(pool, ShapeUnique, SHAPE)).toEqual([]);

      await syncOf(ShapeBefore, { safe: false });
      expect(await driftOf(pool, ShapeBefore, SHAPE)).toEqual([]);
    },
    provisioningTimeout,
  );

  /** An index under another name is the one asked for; one that changed is rebuilt, which safe mode holds back. */
  it(
    'should pair an index under a legacy name, and rebuild a changed one only outside safe mode',
    async () => {
      await syncOf(ShapeBefore, { force: true });

      expect(await driftOf(pool, ShapeAfter, SHAPE)).toEqual([
        { type: 'index_mismatch', index: 'drift_sync_shape_code_idx' },
      ]);
      expect(await planOf(ShapeAfter, {})).toEqual([]);

      await syncOf(ShapeAfter, { safe: false });

      expect(await driftOf(pool, ShapeAfter, SHAPE)).toEqual([]);
      expect(await planOf(ShapeAfter, { safe: false })).toEqual([]);
    },
    provisioningTimeout,
  );

  /** A drop keeps the whole column, so a generated migration's `down` restores it, and its uniqueness. */
  it(
    'should roll a generated migration back, restoring the column and the unique index it dropped',
    async () => {
      await syncOf(ShapeUnique, { force: true });
      const dir = await mkdtemp(join(tmpdir(), 'uql-sync-drift-'));
      const tableName = 'uql_migrations_sync_drift';
      onTestFinished(async () => {
        await rm(dir, { recursive: true, force: true });
        await dropTables(pool, tableName);
      });
      const migrator = new Migrator(pool, { entities: [ShapeNoEmail], migrationsPath: dir, tableName });

      await migrator.generateFromEntities('drop_email');
      await migrator.up();
      expect(await driftOf(pool, ShapeNoEmail, SHAPE)).toEqual([]);

      await migrator.down();
      expect(await driftOf(pool, ShapeUnique, SHAPE)).toEqual([]);
    },
    provisioningTimeout,
  );
});
