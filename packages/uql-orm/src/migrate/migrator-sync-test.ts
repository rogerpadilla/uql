import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AbstractSqlDialect } from '../dialect/index.js';
import { Entity, Field, Id, removeEntity } from '../entity/index.js';
import { idKey } from '../type/index.js';
import type { SchemaIntrospector, SqlQuerierPool } from '../type/index.js';
import { raw } from '../util/index.js';
import { Migrator } from './migrator.js';

export interface DatabaseConfig {
  name: string;
  /** A factory, not a pool: nothing is opened for a backend whose suite never runs. */
  createPool: () => SqlQuerierPool;
  createIntrospector: (pool: SqlQuerierPool) => SchemaIntrospector;
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
  @Field({ type: Number }) qty?: number;
  @Field({ type: Number, computed: raw`qty * 2`, stored: true }) double?: number;
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
      introspector = db.createIntrospector(pool);
    });

    afterAll(() => pool.end());

    // Teardown here rather than trailing each test: a failed expectation used to leak its table into
    // the shared database, where the next run's introspection would find it.
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
        @Field({ type: String }) name?: string;
        @Field({ type: String }) email?: string;
      }

      const tableName = 'AutoSyncUserTest1';
      await givenTable(tableName, `${db.serialIdColumn}, ${escapeId('name')} ${db.textType}`);

      const before = await introspector.introspect([tableName]);
      expect(before.getTable(tableName)).toBeDefined();
      expect(Array.from(before.getTable(tableName)!.columns.keys()).sort()).toEqual(['id', 'name']);

      await new Migrator(pool, { entities: [AutoSyncUserTest1] }).sync({ logging: true });

      const after = await introspector.introspect([tableName]);
      expect(after.getTable(tableName)).toBeDefined();
      expect(Array.from(after.getTable(tableName)!.columns.keys()).sort()).toEqual(['email', 'id', 'name']);
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
        @Field({ type: String }) name?: string;
        @Field({ type: String, index: true }) email?: string;
        @Field({ type: Number }) cost?: number;
        @Field({ type: Boolean }) active?: boolean;
      }

      await givenNoTable('AutoSyncSettledTest');
      const migrator = new Migrator(pool, { entities: [AutoSyncSettledTest] });
      await migrator.sync();

      expect(await migrator.planSync({ safe: false, drop: true })).toEqual([]);
    });

    /**
     * The upgrade the composite-key work exists for: a table keyed by one column, an entity that now
     * declares two. The key itself has to change, not just the column - and it has to come back in
     * the order declared, since `(a, b)` is a different key from `(b, a)`.
     */
    it.skipIf(!db.dialect.features.primaryKeyAlter)('should widen a single-column key to a composite one', async () => {
      @Entity()
      class AutoSyncKeyTest {
        [idKey]?: 'userId' | 'groupId';
        @Id({ type: Number }) userId?: number;
        @Id({ type: Number }) groupId?: number;
        @Field({ type: String }) note?: string;
      }

      const tableName = 'AutoSyncKeyTest';
      await givenTable(
        tableName,
        `${escapeId('userId')} ${db.keyColumnType} NOT NULL, ${escapeId('note')} ${db.textType}, PRIMARY KEY (${escapeId('userId')})`,
      );

      const before = await introspector.getTableSchema(tableName);
      expect(before?.primaryKey).toEqual(['userId']);

      await new Migrator(pool, { entities: [AutoSyncKeyTest] }).sync({ safe: false });

      const after = await introspector.getTableSchema(tableName);
      expect(after?.primaryKey).toEqual(['userId', 'groupId']);
    });

    /** SQLite can only rebuild the table, so it refuses by name rather than emitting DDL. */
    it.skipIf(db.dialect.features.primaryKeyAlter)('should refuse to change a key it cannot alter', async () => {
      @Entity()
      class AutoSyncKeyRefusedTest {
        [idKey]?: 'userId' | 'groupId';
        @Id({ type: Number }) userId?: number;
        @Id({ type: Number }) groupId?: number;
      }

      const tableName = 'AutoSyncKeyRefusedTest';
      await givenTable(
        tableName,
        `${escapeId('userId')} ${db.keyColumnType} NOT NULL, PRIMARY KEY (${escapeId('userId')})`,
      );

      await expect(new Migrator(pool, { entities: [AutoSyncKeyRefusedTest] }).sync({ safe: false })).rejects.toThrow(
        'Cannot change the primary key',
      );
    });

    it('should create an index the entity declares on a table that already exists', async () => {
      @Entity()
      class AutoSyncIndexTest {
        @Id({ type: Number }) id?: number;
        @Field({ type: String, index: true }) email?: string;
      }

      const tableName = 'AutoSyncIndexTest';
      await givenTable(tableName, `${db.serialIdColumn}, ${escapeId('email')} ${db.textType}`);

      const before = await introspector.introspect([tableName]);
      expect(before.getTable(tableName)!.indexes).toEqual([]);

      await new Migrator(pool, { entities: [AutoSyncIndexTest] }).sync({ logging: true });

      const after = await introspector.introspect([tableName]);
      expect(after.getTable(tableName)!.indexes.map((index) => index.name)).toEqual(['AutoSyncIndexTest__email_idx']);
    });

    it('should add multiple new properties to an existing entity', async () => {
      @Entity()
      class AutoSyncProductTest1 {
        @Id({ type: Number }) id?: number;
        @Field({ type: String }) name?: string;
        @Field({ type: Number }) price?: number;
        @Field({ type: String }) description?: string;
        @Field({ type: Boolean }) active?: boolean;
      }

      const tableName = 'AutoSyncProductTest1';
      await givenTable(tableName, `${db.serialIdColumn}, ${escapeId('name')} ${db.textType}`);

      await new Migrator(pool, { entities: [AutoSyncProductTest1] }).sync({ logging: true });

      const ast = await introspector.introspect([tableName]);
      const table = ast.getTable(tableName);
      expect(table).toBeDefined();
      expect(Array.from(table!.columns.keys()).sort()).toEqual(['active', 'description', 'id', 'name', 'price']);
    });

    it('should not modify table when schema is already in sync', async () => {
      @Entity()
      class AutoSyncCategoryTest1 {
        @Id({ type: Number }) id?: number;
        @Field({ type: String }) name?: string;
      }

      const tableName = 'AutoSyncCategoryTest1';
      await givenTable(tableName, `${db.serialIdColumn}, ${escapeId('name')} ${db.textType}`);

      const before = await introspector.introspect([tableName]);
      expect(before.getTable(tableName)).toBeDefined();

      await new Migrator(pool, { entities: [AutoSyncCategoryTest1] }).sync({ logging: true });

      const after = await introspector.introspect([tableName]);
      expect(after.getTable(tableName)).toBeDefined();
      expect(after.getTable(tableName)!.columns.size).toBe(before.getTable(tableName)!.columns.size);
    });

    it('should create a new table if it does not exist', async () => {
      @Entity()
      class AutoSyncNewTableTest1 {
        @Id({ type: Number }) id?: number;
        @Field({ type: String }) title?: string;
        @Field({ type: String }) content?: string;
      }

      const tableName = 'AutoSyncNewTableTest1';
      await givenNoTable(tableName);

      expect(await introspector.tableExists(tableName)).toBe(false);

      await new Migrator(pool, { entities: [AutoSyncNewTableTest1] }).sync({ logging: true });

      expect(await introspector.tableExists(tableName)).toBe(true);

      const ast = await introspector.introspect([tableName]);
      const table = ast.getTable(tableName);
      expect(table).toBeDefined();
      expect(table!.columns.size).toBe(3);
    });

    it('should handle entity with custom table name', async () => {
      @Entity({ name: 'custom_user_table' })
      class AutoSyncCustomNameTest1 {
        @Id({ type: Number }) id?: number;
        @Field({ type: String }) username?: string;
        @Field({ type: String }) email?: string;
      }

      const tableName = 'custom_user_table';
      await givenTable(tableName, `${db.serialIdColumn}, ${escapeId('username')} ${db.textType}`);

      await new Migrator(pool, { entities: [AutoSyncCustomNameTest1] }).sync({ logging: true });

      const ast = await introspector.introspect([tableName]);
      const table = ast.getTable(tableName);
      expect(table).toBeDefined();
      expect(Array.from(table!.columns.keys()).sort()).toEqual(['email', 'id', 'username']);
    });

    it('should handle field with custom column name', async () => {
      @Entity()
      class AutoSyncCustomColumnTest1 {
        @Id({ type: Number }) id?: number;
        @Field({ type: String, name: 'user_email' }) email?: string;
      }

      const tableName = 'AutoSyncCustomColumnTest1';
      await givenTable(tableName, db.serialIdColumn);

      await new Migrator(pool, { entities: [AutoSyncCustomColumnTest1] }).sync({ logging: true });

      const ast = await introspector.introspect([tableName]);
      const table = ast.getTable(tableName);
      expect(table).toBeDefined();
      expect(Array.from(table!.columns.keys()).sort()).toEqual(['id', 'user_email']);
    });

    it('should handle field rename safely (add new, keep old)', async () => {
      @Entity()
      class AutoSyncRenameTest {
        @Id({ type: Number }) id?: number;
        @Field({ type: String }) newName?: string;
      }

      const tableName = 'AutoSyncRenameTest';
      await givenTable(tableName, `${db.serialIdColumn}, ${escapeId('oldName')} ${db.textType}`);

      await new Migrator(pool, { entities: [AutoSyncRenameTest] }).sync({ logging: true });

      const ast = await introspector.introspect([tableName]);
      const table = ast.getTable(tableName);
      expect(table).toBeDefined();
      expect(Array.from(table!.columns.keys()).sort()).toEqual(['id', 'newName', 'oldName']);
    });

    it('should drop old column and add new one when renaming with safe: false', async () => {
      @Entity()
      class AutoSyncUnsafeRenameTest {
        @Id({ type: Number }) id?: number;
        @Field({ type: String }) newName?: string;
      }

      const tableName = 'AutoSyncUnsafeRenameTest';
      await givenTable(tableName, `${db.serialIdColumn}, ${escapeId('oldName')} ${db.textType}`);

      await new Migrator(pool, { entities: [AutoSyncUnsafeRenameTest] }).sync({
        logging: true,
        safe: false,
        drop: true,
      });

      const ast = await introspector.introspect([tableName]);
      const table = ast.getTable(tableName);
      expect(table).toBeDefined();
      expect(Array.from(table!.columns.keys()).sort()).toEqual(['id', 'newName']);
    });

    it('should NOT alter existing DOUBLE column to BIGINT for number field (Safe Mode)', async () => {
      @Entity()
      class AutoSyncFloatTest {
        @Id({ type: Number }) id?: number;
        @Field({ type: Number }) cost?: number;
      }

      const tableName = 'AutoSyncFloatTest';
      await givenTable(tableName, `${db.serialIdColumn}, ${escapeId('cost')} ${db.doubleType}`);

      await new Migrator(pool, { entities: [AutoSyncFloatTest] }).sync({ logging: true });

      const ast = await introspector.introspect([tableName]);
      const table = ast.getTable(tableName);
      expect(table).toBeDefined();

      const costCol = table!.columns.get('cost');
      expect(costCol).toBeDefined();

      const type = costCol!.type.category.toLowerCase();
      const isFloatCompatible =
        type.includes('double') || type.includes('float') || type.includes('real') || type.includes('decimal');

      expect(isFloatCompatible).toBe(true);
      expect(type).not.toContain('bigint');
      expect(type).not.toContain('int8'); // postgres bigint alias
    });

    it('should block drops even if safe: false (when drop: false)', async () => {
      @Entity()
      class AutoSyncNoDropTest {
        @Id({ type: Number }) id?: number;
        @Field({ type: String }) name?: string;
      }

      const tableName = 'AutoSyncNoDropTest';
      await givenTable(
        tableName,
        `${db.serialIdColumn}, ${escapeId('name')} ${db.textType}, ${escapeId('extraColumn')} ${db.textType}`,
      );

      await new Migrator(pool, { entities: [AutoSyncNoDropTest] }).sync({ logging: true, safe: false });

      const ast = await introspector.introspect([tableName]);
      const table = ast.getTable(tableName);
      expect(table).toBeDefined();
      expect(Array.from(table!.columns.keys()).sort()).toEqual(['extraColumn', 'id', 'name']);
    });

    /**
     * A key a foreign key can point at, spelled the same as the column that will reference it. Not
     * {@link DatabaseConfig.serialIdColumn}, which is `BIGINT UNSIGNED` on the MySQL family: an
     * engine refuses a constraint whose two sides differ in signedness.
     *
     * The child table is claimed first so the shared teardown drops it first - a parent cannot go
     * while a constraint still points at it, and a failed drop leaks the table into the next test.
     */
    const givenRelatedTables = async (parent: string, child: string) => {
      const idColumn = `${escapeId('id')} ${db.keyColumnType} PRIMARY KEY`;
      await givenNoTable(child);
      await givenTable(parent, idColumn);
      await pool.run(`CREATE TABLE ${escapeId(child)} (${idColumn}, ${escapeId('companyId')} ${db.keyColumnType})`);
    };

    /**
     * The whole point of the foreign-key diff: the constraint has to reach the database and the engine
     * has to accept the DDL, which no string assertion can prove.
     */
    it.skipIf(!db.dialect.features.foreignKeyAlter)('should add a foreign key the table has not got', async () => {
      @Entity()
      class FkSyncCompany {
        @Id({ type: Number }) id?: number;
      }
      @Entity()
      class FkSyncEmployee {
        @Id({ type: Number }) id?: number;
        @Field({ references: () => FkSyncCompany, onDelete: 'CASCADE' }) companyId?: number;
      }

      await givenRelatedTables('FkSyncCompany', 'FkSyncEmployee');
      const fkTables = ['FkSyncCompany', 'FkSyncEmployee'];
      const before = await introspector.introspect(fkTables);
      expect(before.getTable('FkSyncEmployee')!.outgoingRelations).toHaveLength(0);

      await new Migrator(pool, { entities: [FkSyncCompany, FkSyncEmployee] }).sync({ logging: true });

      const relations = (await introspector.introspect(fkTables)).getTable('FkSyncEmployee')!.outgoingRelations;
      expect(relations).toHaveLength(1);
      expect(relations[0].to.table.name).toBe('FkSyncCompany');
      expect(relations[0].onDelete).toBe('CASCADE');
    });

    /**
     * The case the feature exists for, and the one no unit test can prove: changing `onDelete` on a
     * relation whose constraint is already there. It is a drop and an add, so it needs `safe: false`.
     */
    it.skipIf(!db.dialect.features.foreignKeyAlter)(
      'should alter a foreign key whose referential action changed',
      async () => {
        @Entity()
        class FkAlterCompany {
          @Id({ type: Number }) id?: number;
        }
        @Entity()
        class FkAlterEmployee {
          @Id({ type: Number }) id?: number;
          @Field({ references: () => FkAlterCompany, onDelete: 'SET NULL' }) companyId?: number;
        }

        await givenRelatedTables('FkAlterCompany', 'FkAlterEmployee');
        await pool.run(
          `ALTER TABLE ${escapeId('FkAlterEmployee')} ADD CONSTRAINT ${escapeId('fk_employee_company')} ` +
            `FOREIGN KEY (${escapeId('companyId')}) REFERENCES ${escapeId('FkAlterCompany')} (${escapeId('id')}) ` +
            `ON DELETE CASCADE`,
        );
        const fkTables = ['FkAlterCompany', 'FkAlterEmployee'];
        const before = await introspector.introspect(fkTables);
        expect(before.getTable('FkAlterEmployee')!.outgoingRelations[0].onDelete).toBe('CASCADE');

        await new Migrator(pool, { entities: [FkAlterCompany, FkAlterEmployee] }).sync({ logging: true, safe: false });

        const relations = (await introspector.introspect(fkTables)).getTable('FkAlterEmployee')!.outgoingRelations;
        expect(relations).toHaveLength(1);
        expect(relations[0].onDelete).toBe('SET NULL');
      },
    );

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
        @Field({ references: () => FkStableCompany, onDelete: 'CASCADE' }) companyId?: number;
      }

      await givenNoTable('FkStableEmployee');
      await givenNoTable('FkStableCompany');
      const migrator = new Migrator(pool, { entities: [FkStableCompany, FkStableEmployee] });
      await migrator.sync({ logging: true });

      expect(await migrator.planSync()).toEqual([]);
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
        @Field({ references: () => FkLegacyCompany, onDelete: 'CASCADE' }) companyId?: number;
      }

      await givenNoTable('FkLegacyEmployee');
      await givenTable('FkLegacyCompany', db.legacyUnsignedIdColumn!);
      await pool.run(
        `CREATE TABLE ${escapeId('FkLegacyEmployee')} (${db.legacyUnsignedIdColumn}, ${escapeId('companyId')} ${db.keyColumnType})`,
      );

      const migrator = new Migrator(pool, { entities: [FkLegacyCompany, FkLegacyEmployee] });
      await migrator.sync({ logging: true, safe: false });

      const after = await introspector.introspect(['FkLegacyCompany', 'FkLegacyEmployee']);
      expect(after.getTable('FkLegacyCompany')!.columns.get('id')!.type.unsigned).toBeFalsy();
      // The point of the alter: the constraint can finally be created.
      expect(after.getTable('FkLegacyEmployee')!.outgoingRelations).toHaveLength(1);
      expect(await migrator.planSync({ safe: false })).toEqual([]);
    });

    /**
     * An enum is a column `CHECK`, not a native type, so only the database can say the constraint was
     * emitted and is enforced. A column *added* to a table that already exists used to arrive without
     * it - the alter path renders from a `ColumnSchema`, which carried no values - so the entity
     * promised a union the database accepted anything for.
     */
    it('should constrain an enum column it adds to an existing table', async () => {
      @Entity()
      class SyncEnumAdded {
        @Id({ type: Number }) id?: number;
        @Field({ type: String, columnType: 'varchar', length: 20, enum: ['draft', 'paid'] as const })
        status?: 'draft' | 'paid';
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
        @Field({ type: String, columnType: 'varchar', length: 20, enum: ['on', 'off'] as const }) state?: 'on' | 'off';
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
        status?: 'draft' | 'paid';
      }

      await givenNoTable('SyncEnumWidened');
      await new Migrator(pool, { entities: [Narrow] }).sync({ logging: true });
      removeEntity(Narrow);

      @Entity({ name: 'SyncEnumWidened' })
      class Wide {
        @Id({ type: Number }) id?: number;
        @Field({ type: String, columnType: 'varchar', length: 20, enum: ['draft', 'paid', 'void'] as const })
        status?: 'draft' | 'paid' | 'void';
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
      @Entity({ checks: [{ expression: raw`spent <= balance` }] })
      class SyncChecked {
        @Id({ type: Number }) id?: number;
        @Field({ type: Number }) spent?: number;
        @Field({ type: Number }) balance?: number;
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
          @Field({ type: String, columnType: 'varchar', length: 40, comment: "the author's name" }) author?: string;
        }

        await givenNoTable('SyncCommented');
        await new Migrator(pool, { entities: [SyncCommented] }).sync({ logging: true });

        const created = await introspector.getTableSchema('SyncCommented');
        expect(created?.columns.find((it) => it.name === 'author')?.comment).toBe("the author's name");

        @Entity({ name: 'SyncCommented' })
        class SyncCommentedMore {
          @Id({ type: Number }) id?: number;
          @Field({ type: String, columnType: 'varchar', length: 40, comment: "the author's name" }) author?: string;
          @Field({ type: String, columnType: 'varchar', length: 40, comment: 'where it ran' }) origin?: string;
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
        @Field({ type: Number }) qty?: number;
        @Field({ type: Number }) price?: number;
        @Field({ type: Number, computed: raw`qty * price`, stored: true }) total?: number;
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

    /**
     * `columnsToAdd` carries a {@link ColumnSchema}, which listed its fields by hand and so had no
     * `generatedAs`: the ALTER emitted a plain column nobody ever fills. Only re-reading the value
     * back proves the expression came with it.
     */
    /** A table with a row in it, and the migrator that would give it a stored computed column. */
    const givenTableGainingAComputedColumn = async () => {
      @Entity({ name: 'SyncComputedAdded' })
      class ComputedBefore {
        @Id({ type: Number }) id?: number;
        @Field({ type: Number }) qty?: number;
      }

      await givenNoTable('SyncComputedAdded');
      await new Migrator(pool, { entities: [ComputedBefore] }).sync({ logging: true });
      await pool.insertOne(ComputedBefore, { qty: 4 });

      return new Migrator(pool, { entities: [ComputedAdded] });
    };

    it.skipIf(!db.dialect.features.generatedColumnAdd)(
      'should add a stored computed column to a table that already exists',
      async () => {
        const migrator = await givenTableGainingAComputedColumn();
        await migrator.sync({ logging: true });

        const [row] = await pool.findMany(ComputedAdded, { $select: { double: true } });
        expect(row.double).toBe(8);
        expect(await migrator.planSync()).toEqual([]);
      },
    );

    /**
     * SQLite takes a generated column in a `CREATE TABLE` and rejects the same one in an `ALTER`. The
     * driver's "cannot add a STORED column" names neither the table nor the way out, so the generator
     * refuses first, the way it already does for a primary key it cannot change.
     */
    it.runIf(!db.dialect.features.generatedColumnAdd)(
      'should refuse a stored computed column it cannot add',
      async () => {
        const migrator = await givenTableGainingAComputedColumn();

        await expect(migrator.sync({ logging: true })).rejects.toThrow(
          'Cannot add the computed column "double" to the existing table "SyncComputedAdded"',
        );
        // The cheap way out is in the message: unstored, the same field needs no DDL at all.
        await expect(migrator.sync({ logging: true })).rejects.toThrow('Drop `stored`');
      },
    );

    it('should log skipped migrations when safe mode blocks changes', async () => {
      @Entity()
      class AutoSyncLogTest {
        @Id({ type: Number }) id?: number;
        @Field({ type: String }) name?: string;
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
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Skipped dropping 1 columns'));
      } finally {
        consoleSpy.mockRestore();
      }
    });

    it.skipIf(db.dialect.alterColumnSyntax === 'none')('should alter column type when safe: false', async () => {
      @Entity()
      class AutoSyncUnsafeAlterTest {
        @Id({ type: Number }) id?: number;
        @Field({ type: Number }) cost?: number; // Defaults to bigint
      }

      const tableName = 'AutoSyncUnsafeAlterTest';
      await givenTable(tableName, `${db.serialIdColumn}, ${escapeId('cost')} ${db.doubleType}`);

      await new Migrator(pool, { entities: [AutoSyncUnsafeAlterTest] }).sync({ logging: true, safe: false });

      const ast = await introspector.introspect([tableName]);
      const table = ast.getTable(tableName);
      expect(table).toBeDefined();

      const costCol = table!.columns.get('cost');
      expect(costCol).toBeDefined();

      const type = costCol!.type.category.toLowerCase();
      expect(type).toContain('int');
      expect(type).not.toContain('double');
    });

    it.runIf(db.dialect.alterColumnSyntax === 'none')(
      'should throw error when altering column type (system limitation)',
      async () => {
        @Entity()
        class AutoSyncUnsafeAlterErrorTest {
          @Id({ type: Number }) id?: number;
          @Field({ type: Number }) cost?: number;
        }

        const tableName = 'AutoSyncUnsafeAlterErrorTest';
        await givenTable(tableName, `${db.serialIdColumn}, ${escapeId('cost')} ${db.doubleType}`);

        const migrator = new Migrator(pool, { entities: [AutoSyncUnsafeAlterErrorTest] });

        await expect(migrator.sync({ logging: true, safe: false })).rejects.toThrow('Cannot alter column');
      },
    );
  });
}
