import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AbstractSqlDialect } from '../dialect/index.js';
import { Entity, Field, Id, Index, removeEntity } from '../entity/index.js';
import { assertDefined } from '../test/index.js';
import { idKey } from '../type/index.js';
import type { SchemaIntrospector, SqlQuerierPool } from '../type/index.js';
import { raw } from '../util/index.js';
import { introspectorFor } from './introspection/registry.js';
import { Migrator } from './migrator.js';

export interface DatabaseConfig {
  name: string;
  /** A factory, not a pool: nothing is opened for a backend whose suite never runs. */
  createPool: () => SqlQuerierPool;
  /** The engine's own dialect: what it declares it can alter decides which gated tests run. */
  dialect: AbstractSqlDialect;
  /** A hand-written key column, for seeding the table a sync is then asked to reconcile. */
  serialIdColumn: string;
  /** The plain integer a caller-supplied key column takes, which is not the auto-increment type. */
  keyColumnType: string;
  /** How this engine spelled a key before it was derived from the declared type. MySQL family only. */
  legacyUnsignedIdColumn?: string;
  textType: string;
  doubleType: string;
}

/** Declared once: both the success and the refusal sync the same entity, and only the engine differs. */
@Entity({ name: 'SyncComputedAdded' })
class ComputedAdded {
  @Id({ type: Number }) id?: number;
  @Field({ type: Number }) qty?: number | null;
  @Field({ type: Number, computed: raw`qty * 2`, stored: true }) double?: number | null;
}

/** One engine's run of the shared sync suite; each engine is its own test file, so vitest runs them in parallel. */
export function describeMigratorSync(db: DatabaseConfig) {
  describe(`Migrator sync Integration (${db.name})`, () => {
    let pool: SqlQuerierPool;
    let introspector: SchemaIntrospector;
    const claimed = new Set<string>();

    /**
     * Every statement goes through the pool, which acquires and releases per call. Pinning one querier
     * for the whole suite instead made a single dropped connection fail all of it.
     */
    const escapeId = (id: string) => pool.dialect.escapeId(id);
    const dropTable = (tableName: string) => pool.run(`DROP TABLE IF EXISTS ${escapeId(tableName)}`);

    /** The table as introspected, failing the test where it is missing. */
    const introspectTable = async (tableName: string, tables = [tableName]) => {
      const table = (await introspector.introspect(tables)).getTable(tableName);
      assertDefined(table, `${tableName} was not introspected`);
      return table;
    };

    /** The table's columns as introspected, sorted, so a test compares them as a set. */
    const columnNamesOf = async (tableName: string) => [...(await introspectTable(tableName)).columns.keys()].sort();

    /** The table's index names, sorted, so a test compares them as a set. */
    const indexNamesOf = async (tableName: string) =>
      (await introspectTable(tableName)).indexes.map((index) => index.name).sort();

    const createIndex = (tableName: string, name: string, columns: readonly string[]) =>
      pool.run(`CREATE INDEX ${escapeId(name)} ON ${escapeId(tableName)} (${columns.map(escapeId).join(', ')})`);

    /** Names the table this test owns, guarantees it does not exist yet, and registers its teardown. */
    const givenNoTable = async (tableName: string) => {
      claimed.add(tableName);
      await dropTable(tableName);
    };

    /** {@link givenNoTable} plus the pre-existing table a sync is expected to reconcile. */
    const givenTable = async (tableName: string, columns: string) => {
      await givenNoTable(tableName);
      await pool.run(`CREATE TABLE ${escapeId(tableName)} (${columns})`);
    };

    beforeAll(() => {
      pool = db.createPool();
      introspector = introspectorFor(pool);
    });

    afterAll(() => pool.end());

    // Teardown here rather than trailing each test, so a failed expectation leaves no table behind for the
    // next run's introspection.
    afterEach(async () => {
      for (const tableName of claimed) {
        await dropTable(tableName);
      }
      claimed.clear();
    });

    it('should detect and sync a new property added to an existing entity', async () => {
      @Entity()
      class AutoSyncUserTest1 {
        @Id({ type: Number }) id?: number;
        @Field({ type: String }) name?: string | null;
        @Field({ type: String }) email?: string | null;
      }

      const tableName = 'AutoSyncUserTest1';
      await givenTable(tableName, `${db.serialIdColumn}, ${escapeId('name')} ${db.textType}`);

      expect(await columnNamesOf(tableName)).toEqual(['id', 'name']);

      await new Migrator(pool, { entities: [AutoSyncUserTest1] }).sync({ logging: true });

      expect(await columnNamesOf(tableName)).toEqual(['email', 'id', 'name']);
    });

    /**
     * The regression test the differ merge most needs: a schema created from its own entities has
     * nothing left to reconcile. Anything reported here is a phantom - a column the generator spells
     * differently from how the engine stores it, or an index it fails to recognise as already there -
     * and it would re-run on every single sync.
     */
    it('should have nothing to do when the schema was created from the same entities', async () => {
      @Entity()
      class AutoSyncSettledTest {
        @Id({ type: Number }) id?: number;
        @Field({ type: String }) name?: string | null;
        @Field({ type: String, index: true }) email?: string | null;
        @Field({ type: Number }) cost?: number | null;
        @Field({ type: Boolean }) active?: boolean | null;
        @Field({ type: 'text' }) bio?: string | null;
        @Field({ type: 'json' }) data?: object | null;
      }

      await givenNoTable('AutoSyncSettledTest');
      const migrator = new Migrator(pool, { entities: [AutoSyncSettledTest] });
      await migrator.sync();

      expect(await migrator.planSync({ safe: false, drop: true })).toEqual([]);
    });

    /** Each engine reprints a default in its own words, which still has to read as the one declared. */
    it('should have nothing to do on the defaults it created', async () => {
      @Entity()
      class AutoSyncDefaultsTest {
        @Id({ type: String }) id?: string;
        @Field({ type: String, defaultValue: "it's" }) quoted?: string | null;
        @Field({ type: String, defaultValue: 'a\\b' }) slash?: string | null;
        @Field({ type: 'text', defaultValue: 'none' }) note?: string | null;
        @Field({ type: Number, defaultValue: -3 }) negative?: number | null;
      }

      await givenNoTable('AutoSyncDefaultsTest');
      const migrator = new Migrator(pool, { entities: [AutoSyncDefaultsTest] });
      await migrator.sync();

      expect(await migrator.planSync({ safe: false, drop: true })).toEqual([]);
    });

    /**
     * The upgrade the composite-key work exists for: a table keyed by one column, an entity that now
     * declares two. The key itself has to change, not just the column - and it has to come back in
     * the order declared, since `(a, b)` is a different key from `(b, a)`.
     */
    it('should widen a single-column key to a composite one', async () => {
      @Entity()
      class AutoSyncKeyTest {
        [idKey]?: 'userId' | 'groupId';
        @Id({ type: Number }) userId?: number;
        @Id({ type: Number }) groupId?: number;
        @Field({ type: String }) note?: string | null;
      }

      const tableName = 'AutoSyncKeyTest';
      await givenTable(
        tableName,
        `${escapeId('userId')} ${db.keyColumnType} NOT NULL, ${escapeId('note')} ${db.textType}, PRIMARY KEY (${escapeId('userId')})`,
      );

      const before = await introspector.getTableSchema(tableName);
      expect(before?.primaryKey?.columns).toEqual(['userId']);

      await new Migrator(pool, { entities: [AutoSyncKeyTest] }).sync({ safe: false });

      const after = await introspector.getTableSchema(tableName);
      expect(after?.primaryKey?.columns).toEqual(['userId', 'groupId']);
    });

    it('should create an index the entity declares on a table that already exists', async () => {
      @Entity()
      class AutoSyncIndexTest {
        @Id({ type: Number }) id?: number;
        @Field({ type: String, index: true }) email?: string | null;
      }

      const tableName = 'AutoSyncIndexTest';
      await givenTable(tableName, `${db.serialIdColumn}, ${escapeId('email')} ${db.textType}`);

      expect((await introspectTable(tableName)).indexes).toEqual([]);

      await new Migrator(pool, { entities: [AutoSyncIndexTest] }).sync({ logging: true });

      expect(await indexNamesOf(tableName)).toEqual(['AutoSyncIndexTest__email_idx']);
    });

    const givenKindStatusTable = (tableName: string) =>
      givenTable(
        tableName,
        `${db.serialIdColumn}, ${escapeId('kind')} ${db.textType}, ${escapeId('status')} ${db.textType}`,
      );

    it('should drop the index an entity replaced, only outside safe mode, and keep one named by hand', async () => {
      @Index((row) => [row.kind, row.status])
      @Entity()
      class AutoSyncReindexTest {
        @Id({ type: Number }) id?: number;
        @Field({ type: String }) kind?: string | null;
        @Field({ type: String }) status?: string | null;
      }

      const tableName = 'AutoSyncReindexTest';
      await givenKindStatusTable(tableName);
      await createIndex(tableName, 'AutoSyncReindexTest__status_idx', ['status']);
      await createIndex(tableName, 'hand_made_kind', ['kind']);
      const migrator = new Migrator(pool, { entities: [AutoSyncReindexTest] });

      await migrator.sync();
      expect(await indexNamesOf(tableName)).toEqual([
        'AutoSyncReindexTest__kind_status_idx',
        'AutoSyncReindexTest__status_idx',
        'hand_made_kind',
      ]);

      await migrator.sync({ safe: false });
      expect(await indexNamesOf(tableName)).toEqual(['AutoSyncReindexTest__kind_status_idx', 'hand_made_kind']);
      expect(await migrator.getDiffs()).toEqual([]);
    });

    it('should recreate an index whose declared columns changed under the same name', async () => {
      @Index((row) => [row.kind, row.status], { name: 'AutoSyncReshapeTest_lookup' })
      @Entity()
      class AutoSyncReshapeTest {
        @Id({ type: Number }) id?: number;
        @Field({ type: String }) kind?: string | null;
        @Field({ type: String }) status?: string | null;
      }

      const tableName = 'AutoSyncReshapeTest';
      await givenKindStatusTable(tableName);
      await createIndex(tableName, 'AutoSyncReshapeTest_lookup', ['kind']);
      const migrator = new Migrator(pool, { entities: [AutoSyncReshapeTest] });
      const columnsOfIndex = async () =>
        (await introspectTable(tableName)).indexes.map((index) => index.entries.map((entry) => entry.column));

      await migrator.sync();
      expect(await columnsOfIndex()).toEqual([['kind']]);

      await migrator.sync({ safe: false });
      expect(await columnsOfIndex()).toEqual([['kind', 'status']]);
      expect(await migrator.getDiffs()).toEqual([]);
    });

    it('should add multiple new properties to an existing entity', async () => {
      @Entity()
      class AutoSyncProductTest1 {
        @Id({ type: Number }) id?: number;
        @Field({ type: String }) name?: string | null;
        @Field({ type: Number }) price?: number | null;
        @Field({ type: String }) description?: string | null;
        @Field({ type: Boolean }) active?: boolean | null;
      }

      const tableName = 'AutoSyncProductTest1';
      await givenTable(tableName, `${db.serialIdColumn}, ${escapeId('name')} ${db.textType}`);

      await new Migrator(pool, { entities: [AutoSyncProductTest1] }).sync({ logging: true });

      expect(await columnNamesOf(tableName)).toEqual(['active', 'description', 'id', 'name', 'price']);
    });

    it('should not modify table when schema is already in sync', async () => {
      @Entity()
      class AutoSyncCategoryTest1 {
        @Id({ type: Number }) id?: number;
        @Field({ type: String }) name?: string | null;
      }

      const tableName = 'AutoSyncCategoryTest1';
      await givenTable(tableName, `${db.serialIdColumn}, ${escapeId('name')} ${db.textType}`);

      const before = await columnNamesOf(tableName);

      await new Migrator(pool, { entities: [AutoSyncCategoryTest1] }).sync({ logging: true });

      expect(await columnNamesOf(tableName)).toEqual(before);
    });

    it('should create a new table if it does not exist', async () => {
      @Entity()
      class AutoSyncNewTableTest1 {
        @Id({ type: Number }) id?: number;
        @Field({ type: String }) title?: string | null;
        @Field({ type: String }) content?: string | null;
      }

      const tableName = 'AutoSyncNewTableTest1';
      await givenNoTable(tableName);

      expect(await introspector.tableExists(tableName)).toBe(false);

      await new Migrator(pool, { entities: [AutoSyncNewTableTest1] }).sync({ logging: true });

      expect(await introspector.tableExists(tableName)).toBe(true);

      const ast = await introspector.introspect([tableName]);
      const table = ast.getTable(tableName);
      expect(table).toBeDefined();
      expect(table?.columns.size).toBe(3);
    });

    it('should handle entity with custom table name', async () => {
      @Entity({ name: 'custom_user_table' })
      class AutoSyncCustomNameTest1 {
        @Id({ type: Number }) id?: number;
        @Field({ type: String }) username?: string | null;
        @Field({ type: String }) email?: string | null;
      }

      const tableName = 'custom_user_table';
      await givenTable(tableName, `${db.serialIdColumn}, ${escapeId('username')} ${db.textType}`);

      await new Migrator(pool, { entities: [AutoSyncCustomNameTest1] }).sync({ logging: true });

      expect(await columnNamesOf(tableName)).toEqual(['email', 'id', 'username']);
    });

    it('should handle field with custom column name', async () => {
      @Entity()
      class AutoSyncCustomColumnTest1 {
        @Id({ type: Number }) id?: number;
        @Field({ type: String, name: 'user_email' }) email?: string | null;
      }

      const tableName = 'AutoSyncCustomColumnTest1';
      await givenTable(tableName, db.serialIdColumn);

      await new Migrator(pool, { entities: [AutoSyncCustomColumnTest1] }).sync({ logging: true });

      expect(await columnNamesOf(tableName)).toEqual(['id', 'user_email']);
    });

    it('should handle field rename safely (add new, keep old)', async () => {
      @Entity()
      class AutoSyncRenameTest {
        @Id({ type: Number }) id?: number;
        @Field({ type: String }) newName?: string | null;
      }

      const tableName = 'AutoSyncRenameTest';
      await givenTable(tableName, `${db.serialIdColumn}, ${escapeId('oldName')} ${db.textType}`);

      await new Migrator(pool, { entities: [AutoSyncRenameTest] }).sync({ logging: true });

      expect(await columnNamesOf(tableName)).toEqual(['id', 'newName', 'oldName']);
    });

    it('should drop old column and add new one when renaming with safe: false', async () => {
      @Entity()
      class AutoSyncUnsafeRenameTest {
        @Id({ type: Number }) id?: number;
        @Field({ type: String }) newName?: string | null;
      }

      const tableName = 'AutoSyncUnsafeRenameTest';
      await givenTable(tableName, `${db.serialIdColumn}, ${escapeId('oldName')} ${db.textType}`);

      await new Migrator(pool, { entities: [AutoSyncUnsafeRenameTest] }).sync({
        logging: true,
        safe: false,
        drop: true,
      });

      expect(await columnNamesOf(tableName)).toEqual(['id', 'newName']);
    });

    it('should NOT alter existing DOUBLE column to BIGINT for number field (Safe Mode)', async () => {
      @Entity()
      class AutoSyncFloatTest {
        @Id({ type: Number }) id?: number;
        @Field({ type: Number }) cost?: number | null;
      }

      const tableName = 'AutoSyncFloatTest';
      await givenTable(tableName, `${db.serialIdColumn}, ${escapeId('cost')} ${db.doubleType}`);

      await new Migrator(pool, { entities: [AutoSyncFloatTest] }).sync({ logging: true });

      const costCol = (await introspectTable(tableName)).columns.get('cost');
      expect(['float', 'decimal']).toContain(costCol?.type.category);
    });

    it('should block drops even if safe: false (when drop: false)', async () => {
      @Entity()
      class AutoSyncNoDropTest {
        @Id({ type: Number }) id?: number;
        @Field({ type: String }) name?: string | null;
      }

      const tableName = 'AutoSyncNoDropTest';
      await givenTable(
        tableName,
        `${db.serialIdColumn}, ${escapeId('name')} ${db.textType}, ${escapeId('extraColumn')} ${db.textType}`,
      );

      await new Migrator(pool, { entities: [AutoSyncNoDropTest] }).sync({ logging: true, safe: false });

      expect(await columnNamesOf(tableName)).toEqual(['extraColumn', 'id', 'name']);
    });

    /**
     * A key spelled like the column that will reference it, since an engine refuses a constraint whose
     * sides differ in signedness (`serialIdColumn` is unsigned on MySQL). The child is claimed first, so
     * the teardown drops it before the parent it points at.
     */
    /** A parent and a child whose `companyId` may point at it through `constraint`, declared inline as every engine takes it. */
    const givenRelatedTables = async (
      parent: string,
      child: string,
      constraint?: { name: string; action?: string },
    ) => {
      const idColumn = `${escapeId('id')} ${db.keyColumnType} PRIMARY KEY`;
      const foreignKey = constraint
        ? `, CONSTRAINT ${escapeId(constraint.name)} FOREIGN KEY (${escapeId('companyId')}) ` +
          `REFERENCES ${escapeId(parent)} (${escapeId('id')})${constraint.action ? ` ON DELETE ${constraint.action}` : ''}`
        : '';
      await givenNoTable(child);
      await givenTable(parent, idColumn);
      await pool.run(
        `CREATE TABLE ${escapeId(child)} (${idColumn}, ${escapeId('companyId')} ${db.keyColumnType}${foreignKey})`,
      );
    };

    /**
     * The whole point of the foreign-key diff: the constraint has to reach the database and the engine
     * has to accept the DDL, which no string assertion can prove.
     */
    it('should add a foreign key the table has not got', async () => {
      @Entity()
      class FkSyncCompany {
        @Id({ type: Number }) id?: number;
      }
      @Entity()
      class FkSyncEmployee {
        @Id({ type: Number }) id?: number;
        @Field({ references: () => FkSyncCompany, onDelete: 'CASCADE' }) companyId?: number | null;
      }

      await givenRelatedTables('FkSyncCompany', 'FkSyncEmployee');
      const fkTables = ['FkSyncCompany', 'FkSyncEmployee'];
      expect((await introspectTable('FkSyncEmployee', fkTables)).outgoingRelations).toHaveLength(0);

      await new Migrator(pool, { entities: [FkSyncCompany, FkSyncEmployee] }).sync({ logging: true });

      const relations = (await introspectTable('FkSyncEmployee', fkTables)).outgoingRelations;
      expect(relations).toHaveLength(1);
      expect(relations[0].to.table.name).toBe('FkSyncCompany');
      expect(relations[0].onDelete).toBe('CASCADE');
    });

    /**
     * The case the feature exists for, and the one no unit test can prove: changing `onDelete` on a
     * relation whose constraint is already there. It is a drop and an add, so it needs `safe: false`.
     */
    it('should alter a foreign key whose referential action changed', async () => {
      @Entity()
      class FkAlterCompany {
        @Id({ type: Number }) id?: number;
      }
      @Entity()
      class FkAlterEmployee {
        @Id({ type: Number }) id?: number;
        @Field({ references: () => FkAlterCompany, onDelete: 'SET NULL' }) companyId?: number | null;
      }

      await givenRelatedTables('FkAlterCompany', 'FkAlterEmployee', { name: 'fk_employee_company', action: 'CASCADE' });
      const fkTables = ['FkAlterCompany', 'FkAlterEmployee'];
      const before = await introspector.introspect(fkTables);
      expect(before.getTable('FkAlterEmployee')?.outgoingRelations[0].onDelete).toBe('CASCADE');

      await new Migrator(pool, { entities: [FkAlterCompany, FkAlterEmployee] }).sync({ logging: true, safe: false });

      const relations = (await introspectTable('FkAlterEmployee', fkTables)).outgoingRelations;
      expect(relations).toHaveLength(1);
      expect(relations[0].onDelete).toBe('SET NULL');
    });

    /**
     * A schema built from its own entities has no foreign key left to reconcile. A phantom here would
     * drop and re-add every constraint on every sync, forever.
     */
    it('should report no foreign key change on a schema it just created', async () => {
      @Entity()
      class FkStableCompany {
        @Id({ type: Number }) id?: number;
      }
      @Entity()
      class FkStableEmployee {
        @Id({ type: Number }) id?: number;
        @Field({ references: () => FkStableCompany, onDelete: 'CASCADE' }) companyId?: number | null;
      }

      await givenNoTable('FkStableEmployee');
      await givenNoTable('FkStableCompany');
      const migrator = new Migrator(pool, { entities: [FkStableCompany, FkStableEmployee] });
      await migrator.sync({ logging: true });

      expect(await migrator.planSync()).toEqual([]);
    });

    /** A foreign key to a table no entity names is left alone, as that table is, even by an unsafe sync. */
    it('should leave alone a foreign key to a table no entity names', async () => {
      @Entity()
      class FkUnnamedEmployee {
        @Id({ type: Number }) id?: number;
        @Field({ type: Number }) companyId?: number | null;
      }

      await givenRelatedTables('FkUnnamedCompany', 'FkUnnamedEmployee', { name: 'fk_unnamed_company' });

      const migrator = new Migrator(pool, { entities: [FkUnnamedEmployee] });

      expect(await migrator.planSync({ safe: false })).toEqual([]);
    });

    /**
     * The upgrade path for a database created while the serial was a fixed `BIGINT UNSIGNED`: the key
     * has to come back to the type it declares, or every foreign key pointing at it stays refused.
     * Signedness is the one part of a generated key's type the diff compares, for exactly this.
     */
    it.runIf(db.legacyUnsignedIdColumn)('should bring a legacy unsigned key back to its declared type', async () => {
      @Entity()
      class FkLegacyCompany {
        @Id({ type: Number }) id?: number;
      }
      @Entity()
      class FkLegacyEmployee {
        @Id({ type: Number }) id?: number;
        @Field({ references: () => FkLegacyCompany, onDelete: 'CASCADE' }) companyId?: number | null;
      }

      await givenNoTable('FkLegacyEmployee');
      const legacyKey = db.legacyUnsignedIdColumn;
      assertDefined(legacyKey);
      await givenTable('FkLegacyCompany', legacyKey);
      await pool.run(
        `CREATE TABLE ${escapeId('FkLegacyEmployee')} (${db.legacyUnsignedIdColumn}, ${escapeId('companyId')} ${db.keyColumnType})`,
      );

      const migrator = new Migrator(pool, { entities: [FkLegacyCompany, FkLegacyEmployee] });
      await migrator.sync({ logging: true, safe: false });

      const after = await introspector.introspect(['FkLegacyCompany', 'FkLegacyEmployee']);
      const companyKey = after.getTable('FkLegacyCompany')?.columns.get('id');
      assertDefined(companyKey);
      expect(companyKey.type.unsigned).toBeFalsy();
      // The point of the alter: the constraint can finally be created.
      expect(after.getTable('FkLegacyEmployee')?.outgoingRelations).toHaveLength(1);
      expect(await migrator.planSync({ safe: false })).toEqual([]);
    });

    /**
     * An enum is a column `CHECK`, so only the database can say it was emitted and is enforced, on a
     * column added to a table that exists as on a created one.
     */
    it('should constrain an enum column it adds to an existing table', async () => {
      @Entity()
      class SyncEnumAdded {
        @Id({ type: Number }) id?: number;
        @Field({ type: String, columnType: 'varchar', length: 20, enum: ['draft', 'paid'] as const })
        status?: 'draft' | 'paid' | null;
      }

      const tableName = 'SyncEnumAdded';
      await givenTable(tableName, db.serialIdColumn);

      await new Migrator(pool, { entities: [SyncEnumAdded] }).sync({ logging: true });

      await pool.run(`INSERT INTO ${escapeId(tableName)} (${escapeId('status')}) VALUES ('draft')`);
      await expect(
        pool.run(`INSERT INTO ${escapeId(tableName)} (${escapeId('status')}) VALUES ('bogus')`),
      ).rejects.toThrow();
    });

    it('should constrain an enum column on a table it creates', async () => {
      @Entity()
      class SyncEnumCreated {
        @Id({ type: Number }) id?: number;
        @Field({ type: String, columnType: 'varchar', length: 20, enum: ['on', 'off'] as const }) state?:
          | 'on'
          | 'off'
          | null;
      }

      await givenNoTable('SyncEnumCreated');
      const migrator = new Migrator(pool, { entities: [SyncEnumCreated] });
      await migrator.sync({ logging: true });

      await pool.run(`INSERT INTO ${escapeId('SyncEnumCreated')} (${escapeId('state')}) VALUES ('on')`);
      await expect(
        pool.run(`INSERT INTO ${escapeId('SyncEnumCreated')} (${escapeId('state')}) VALUES ('nope')`),
      ).rejects.toThrow();
      // A check is never diffed, so it must not read as a difference either.
      expect(await migrator.planSync()).toEqual([]);
    });

    /**
     * The limitation the enum-as-check decision carries, pinned so it cannot change unnoticed: a check
     * is never diffed, so adding a value emits nothing and the column goes on rejecting it. The
     * property type admits the value by then, which is what makes it silent. See architecture/roadmap.md.
     */
    it('should emit nothing when an enum gains a value, which the column keeps rejecting', async () => {
      @Entity({ name: 'SyncEnumWidened' })
      class Narrow {
        @Id({ type: Number }) id?: number;
        @Field({ type: String, columnType: 'varchar', length: 20, enum: ['draft', 'paid'] as const })
        status?: 'draft' | 'paid' | null;
      }

      await givenNoTable('SyncEnumWidened');
      await new Migrator(pool, { entities: [Narrow] }).sync({ logging: true });
      removeEntity(Narrow);

      @Entity({ name: 'SyncEnumWidened' })
      class Wide {
        @Id({ type: Number }) id?: number;
        @Field({ type: String, columnType: 'varchar', length: 20, enum: ['draft', 'paid', 'void'] as const })
        status?: 'draft' | 'paid' | 'void' | null;
      }
      const migrator = new Migrator(pool, { entities: [Wide] });

      expect(await migrator.planSync({ safe: false })).toEqual([]);
      await expect(
        pool.run(`INSERT INTO ${escapeId('SyncEnumWidened')} (${escapeId('status')}) VALUES ('void')`),
      ).rejects.toThrow();
      removeEntity(Wide);
    });

    /**
     * A table-level check is created with its table and never diffed. Both halves need the database:
     * that the expression is legal SQL for this engine, and that re-syncing reports nothing.
     */
    it('should enforce a table check and report no difference for it', async () => {
      // Unquoted, so every engine reads two identifiers: `"spent"` is a string literal on MySQL and
      // MariaDB, which makes the constraint compare two constants and reject every row.
      @Entity({ checks: [{ where: raw`spent <= balance` }] })
      class SyncChecked {
        @Id({ type: Number }) id?: number;
        @Field({ type: Number }) spent?: number | null;
        @Field({ type: Number }) balance?: number | null;
      }

      await givenNoTable('SyncChecked');
      const migrator = new Migrator(pool, { entities: [SyncChecked] });
      await migrator.sync({ logging: true });

      const cols = `${escapeId('spent')}, ${escapeId('balance')}`;
      await pool.run(`INSERT INTO ${escapeId('SyncChecked')} (${cols}) VALUES (1, 2)`);
      await expect(pool.run(`INSERT INTO ${escapeId('SyncChecked')} (${cols}) VALUES (5, 2)`)).rejects.toThrow();
      expect(await migrator.planSync()).toEqual([]);
    });

    /**
     * A comment reached MySQL inline and nothing else: `columnComment` was a boolean, so Postgres
     * landed on the same branch as SQLite and a documented column silently lost it. Only the database
     * can say the `COMMENT ON` was accepted and stored.
     */
    it.skipIf(db.dialect.features.commentSyntax === 'none')(
      'should document a column it creates and one it adds',
      async () => {
        @Entity()
        class SyncCommented {
          @Id({ type: Number }) id?: number;
          @Field({ type: String, columnType: 'varchar', length: 40, comment: "the author's name" }) author?:
            | string
            | null;
        }

        await givenNoTable('SyncCommented');
        await new Migrator(pool, { entities: [SyncCommented] }).sync({ logging: true });

        const created = await introspector.getTableSchema('SyncCommented');
        expect(created?.columns.find((it) => it.name === 'author')?.comment).toBe("the author's name");

        @Entity({ name: 'SyncCommented' })
        class SyncCommentedMore {
          @Id({ type: Number }) id?: number;
          @Field({ type: String, columnType: 'varchar', length: 40, comment: "the author's name" }) author?:
            | string
            | null;
          @Field({ type: String, columnType: 'varchar', length: 40, comment: 'where it ran' }) origin?: string | null;
        }

        await new Migrator(pool, { entities: [SyncCommentedMore] }).sync({ logging: true });

        const added = await introspector.getTableSchema('SyncCommented');
        expect(added?.columns.find((it) => it.name === 'origin')?.comment).toBe('where it ran');
      },
    );

    /**
     * A generated column is the one kind the engine fills, so only the engine can say the expression
     * is legal, the clause is spelled right, and a write to it is refused.
     */
    it('should keep a stored computed column, and refuse a write to it', async () => {
      @Entity()
      class SyncComputed {
        @Id({ type: Number }) id?: number;
        @Field({ type: Number }) qty?: number | null;
        @Field({ type: Number }) price?: number | null;
        @Field({ type: Number, computed: raw`qty * price`, stored: true }) total?: number | null;
      }

      await givenNoTable('SyncComputed');
      const migrator = new Migrator(pool, { entities: [SyncComputed] });
      await migrator.sync({ logging: true });

      await pool.insertOne(SyncComputed, { qty: 3, price: 7 });
      const [row] = await pool.findMany(SyncComputed, { $select: { total: true } });
      expect(row.total).toBe(21);

      // The point of `stored` is that it is a real column, so it filters and sorts without being
      // selected - the branch an inlined expression takes the other side of.
      await pool.insertOne(SyncComputed, { qty: 1, price: 2 });
      const filtered = await pool.findMany(SyncComputed, { $select: { qty: true }, $where: { total: { $gte: 10 } } });
      expect(filtered.map((it) => it.qty)).toEqual([3]);

      const sorted = await pool.findMany(SyncComputed, { $select: { qty: true }, $sort: { total: -1 } });
      expect(sorted.map((it) => it.qty)).toEqual([3, 1]);

      // The database owns the value; an insert naming it is an error on every engine here.
      const cols = `${escapeId('qty')}, ${escapeId('price')}, ${escapeId('total')}`;
      await expect(pool.run(`INSERT INTO ${escapeId('SyncComputed')} (${cols}) VALUES (1, 1, 99)`)).rejects.toThrow();

      expect(await migrator.planSync()).toEqual([]);
    });

    /** A table with a row in it, and the migrator that would give it a stored computed column. */
    const givenTableGainingAComputedColumn = async () => {
      @Entity({ name: 'SyncComputedAdded' })
      class ComputedBefore {
        @Id({ type: Number }) id?: number;
        @Field({ type: Number }) qty?: number | null;
      }

      await givenNoTable('SyncComputedAdded');
      await new Migrator(pool, { entities: [ComputedBefore] }).sync({ logging: true });
      await pool.insertOne(ComputedBefore, { qty: 4 });

      return new Migrator(pool, { entities: [ComputedAdded] });
    };

    /** Reading the value back is what shows the added column carries its expression. */
    it('should add a stored computed column to a table that already exists', async () => {
      const migrator = await givenTableGainingAComputedColumn();
      await migrator.sync({ logging: true });

      const [row] = await pool.findMany(ComputedAdded, { $select: { double: true } });
      expect(row.double).toBe(8);
      expect(await migrator.planSync()).toEqual([]);
    });

    /**
     * A retype SQLite makes only by rebuilding the table, which must bring through its rows, its index,
     * and the rows of a table pointing at it with `ON DELETE CASCADE`, which a rebuild with foreign keys
     * on deletes.
     */
    it('should keep every row through a retype, the ones pointing at the table included', async () => {
      @Entity({ name: 'RetypedParent' })
      class ParentBefore {
        @Id({ type: Number }) id?: number;
        @Field({ type: String, index: true }) name?: string | null;
        @Field({ type: String }) code?: string | null;
      }
      @Entity({ name: 'RetypedChild' })
      class ChildBefore {
        @Id({ type: Number }) id?: number;
        @Field({ references: () => ParentBefore, onDelete: 'CASCADE' }) parentId?: number | null;
      }

      await givenNoTable('RetypedChild');
      await givenNoTable('RetypedParent');
      await new Migrator(pool, { entities: [ParentBefore, ChildBefore] }).sync();
      const parentId = await pool.insertOne(ParentBefore, { name: 'a', code: '12' });
      await pool.insertOne(ChildBefore, { parentId });
      removeEntity(ParentBefore);
      removeEntity(ChildBefore);

      @Entity({ name: 'RetypedParent' })
      class ParentAfter {
        @Id({ type: Number }) id?: number;
        @Field({ type: String, index: true }) name?: string | null;
        @Field({ type: Number }) code?: number | null;
      }
      @Entity({ name: 'RetypedChild' })
      class ChildAfter {
        @Id({ type: Number }) id?: number;
        @Field({ references: () => ParentAfter, onDelete: 'CASCADE' }) parentId?: number | null;
      }
      const migrator = new Migrator(pool, { entities: [ParentAfter, ChildAfter] });
      await migrator.sync({ safe: false });

      expect(await pool.findMany(ParentAfter, { $select: { name: true, code: true } })).toMatchObject([
        { name: 'a', code: 12 },
      ]);
      expect(await pool.count(ChildAfter, { $where: { parentId } })).toBe(1);
      expect(await indexNamesOf('RetypedParent')).toEqual(['RetypedParent__name_idx']);
      expect(await migrator.planSync({ safe: false, drop: true })).toEqual([]);
      removeEntity(ParentAfter);
      removeEntity(ChildAfter);
    });

    /** A table holding `rows` rows with no `rank` in them, which the next entity asks for. */
    const givenRowsGainingRank = async (tableName: string, rows = 1) => {
      @Entity({ name: tableName })
      class Before {
        @Id({ type: Number }) id?: number;
        @Field({ type: String }) name?: string | null;
        @Field({ type: Number }) rank?: number | null;
      }
      await givenNoTable(tableName);
      await new Migrator(pool, { entities: [Before] }).sync();
      await pool.insertMany(
        Before,
        Array.from({ length: rows }, () => ({ name: 'a' })),
      );
      removeEntity(Before);
    };

    /**
     * A required column with no default has nothing to fill the rows already there with: Postgres, SQL
     * Server and SQLite fail, and MySQL would guess a zero. Refused before anything runs, with the count.
     */
    it('should refuse to require a column with no default on a table holding rows', async () => {
      await givenRowsGainingRank('RequiredRank');

      @Entity({ name: 'RequiredRank' })
      class After {
        @Id({ type: Number }) id?: number;
        @Field({ type: String }) name?: string | null;
        @Field({ type: Number, nullable: false }) rank?: number;
      }

      await expect(new Migrator(pool, { entities: [After] }).sync({ safe: false })).rejects.toThrow(
        '"RequiredRank"."rank" is required with no default, and 1 row holds none',
      );
      removeEntity(After);
    });

    it('should refuse to add a required column with no default to a table holding rows', async () => {
      await givenRowsGainingRank('RequiredAdded', 2);

      @Entity({ name: 'RequiredAdded' })
      class After {
        @Id({ type: Number }) id?: number;
        @Field({ type: String }) name?: string | null;
        @Field({ type: Number }) rank?: number | null;
        @Field({ type: Number, nullable: false }) score?: number;
      }

      await expect(new Migrator(pool, { entities: [After] }).sync()).rejects.toThrow(
        '"RequiredAdded"."score" is required with no default, and 2 rows hold none',
      );
      removeEntity(After);
    });

    it('should add a required column with no default to a table holding no rows', async () => {
      @Entity({ name: 'RequiredEmpty' })
      class Before {
        @Id({ type: Number }) id?: number;
      }
      await givenNoTable('RequiredEmpty');
      await new Migrator(pool, { entities: [Before] }).sync();
      removeEntity(Before);

      @Entity({ name: 'RequiredEmpty' })
      class After {
        @Id({ type: Number }) id?: number;
        @Field({ type: Number, nullable: false }) rank?: number;
      }
      const migrator = new Migrator(pool, { entities: [After] });
      await migrator.sync();

      expect(await columnNamesOf('RequiredEmpty')).toEqual(['id', 'rank']);
      expect(await migrator.planSync({ safe: false, drop: true })).toEqual([]);
      removeEntity(After);
    });

    it('should fill the rows of a column it requires with the default it declares', async () => {
      await givenRowsGainingRank('RequiredDefault');

      @Entity({ name: 'RequiredDefault' })
      class After {
        @Id({ type: Number }) id?: number;
        @Field({ type: String }) name?: string | null;
        @Field({ type: Number, nullable: false, defaultValue: 5 }) rank?: number;
      }
      const migrator = new Migrator(pool, { entities: [After] });
      await migrator.sync({ safe: false });

      expect(await pool.findMany(After, { $select: { rank: true } })).toMatchObject([{ rank: 5 }]);
      expect(await migrator.planSync({ safe: false, drop: true })).toEqual([]);
      removeEntity(After);
    });

    it('should log skipped migrations when safe mode blocks changes', async () => {
      @Entity()
      class AutoSyncLogTest {
        @Id({ type: Number }) id?: number;
        @Field({ type: String }) name?: string | null;
      }

      const tableName = 'AutoSyncLogTest';
      await givenTable(
        tableName,
        `${db.serialIdColumn}, ${escapeId('name')} ${db.textType}, ${escapeId('extraColumn')} ${db.textType}`,
      );

      const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      try {
        await new Migrator(pool, { entities: [AutoSyncLogTest], logger: true }).sync({ logging: true });

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('skipped migration:'));
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Skipped 1 column changes'));
      } finally {
        consoleSpy.mockRestore();
      }
    });

    it('should alter column type when safe: false', async () => {
      @Entity()
      class AutoSyncUnsafeAlterTest {
        @Id({ type: Number }) id?: number;
        @Field({ type: Number }) cost?: number | null; // Defaults to bigint
      }

      const tableName = 'AutoSyncUnsafeAlterTest';
      await givenTable(tableName, `${db.serialIdColumn}, ${escapeId('cost')} ${db.doubleType}`);

      await new Migrator(pool, { entities: [AutoSyncUnsafeAlterTest] }).sync({ logging: true, safe: false });

      const costCol = (await introspectTable(tableName)).columns.get('cost');
      assertDefined(costCol);
      const type = costCol.type.category.toLowerCase();
      expect(type).toContain('int');
      expect(type).not.toContain('double');
    });
  });
}
