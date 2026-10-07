import { afterAll, afterEach, beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest';
import { Entity, Field, Id, Index } from '../entity/index.js';
import { assertDefined } from '../test/index.js';
import { type SqlPool, sqlPools } from '../test/sqlPools.js';
import { idKey, type SchemaIntrospector, type SqlQuerierPool } from '../type/index.js';
import { raw } from '../util/index.js';
import { introspectorFor } from './introspection/registry.js';
import { Migrator } from './migrator.js';
import { SqlSchemaGenerator } from './schemaGenerator.js';

/** How the engine spells the columns a test writes by hand, seeding the table a sync is then asked to reconcile. */
export interface DatabaseConfig {
  serialIdColumn: string;
  /** The plain integer a caller-supplied key column takes, which is not the auto-increment type. */
  keyColumnType: string;
  textType: string;
  doubleType: string;
  /** Whether the engine keeps a column's comment, which SQLite and SQL Server do not. */
  keepsComments: boolean;
}

/** One engine's run of the shared sync suite; each engine is its own test file, so vitest runs them in parallel. */
export function describeMigratorSync(engine: SqlPool[0], db: DatabaseConfig) {
  const [[, connect, { features }]] = sqlPools('test_sync').filter(([name]) => name === engine);

  describe(`Migrator sync on ${engine}`, () => {
    let pool: SqlQuerierPool;
    let introspector: SchemaIntrospector;
    const claimed = new Set<string>();

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
      pool = connect();
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

    /**
     * A schema created from its own entities has nothing left to reconcile. Anything reported here is a
     * phantom, a column the generator spells otherwise than the engine stores it or an index it fails to
     * recognise, and it would re-run on every sync.
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
        @Field({ type: Boolean, defaultValue: false }) off?: boolean | null;
        @Field({ type: Boolean, defaultValue: true }) on?: boolean | null;
      }

      await givenNoTable('AutoSyncDefaultsTest');
      const migrator = new Migrator(pool, { entities: [AutoSyncDefaultsTest] });
      await migrator.sync();

      expect(await migrator.planSync({ safe: false, drop: true })).toEqual([]);
    });

    /**
     * A table keyed by one column, an entity that now declares two. The key itself has to change, not just
     * the column, and in the order declared, since `(a, b)` is a different key from `(b, a)`.
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
      const keyColumns = async () => (await introspectTable(tableName)).primaryKey?.columns;

      // Rewriting a key rebuilds an index over every row, so safe mode holds it back.
      const migrator = new Migrator(pool, { entities: [AutoSyncKeyTest] });
      await migrator.sync();
      expect(await keyColumns()).toEqual(['userId']);

      await migrator.sync({ safe: false });
      expect(await keyColumns()).toEqual(['userId', 'groupId']);
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

      await new Migrator(pool, { entities: [AutoSyncIndexTest] }).sync();

      expect(await indexNamesOf(tableName)).toEqual(['AutoSyncIndexTest__email_idx']);
    });

    it('should drop the index an entity replaced, only outside safe mode, and keep one named by hand', async () => {
      @Index((row) => [row.kind, row.status])
      @Entity()
      class AutoSyncReindexTest {
        @Id({ type: Number }) id?: number;
        @Field({ type: String }) kind?: string | null;
        @Field({ type: String }) status?: string | null;
      }

      const tableName = 'AutoSyncReindexTest';
      await givenTable(
        tableName,
        `${db.serialIdColumn}, ${escapeId('kind')} ${db.textType}, ${escapeId('status')} ${db.textType}`,
      );
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

      await new Migrator(pool, { entities: [AutoSyncProductTest1] }).sync();

      expect(await columnNamesOf(tableName)).toEqual(['active', 'description', 'id', 'name', 'price']);
    });

    it('should have nothing to do on a table written as the entity declares it', async () => {
      @Entity()
      class AutoSyncCategoryTest1 {
        @Id({ type: Number }) id?: number;
        @Field({ type: String }) name?: string | null;
      }

      await givenTable('AutoSyncCategoryTest1', `${db.serialIdColumn}, ${escapeId('name')} ${db.textType}`);

      const migrator = new Migrator(pool, { entities: [AutoSyncCategoryTest1] });

      expect(await migrator.planSync({ safe: false, drop: true })).toEqual([]);
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

      await new Migrator(pool, { entities: [AutoSyncNewTableTest1] }).sync();

      expect(await columnNamesOf(tableName)).toEqual(['content', 'id', 'title']);
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

      await new Migrator(pool, { entities: [AutoSyncCustomNameTest1] }).sync();

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

      await new Migrator(pool, { entities: [AutoSyncCustomColumnTest1] }).sync();

      expect(await columnNamesOf(tableName)).toEqual(['id', 'user_email']);
    });

    /** A renamed field reads as a column added and one dropped, so its old column stays until a drop is asked for. */
    it('should drop a column the entity no longer declares only given safe: false and drop: true, logging why not', async () => {
      @Entity()
      class AutoSyncRenameTest {
        @Id({ type: Number }) id?: number;
        @Field({ type: String }) newName?: string | null;
      }

      const tableName = 'AutoSyncRenameTest';
      await givenTable(tableName, `${db.serialIdColumn}, ${escapeId('oldName')} ${db.textType}`);
      const migrator = new Migrator(pool, { entities: [AutoSyncRenameTest] });
      const skipped = vi.spyOn(migrator.logger, 'logSkippedMigration');

      await migrator.sync();
      await migrator.sync({ safe: false });
      expect(await columnNamesOf(tableName)).toEqual(['id', 'newName', 'oldName']);
      expect(skipped.mock.calls).toEqual([
        [
          "[AutoSync] Skipped 1 column changes in table 'AutoSyncRenameTest': oldName (safe mode active. Use a migration or { safe: false } to apply).",
        ],
        [
          "[AutoSync] Skipped 1 column drops in table 'AutoSyncRenameTest': oldName (drop: false. Use { drop: true } to apply).",
        ],
      ]);

      await migrator.sync({ safe: false, drop: true });
      expect(await columnNamesOf(tableName)).toEqual(['id', 'newName']);
    });

    it('should retype a DOUBLE column to the integer a number field declares, only outside safe mode', async () => {
      @Entity()
      class AutoSyncFloatTest {
        @Id({ type: Number }) id?: number;
        @Field({ type: Number }) cost?: number | null;
      }

      const tableName = 'AutoSyncFloatTest';
      await givenTable(tableName, `${db.serialIdColumn}, ${escapeId('cost')} ${db.doubleType}`);
      const costCategory = async () => (await introspectTable(tableName)).columns.get('cost')?.type.category;
      const migrator = new Migrator(pool, { entities: [AutoSyncFloatTest] });

      await migrator.sync();
      expect(await costCategory()).toBe('float');

      await migrator.sync({ safe: false });
      expect(await costCategory()).toBe('integer');
    });

    /**
     * A parent and a child whose `companyId` may point at it through `constraint`, declared inline as every
     * engine takes it. The child is claimed first, so the teardown drops it before the parent it points at.
     */
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

    /** The foreign keys of `child` as the database reports them: the table each points at, and its delete action. */
    const foreignKeysOf = async (parent: string, child: string) =>
      (await introspectTable(child, [parent, child])).outgoingRelations.map((relation) => [
        relation.to.table.name,
        relation.onDelete,
      ]);

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
      expect(await foreignKeysOf('FkSyncCompany', 'FkSyncEmployee')).toEqual([]);

      await new Migrator(pool, { entities: [FkSyncCompany, FkSyncEmployee] }).sync();

      expect(await foreignKeysOf('FkSyncCompany', 'FkSyncEmployee')).toEqual([['FkSyncCompany', 'CASCADE']]);
    });

    /** A forced sync drops what the last one created, so a cycle of foreign keys has to come down too. */
    it('should force a sync over a cycle of foreign keys it created', async () => {
      @Entity()
      class FkCycleCompany {
        @Id({ type: Number }) id?: number;
        @Field({ references: () => FkCycleEmployee }) ownerId?: number | null;
      }
      @Entity()
      class FkCycleEmployee {
        @Id({ type: Number }) id?: number;
        @Field({ references: () => FkCycleCompany }) companyId?: number | null;
      }
      const entities = [FkCycleCompany, FkCycleEmployee];
      const tables = ['FkCycleCompany', 'FkCycleEmployee'];
      // The cycle defeats the per-table teardown, so it comes down as a forced sync takes it down.
      onTestFinished(async () => {
        const existing = await introspector.introspect(tables);
        for (const sql of new SqlSchemaGenerator(pool.dialect).generateDropSchema(entities, {
          ifExists: true,
          existing,
        })) {
          await pool.run(sql);
        }
      });
      const migrator = new Migrator(pool, { entities });

      await migrator.sync({ force: true });
      const companyId = await pool.insertOne(FkCycleCompany, {});
      await pool.insertOne(FkCycleEmployee, { companyId });
      await migrator.sync({ force: true });

      expect(await pool.count(FkCycleEmployee, {})).toBe(0);
      const relations = (await introspectTable('FkCycleEmployee', tables)).outgoingRelations;
      expect(relations.map((relation) => relation.to.table.name)).toEqual(['FkCycleCompany']);
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

      // A drop and an add: safe mode holds both, or the add would collide with the constraint still there.
      const migrator = new Migrator(pool, { entities: [FkAlterCompany, FkAlterEmployee] });
      await migrator.sync();
      expect(await foreignKeysOf('FkAlterCompany', 'FkAlterEmployee')).toEqual([['FkAlterCompany', 'CASCADE']]);

      await migrator.sync({ safe: false });
      expect(await foreignKeysOf('FkAlterCompany', 'FkAlterEmployee')).toEqual([['FkAlterCompany', 'SET NULL']]);
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
      await migrator.sync();

      expect(await migrator.planSync({ safe: false, drop: true })).toEqual([]);
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
     * A key a database created while the serial was a fixed `BIGINT UNSIGNED` has to come back to the type
     * it declares, or every foreign key pointing at it stays refused. Signedness is the one part of a
     * generated key's type the diff compares, for exactly this.
     */
    it.runIf(features.supportsUnsigned)('should bring a legacy unsigned key back to its declared type', async () => {
      @Entity()
      class FkLegacyCompany {
        @Id({ type: Number }) id?: number;
      }
      @Entity()
      class FkLegacyEmployee {
        @Id({ type: Number }) id?: number;
        @Field({ references: () => FkLegacyCompany, onDelete: 'CASCADE' }) companyId?: number | null;
      }

      const legacyKey = `${escapeId('id')} BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY`;
      await givenNoTable('FkLegacyEmployee');
      await givenTable('FkLegacyCompany', legacyKey);
      await pool.run(
        `CREATE TABLE ${escapeId('FkLegacyEmployee')} (${legacyKey}, ${escapeId('companyId')} ${db.keyColumnType})`,
      );

      const migrator = new Migrator(pool, { entities: [FkLegacyCompany, FkLegacyEmployee] });
      await migrator.sync({ safe: false });

      expect((await introspectTable('FkLegacyCompany')).columns.get('id')?.type.unsigned).toBe(undefined);
      // The point of the alter: the constraint can finally be created.
      expect(await foreignKeysOf('FkLegacyCompany', 'FkLegacyEmployee')).toEqual([['FkLegacyCompany', 'CASCADE']]);
      expect(await migrator.planSync({ safe: false, drop: true })).toEqual([]);
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

      await new Migrator(pool, { entities: [SyncEnumAdded] }).sync();

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
      await migrator.sync();

      await pool.run(`INSERT INTO ${escapeId('SyncEnumCreated')} (${escapeId('state')}) VALUES ('on')`);
      await expect(
        pool.run(`INSERT INTO ${escapeId('SyncEnumCreated')} (${escapeId('state')}) VALUES ('nope')`),
      ).rejects.toThrow();
      // The check reads back under the name it was installed with.
      expect(await migrator.planSync({ safe: false, drop: true })).toEqual([]);
    });

    /**
     * A table-level check is created with its table. Both halves need the database: that the expression
     * is legal SQL for this engine, and that it reads back under the name it was installed with.
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
      await migrator.sync();

      const cols = `${escapeId('spent')}, ${escapeId('balance')}`;
      await pool.run(`INSERT INTO ${escapeId('SyncChecked')} (${cols}) VALUES (1, 2)`);
      await expect(pool.run(`INSERT INTO ${escapeId('SyncChecked')} (${cols}) VALUES (5, 2)`)).rejects.toThrow();
      expect(await migrator.planSync({ safe: false, drop: true })).toEqual([]);
    });

    /** Only the database can say the comment was accepted and stored, inline or as a statement of its own. */
    it.runIf(db.keepsComments)('should document a column it creates and one it adds', async () => {
      @Entity()
      class SyncCommented {
        @Id({ type: Number }) id?: number;
        @Field({ type: String, columnType: 'varchar', length: 40, comment: "the author's name" }) author?:
          | string
          | null;
      }

      await givenNoTable('SyncCommented');
      await new Migrator(pool, { entities: [SyncCommented] }).sync();

      const commentOf = async (column: string) => (await introspectTable('SyncCommented')).columns.get(column)?.comment;
      expect(await commentOf('author')).toBe("the author's name");

      @Entity({ name: 'SyncCommented' })
      class SyncCommentedMore {
        @Id({ type: Number }) id?: number;
        @Field({ type: String, columnType: 'varchar', length: 40, comment: "the author's name" }) author?:
          | string
          | null;
        @Field({ type: String, columnType: 'varchar', length: 40, comment: 'where it ran' }) origin?: string | null;
      }

      await new Migrator(pool, { entities: [SyncCommentedMore] }).sync();

      expect(await commentOf('origin')).toBe('where it ran');
    });

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
      await migrator.sync();

      await pool.insertOne(SyncComputed, { qty: 3, price: 7 });
      const [row] = await pool.findMany(SyncComputed, { $select: { total: true } });
      expect(row.total).toBe(21);

      // The point of `stored` is that it is a real column, so it filters and sorts without being
      // selected, the branch an inlined expression takes the other side of.
      await pool.insertOne(SyncComputed, { qty: 1, price: 2 });
      const filtered = await pool.findMany(SyncComputed, { $select: { qty: true }, $where: { total: { $gte: 10 } } });
      expect(filtered.map((it) => it.qty)).toEqual([3]);

      const sorted = await pool.findMany(SyncComputed, { $select: { qty: true }, $sort: { total: -1 } });
      expect(sorted.map((it) => it.qty)).toEqual([3, 1]);

      // The database owns the value; an insert naming it is an error on every engine here.
      const cols = `${escapeId('qty')}, ${escapeId('price')}, ${escapeId('total')}`;
      await expect(pool.run(`INSERT INTO ${escapeId('SyncComputed')} (${cols}) VALUES (1, 1, 99)`)).rejects.toThrow();

      expect(await migrator.planSync({ safe: false, drop: true })).toEqual([]);
    });

    /** Reading the value back is what shows the added column carries its expression. */
    it('should add a stored computed column to a table that already exists', async () => {
      @Entity({ name: 'SyncComputedAdded' })
      class Before {
        @Id({ type: Number }) id?: number;
        @Field({ type: Number }) qty?: number | null;
      }
      @Entity({ name: 'SyncComputedAdded' })
      class After {
        @Id({ type: Number }) id?: number;
        @Field({ type: Number }) qty?: number | null;
        @Field({ type: Number, computed: raw`qty * 2`, stored: true }) double?: number | null;
      }

      await givenNoTable('SyncComputedAdded');
      await new Migrator(pool, { entities: [Before] }).sync();
      await pool.insertOne(Before, { qty: 4 });
      const migrator = new Migrator(pool, { entities: [After] });
      await migrator.sync();

      expect(await pool.findMany(After, { $select: { double: true } })).toEqual([{ double: 8 }]);
      expect(await migrator.planSync({ safe: false, drop: true })).toEqual([]);
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

      await givenNoTable('RetypedChild');
      await givenNoTable('RetypedParent');
      await new Migrator(pool, { entities: [ParentBefore, ChildBefore] }).sync();
      const parentId = await pool.insertOne(ParentBefore, { name: 'a', code: '12' });
      await pool.insertOne(ChildBefore, { parentId });
      const migrator = new Migrator(pool, { entities: [ParentAfter, ChildAfter] });
      await migrator.sync({ safe: false });

      expect(await pool.findMany(ParentAfter, { $select: { name: true, code: true } })).toEqual([
        { name: 'a', code: 12 },
      ]);
      expect(await pool.count(ChildAfter, { $where: { parentId } })).toBe(1);
      expect(await indexNamesOf('RetypedParent')).toEqual(['RetypedParent__name_idx']);
      expect(await migrator.planSync({ safe: false, drop: true })).toEqual([]);
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
    });

    it('should add a required column with no default to a table holding no rows', async () => {
      @Entity({ name: 'RequiredEmpty' })
      class Before {
        @Id({ type: Number }) id?: number;
      }
      @Entity({ name: 'RequiredEmpty' })
      class After {
        @Id({ type: Number }) id?: number;
        @Field({ type: Number, nullable: false }) rank?: number;
      }

      await givenNoTable('RequiredEmpty');
      await new Migrator(pool, { entities: [Before] }).sync();
      const migrator = new Migrator(pool, { entities: [After] });
      await migrator.sync();

      expect(await columnNamesOf('RequiredEmpty')).toEqual(['id', 'rank']);
      expect(await migrator.planSync({ safe: false, drop: true })).toEqual([]);
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

      expect(await pool.findMany(After, { $select: { rank: true } })).toEqual([{ rank: 5 }]);
      expect(await migrator.planSync({ safe: false, drop: true })).toEqual([]);
    });
  });
}
