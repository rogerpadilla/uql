import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, onTestFinished, vi } from 'vitest';
import { Entity, Field, Id, Index } from '../../entity/index.js';
import { driftOf, planOf, syncOf } from '../../test/drift.js';
import { linkUqlOrmSource, provisioningTimeout } from '../../test/index.js';
import { dropTables, sqlPools, syncedPool } from '../../test/sqlPools.js';
import type { SqlQuerierPool, Type } from '../../type/index.js';
import { sql } from '../../util/index.js';
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

const RENAMED = 'drift_sync_renamed';

/** An indexed subtitle, and a parent by foreign key, named as their fields are. */
@Index((row) => [row.subTitle])
@Entity({ name: RENAMED })
class TitledBefore {
  @Id({ type: Number }) id?: number;
  @Field({ type: String, length: 100 }) subTitle?: string | null;
  @Field({ type: Number, references: () => TitledBefore }) parentId?: number | null;
}

/** The same columns in snake case, as a naming strategy switched to it spells them. */
@Index((row) => [row.subTitle])
@Entity({ name: RENAMED })
class TitledAfter {
  @Id({ type: Number }) id?: number;
  @Field({ type: String, length: 100, name: 'sub_title' }) subTitle?: string | null;
  @Field({ type: Number, references: () => TitledAfter, name: 'parent_id' }) parentId?: number | null;
}

const RETYPED = 'drift_sync_retyped';

/** A code kept as text. */
@Entity({ name: RETYPED })
class CodedAsText {
  @Id({ type: Number }) id?: number;
  @Field({ type: String, length: 20 }) code?: string | null;
}

/** The same code as a number. */
@Entity({ name: RETYPED })
class CodedAsNumber {
  @Id({ type: Number }) id?: number;
  @Field({ type: Number }) code?: number | null;
}

const ARTICLES = 'drift_sync_articles';
const POSTS = 'drift_sync_posts';

/** A table under its old name. */
@Entity({ name: ARTICLES })
class Article {
  @Id({ type: Number }) id?: number;
  @Field({ type: String, length: 77 }) summary?: string | null;
}

/** The same columns under a new name. */
@Entity({ name: POSTS })
class Post {
  @Id({ type: Number }) id?: number;
  @Field({ type: String, length: 77 }) summary?: string | null;
}

const WIDENED = 'drift_sync_widened';

/** A short name. */
@Entity({ name: WIDENED })
class NamedShort {
  @Id({ type: Number }) id?: number;
  @Field({ type: String, length: 50 }) name?: string | null;
}

/** The same name, longer. */
@Entity({ name: WIDENED })
class NamedLong {
  @Id({ type: Number }) id?: number;
  @Field({ type: String, length: 100 }) name?: string | null;
}

/** A migrator writing to a directory, and recording in a table, of its own, both removed after the test. */
async function generating(pool: SqlQuerierPool, entity: Type<object>) {
  const dir = await mkdtemp(join(tmpdir(), 'uql-sync-drift-'));
  const tableName = 'uql_migrations_sync_drift';
  onTestFinished(async () => {
    await rm(dir, { recursive: true, force: true });
    await dropTables(pool, tableName);
  });
  return new Migrator(pool, { entities: [entity], migrationsPath: dir, tableName });
}

/** Every engine reads back what `sync` built as what the entity said, however it holds it. */
describe.each(sqlPools('test_drift'))('drift and sync (%s)', (_engine, connect) => {
  const pool = connect();
  afterAll(() => pool.end());

  it(
    'should report no drift, and plan nothing, for a table it just synced',
    async () => {
      await syncOf(pool, DriftUniqueUser, { force: true });

      expect(await driftOf(pool, DriftUniqueUser, TABLE)).toEqual([]);
      expect(await planOf(pool, DriftUniqueUser, { safe: false })).toEqual([]);
    },
    provisioningTimeout,
  );

  /** An older timestamp, zoneless and in whole seconds, is altered to the one a `Date` field declares, once. */
  it(
    'should widen an older timestamp to the one a Date field declares',
    async () => {
      await syncOf(pool, DatedBefore, { force: true });

      await syncOf(pool, DatedAfter, { safe: false });

      expect(await driftOf(pool, DatedAfter, DATED)).toEqual([]);
      expect(await planOf(pool, DatedAfter, { safe: false })).toEqual([]);
    },
    provisioningTimeout,
  );

  /** A unique column is a unique index, so a sync adds one and drops one as it does any other. */
  it(
    'should add a uniqueness the database lacks, and drop one the entity no longer declares',
    async () => {
      await syncOf(pool, ShapeBefore, { force: true });

      expect(await driftOf(pool, ShapeUnique, SHAPE)).toEqual([
        { type: 'missing_index', index: 'drift_sync_shape__email_idx' },
      ]);

      await syncOf(pool, ShapeUnique, {});
      expect(await driftOf(pool, ShapeUnique, SHAPE)).toEqual([]);

      await syncOf(pool, ShapeBefore, { safe: false });
      expect(await driftOf(pool, ShapeBefore, SHAPE)).toEqual([]);
    },
    provisioningTimeout,
  );

  /** An index under another name is the one asked for; one that changed is rebuilt, which safe mode holds back. */
  it(
    'should pair an index under a legacy name, and rebuild a changed one only outside safe mode',
    async () => {
      await syncOf(pool, ShapeBefore, { force: true });

      expect(await driftOf(pool, ShapeAfter, SHAPE)).toEqual([
        { type: 'index_mismatch', index: 'drift_sync_shape_code_idx' },
      ]);
      expect(await planOf(pool, ShapeAfter, {})).toEqual([]);

      await syncOf(pool, ShapeAfter, { safe: false });

      expect(await driftOf(pool, ShapeAfter, SHAPE)).toEqual([]);
      expect(await planOf(pool, ShapeAfter, { safe: false })).toEqual([]);
    },
    provisioningTimeout,
  );

  /** A drop keeps the whole column, so a generated migration's `down` restores it, and its uniqueness. */
  it(
    'should roll a generated migration back, restoring the column and the unique index it dropped',
    async () => {
      await syncOf(pool, ShapeUnique, { force: true });
      const migrator = await generating(pool, ShapeNoEmail);
      const warn = vi.spyOn(migrator.logger, 'logWarn');

      await linkUqlOrmSource(await migrator.generateFromEntities('drop_email'));
      expect(warn).toHaveBeenCalledWith(`Drops "${SHAPE}"."email", losing what it holds.`);
      await migrator.up();
      expect(await driftOf(pool, ShapeNoEmail, SHAPE)).toEqual([]);

      await migrator.down();
      expect(await driftOf(pool, ShapeUnique, SHAPE)).toEqual([]);
    },
    provisioningTimeout,
  );

  /** Only a retype that can lose a value is called out: a wider column holds every one it held. */
  it(
    'should not warn about a retype that only widens a column',
    async () => {
      await syncOf(pool, NamedShort, { force: true });
      const migrator = await generating(pool, NamedLong);
      const warn = vi.spyOn(migrator.logger, 'logWarn');

      await linkUqlOrmSource(await migrator.generateFromEntities('widen_name'));
      await migrator.up();

      expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('Retypes'));
      expect(await driftOf(pool, NamedLong, WIDENED)).toEqual([]);
    },
    provisioningTimeout,
  );

  /** A table no entity names may be another application's, so a rename onto it is suggested, never written. */
  it(
    'should suggest renaming a table no entity names to a new one identical to it',
    async () => {
      await syncOf(pool, Article, { force: true });
      await dropTables(pool, POSTS);
      onTestFinished(() => dropTables(pool, ARTICLES, POSTS));
      const migrator = await generating(pool, Post);
      const warn = vi.spyOn(migrator.logger, 'logWarn');

      await migrator.generateFromEntities('posts');

      expect(warn).toHaveBeenCalledWith(expect.stringContaining(`renameTable('${ARTICLES}', '${POSTS}')`));
    },
    provisioningTimeout,
  );

  /** A column its naming strategy now spells otherwise keeps its data: the generated migration renames it, and back. */
  it(
    'should rename a column its naming strategy spells otherwise, and back',
    async () => {
      await syncOf(pool, TitledBefore, { force: true });
      await pool.insertOne(TitledBefore, { id: 1, subTitle: 'kept' });
      await pool.insertOne(TitledBefore, { id: 2, subTitle: 'child', parentId: 1 });
      // Drift reads no rename into a database nobody migrated: each renamed thing is missing and held under its old name.
      expect(await driftOf(pool, TitledAfter, RENAMED)).toEqual([
        { type: 'missing_column', column: 'sub_title' },
        { type: 'missing_column', column: 'parent_id' },
        { type: 'unexpected_column', column: 'subTitle' },
        { type: 'unexpected_column', column: 'parentId' },
        { type: 'missing_index', index: 'drift_sync_renamed__sub_title_idx' },
        { type: 'missing_index', index: 'drift_sync_renamed__parent_id_idx' },
        { type: 'unexpected_index', index: 'drift_sync_renamed__parentId_idx' },
        { type: 'unexpected_index', index: 'drift_sync_renamed__subTitle_idx' },
        { type: 'missing_relationship' },
        { type: 'unexpected_relationship' },
      ]);
      const migrator = await generating(pool, TitledAfter);

      await linkUqlOrmSource(await migrator.generateFromEntities('snake_case'));
      await migrator.up();
      expect(await pool.findOneById(TitledAfter, 2)).toEqual({ id: 2, subTitle: 'child', parentId: 1 });
      expect(await driftOf(pool, TitledAfter, RENAMED)).toEqual([]);

      await migrator.down();
      expect(await pool.findOneById(TitledBefore, 2)).toEqual({ id: 2, subTitle: 'child', parentId: 1 });
    },
    provisioningTimeout,
  );
});

/**
 * The Postgres family casts only between types it deems compatible, so a retype says how; SQLite rebuilds
 * the table, and its rollback rebuilds it back as it was.
 */
describe.each(sqlPools('test_drift', 'mysql', 'mariadb', 'mssql'))('retype (%s)', (_engine, connect) => {
  const pool = connect();
  afterAll(() => pool.end());

  it(
    'should retype text holding a number to a number, and back',
    async () => {
      await syncOf(pool, CodedAsText, { force: true });
      await pool.insertOne(CodedAsText, { id: 1, code: '42' });
      const migrator = await generating(pool, CodedAsNumber);
      const warn = vi.spyOn(migrator.logger, 'logWarn');

      await linkUqlOrmSource(await migrator.generateFromEntities('retype_code'));
      await migrator.up();

      expect(warn).toHaveBeenCalledWith(expect.stringContaining(`Retypes "${RETYPED}"."code"`));
      expect(await pool.findOneById(CodedAsNumber, 1)).toEqual({ id: 1, code: 42 });

      await migrator.down();
      expect(await pool.findOneById(CodedAsText, 1)).toEqual({ id: 1, code: '42' });
    },
    provisioningTimeout,
  );
});

const INDEXED = 'drift_index_user';

/**
 * Everything an index carries that the Postgres family reprints in its own words: an expression, a partial
 * predicate, a stored order, `INCLUDE` columns. CockroachDB also registers a `UNIQUE` constraint for a plain
 * `CREATE UNIQUE INDEX`, which a catalogue filter written for Postgres hides, and so reports missing.
 */
@Index(() => [sql`lower("email")`], { unique: true, where: sql`"deletedAt" IS NULL`, name: 'drift_email_live_idx' })
@Index((user) => [user.status], { unique: true, name: 'drift_status_unique_idx' })
@Index((user) => [user.status, { column: user.createdAt, order: 'desc' }], { name: 'drift_status_recent_idx' })
@Index((user) => [user.tenantId], { include: (user) => [user.status], name: 'drift_tenant_covering_idx' })
@Entity({ name: INDEXED })
class IndexedUser {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) email?: string | null;
  @Field({ type: String }) status?: string | null;
  @Field({ type: Number }) tenantId?: number | null;
  @Field({ type: Date }) createdAt?: Date | null;
  @Field({ type: Date, softDelete: true }) deletedAt?: Date | null;
}

/** The same table with one index no longer unique, one covering column dropped, and the `status` ones gone. */
@Index(() => [sql`lower("email")`], { where: sql`"deletedAt" IS NULL`, name: 'drift_email_live_idx' })
@Index((user) => [user.tenantId], { name: 'drift_tenant_covering_idx' })
@Entity({ name: INDEXED })
class IndexedUserEdited {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) email?: string | null;
  @Field({ type: String }) status?: string | null;
  @Field({ type: Number }) tenantId?: number | null;
  @Field({ type: Date }) createdAt?: Date | null;
  @Field({ type: Date, softDelete: true }) deletedAt?: Date | null;
}

/**
 * The round trip every piece of index comparison has to survive: emit the DDL, read it back out of the
 * catalogue, and compare it with the entity it came from, so whatever the comparison fails to fold away
 * shows as drift no migration could ever settle.
 */
describe.each(sqlPools('test_drift', 'mysql', 'mariadb', 'sqlite', 'mssql'))('index drift (%s)', (_engine, connect) => {
  const pool = syncedPool(connect, [IndexedUser]);

  it('should report nothing for the indexes it just created', async () => {
    expect(await driftOf(pool(), IndexedUser, INDEXED)).toEqual([]);
  });

  it('should report the indexes whose definition the entity changed', async () => {
    expect(await driftOf(pool(), IndexedUserEdited, INDEXED)).toEqual([
      { type: 'index_mismatch', index: 'drift_tenant_covering_idx' },
      { type: 'index_mismatch', index: 'drift_email_live_idx' },
      { type: 'unexpected_index', index: 'drift_status_recent_idx' },
      { type: 'unexpected_index', index: 'drift_status_unique_idx' },
    ]);
  });
});

const CLASSED = 'drift_index_classed';

/** An operator class, which CockroachDB cannot state. */
@Index((row) => [{ column: row.data, opsClass: 'jsonb_path_ops' }], { type: 'gin', name: 'drift_data_idx' })
@Entity({ name: CLASSED })
class ClassedData {
  @Id({ type: Number }) id?: number;
  @Field({ type: 'jsonb' }) data?: object | null;
}

describe.each(sqlPools('test_drift', 'cockroachdb', 'mysql', 'mariadb', 'sqlite', 'mssql'))(
  'operator class drift (%s)',
  (_engine, connect) => {
    const pool = syncedPool(connect, [ClassedData]);

    it('should report nothing for the index it just created', async () => {
      expect(await driftOf(pool(), ClassedData, CLASSED)).toEqual([]);
    });
  },
);
