/**
 * Foreign keys on a table that already exists.
 *
 * `SchemaDiff` has declared `foreignKeysToAdd`/`foreignKeysToDrop` since the type was written, and
 * nothing ever filled or read them: a sync added columns, indexes and even a primary key, and left
 * every foreign key exactly as the database had it. These lock the wiring in from both ends - the
 * diff that finds the difference, and the DDL that applies it.
 */
import { describe, expect, it } from 'vitest';
import { Entity, Field, Id, ManyToOne } from '../entity/index.js';
import { MySqlDialect } from '../mysql/mysqlDialect.js';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import { sqlToCanonical } from '../schema/canonicalType.js';
import type { ColumnNode, ForeignKeyAction, RelationshipNode, TableNode } from '../schema/types.js';
import { SqliteDialect } from '../sqlite/sqliteDialect.js';
import type { ForeignKeySchema, SchemaDiff } from '../type/migration.js';
import { SqlSchemaGenerator } from './schemaGenerator.js';

@Entity()
class FkCompany {
  @Id({ type: Number }) id?: number;
  @Field({ type: String, columnType: 'varchar', length: 255 }) name?: string;
}

@Entity()
class FkEmployee {
  @Id({ type: Number }) id?: number;
  @Field({ type: String, columnType: 'varchar', length: 255 }) name?: string;
  @Field({ references: () => FkCompany, onDelete: 'CASCADE' }) companyId?: number;
  @ManyToOne({ entity: () => FkCompany }) company?: FkCompany;
}

/** The one referential action the introspector used to read back as `undefined`. */
@Entity()
class FkSetDefault {
  @Id({ type: Number }) id?: number;
  @Field({ references: () => FkCompany, onDelete: 'SET DEFAULT' }) companyId?: number;
  @ManyToOne({ entity: () => FkCompany }) company?: FkCompany;
}

/** A key that is not the default big integer, which is what catches a serial spelled independently. */
@Entity()
class FkNarrowCompany {
  @Id({ type: Number, columnType: 'int' }) id?: number;
}

@Entity()
class FkNarrowEmployee {
  @Id({ type: Number }) id?: number;
  @Field({ references: () => FkNarrowCompany }) companyId?: number;
}

/** No relation at all, so a foreign key found on its table is one the entity does not declare. */
@Entity()
class FkStandalone {
  @Id({ type: Number }) id?: number;
  @Field({ type: Number }) companyId?: number;
}

const ENTITIES = [FkCompany, FkEmployee, FkSetDefault, FkStandalone];

describe('SqlSchemaGenerator foreign keys', () => {
  const generator = new SqlSchemaGenerator(new PostgresDialect());

  describe('diffSchema', () => {
    it('should add a foreign key the entity declares and the table has not got', () => {
      const { employee } = tables();

      const diff = generator.diffSchema(FkEmployee, employee, generator.buildAST(ENTITIES));

      expect(diff?.type).toBe('alter');
      expect(diff?.foreignKeysToAdd).toEqual([
        {
          name: 'FkEmployee__companyId_fk',
          columns: ['companyId'],
          references: { table: 'FkCompany', columns: ['id'] },
          onDelete: 'CASCADE',
          onUpdate: 'NO ACTION',
        },
      ]);
      expect(diff?.foreignKeysToDrop).toBeUndefined();
      expect(diff?.foreignKeysToAlter).toBeUndefined();
    });

    it('should report nothing where the table already has the foreign key the entity declares', () => {
      const { employee, company } = tables();
      addRelation(employee, company, 'employee_company_fk', 'CASCADE');
      addCompanyIndex(employee, 'employee_company_idx');

      const diff = generator.diffSchema(FkEmployee, employee, generator.buildAST(ENTITIES));

      expect(diff).toBeUndefined();
    });

    /** A table created before foreign keys were indexed gains the index on its next sync, and nothing else. */
    it('should add the index a foreign key needs where the table has the constraint alone', () => {
      const { employee, company } = tables();
      addRelation(employee, company, 'employee_company_fk', 'CASCADE');

      const diff = generator.diffSchema(FkEmployee, employee, generator.buildAST(ENTITIES));

      expect(diff?.indexesToAdd?.map((index) => index.name)).toEqual(['FkEmployee__companyId_idx']);
      expect(diff?.foreignKeysToAdd).toBeUndefined();
      expect(diff?.foreignKeysToAlter).toBeUndefined();
    });

    /**
     * The case the whole feature exists for: changing `onDelete` on a shipped relation used to
     * produce no statement at all, so the database kept enforcing the old rule forever.
     */
    it('should alter a foreign key whose referential action changed', () => {
      const { employee, company } = tables();
      addRelation(employee, company, 'employee_company_fk', 'NO ACTION');

      const diff = generator.diffSchema(FkEmployee, employee, generator.buildAST(ENTITIES));

      expect(diff?.foreignKeysToAlter).toHaveLength(1);
      // Dropped under the name the database gave it, added under the one the entity derives.
      expect(diff?.foreignKeysToAlter?.[0].from.name).toBe('employee_company_fk');
      expect(diff?.foreignKeysToAlter?.[0].from.onDelete).toBe('NO ACTION');
      expect(diff?.foreignKeysToAlter?.[0].to.name).toBe('FkEmployee__companyId_fk');
      expect(diff?.foreignKeysToAlter?.[0].to.onDelete).toBe('CASCADE');
      expect(diff?.foreignKeysToAdd).toBeUndefined();
      expect(diff?.foreignKeysToDrop).toBeUndefined();
    });

    it('should drop a foreign key the entity does not declare', () => {
      const { company } = tables();
      const standalone = tableNode('FkStandalone', [
        { name: 'id', sql: 'INTEGER', isPrimaryKey: true, isAutoIncrement: true },
        // The type a `@Field({ references })` column derives from the key it points at.
        { name: 'companyId', sql: 'BIGINT' },
      ]);
      addRelation(standalone, company, 'standalone_company_fk', 'CASCADE');

      const diff = generator.diffSchema(FkStandalone, standalone, generator.buildAST(ENTITIES));

      expect(diff?.foreignKeysToDrop).toEqual(['standalone_company_fk']);
      expect(diff?.foreignKeysToAdd).toBeUndefined();
    });

    /**
     * The AST has to span every entity even though the diff is about one table: a relation whose
     * target is not in it resolves to nothing, and the foreign key reads as absent from both sides -
     * which is a match, and no statement.
     */
    it('should resolve a relation whose target is another entity', () => {
      const { employee } = tables();

      const spanning = generator.diffSchema(FkEmployee, employee, generator.buildAST(ENTITIES));
      const alone = generator.diffSchema(FkEmployee, employee, generator.buildAST([FkEmployee]));

      expect(spanning?.foreignKeysToAdd).toHaveLength(1);
      expect(alone?.foreignKeysToAdd).toBeUndefined();
    });

    /**
     * SQLite resolves foreign keys lazily and keeps them inline at CREATE time; its only way to
     * change one afterwards is the twelve-step table rebuild, which a sync does not do. Reporting a
     * difference nothing can apply would throw on every sync of an entity that has a relation.
     */
    it('should report no foreign key difference where the engine cannot alter one', () => {
      const { employee } = tables();
      const sqlite = new SqlSchemaGenerator(new SqliteDialect());

      expect(sqlite.features.foreignKeyAlter).toBe(false);
      expect(sqlite.diffSchema(FkEmployee, employee, sqlite.buildAST(ENTITIES))?.foreignKeysToAdd).toBeUndefined();
    });

    /**
     * `SET DEFAULT` is a legal referential action the entity side has always accepted, and the
     * introspector read it back as `undefined` - so the constraint looked like `NO ACTION` and every
     * sync forever offered to alter one that was already right.
     */
    it('should report nothing for a SET DEFAULT foreign key that already matches', () => {
      const { setDefault, company } = tables();
      addRelation(setDefault, company, 'set_default_company_fk', 'SET DEFAULT');
      addCompanyIndex(setDefault, 'set_default_company_idx');

      const diff = generator.diffSchema(FkSetDefault, setDefault, generator.buildAST(ENTITIES));

      expect(diff).toBeUndefined();
    });
  });

  /**
   * A foreign key column takes its type from the key it points at, resolved through the canonical
   * type - so the key has to be spelled from that same canonical type. Spelled independently, an
   * `@Id({ columnType: 'int' })` emitted `BIGINT` while the column referencing it emitted `INT`, and
   * every engine refuses that constraint.
   */
  describe('an auto-increment key and the column referencing it', () => {
    it.each([
      ['postgres', new PostgresDialect(), 'INTEGER GENERATED BY DEFAULT AS IDENTITY', 'INTEGER'],
      ['mysql', new MySqlDialect(), 'INT AUTO_INCREMENT', 'INT'],
      ['sqlite', new SqliteDialect(), 'INTEGER PRIMARY KEY AUTOINCREMENT', 'INTEGER'],
    ])('should agree on %s', (_name, dialect, keyType, referencingType) => {
      const sql = new SqlSchemaGenerator(dialect).generateCreateSchema([FkNarrowCompany, FkNarrowEmployee]).join('\n');

      expect(sql).toContain(keyType);
      expect(sql).toMatch(new RegExp(`companyId.{0,3} ${referencingType}\\b`));
    });
  });

  describe('generateAlterTable', () => {
    it('should add a foreign key', () => {
      const statements = generator.generateAlterTable({
        type: 'alter',
        tableName: 'FkEmployee',
        foreignKeysToAdd: [companyFk('FkEmployee__companyId_fk', 'CASCADE')],
      });

      expect(statements).toEqual([
        'ALTER TABLE "FkEmployee" ADD CONSTRAINT "FkEmployee__companyId_fk" ' +
          'FOREIGN KEY ("companyId") REFERENCES "FkCompany" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;',
      ]);
    });

    it('should drop a foreign key', () => {
      const statements = generator.generateAlterTable({
        type: 'alter',
        tableName: 'FkEmployee',
        foreignKeysToDrop: ['employee_company_fk'],
      });

      expect(statements).toEqual(['ALTER TABLE "FkEmployee" DROP CONSTRAINT "employee_company_fk";']);
    });

    /** No engine alters a constraint's actions in place, so an alter is the pair, in that order. */
    it('should alter a foreign key as a drop followed by an add', () => {
      const statements = generator.generateAlterTable({ type: 'alter', tableName: 'FkEmployee', ...alterFk() });

      expect(statements).toEqual([
        'ALTER TABLE "FkEmployee" DROP CONSTRAINT "employee_company_fk";',
        'ALTER TABLE "FkEmployee" ADD CONSTRAINT "FkEmployee__companyId_fk" ' +
          'FOREIGN KEY ("companyId") REFERENCES "FkCompany" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;',
      ]);
    });

    /**
     * A constraint holds its columns down: dropping one the entity removed fails while a foreign key
     * still names it, and adding one fails before the column it names exists.
     */
    it('should drop foreign keys before columns and add them after', () => {
      const statements = generator.generateAlterTable({
        type: 'alter',
        tableName: 'FkEmployee',
        columnsToAdd: [
          {
            name: 'companyId',
            type: 'integer',
            nullable: true,
            isPrimaryKey: false,
            isAutoIncrement: false,
            isUnique: false,
          },
        ],
        columnsToDrop: ['legacyCompanyId'],
        foreignKeysToDrop: ['employee_legacy_fk'],
        foreignKeysToAdd: [companyFk('FkEmployee__companyId_fk', 'CASCADE')],
      });

      const dropFk = statements.findIndex((it) => it.includes('DROP CONSTRAINT "employee_legacy_fk"'));
      const dropColumn = statements.findIndex((it) => it.includes('DROP COLUMN "legacyCompanyId"'));
      const addColumn = statements.findIndex((it) => it.includes('ADD COLUMN "companyId"'));
      const addFk = statements.findIndex((it) => it.includes('ADD CONSTRAINT "FkEmployee__companyId_fk"'));

      expect(dropFk).toBeLessThan(dropColumn);
      expect(addColumn).toBeLessThan(addFk);
    });

    /**
     * A foreign key nothing named is created under a derived name, so a drop has to derive the same
     * one or it names a constraint that is not there. Both ends go through `constraintNameOf`.
     */
    it('should drop an unnamed foreign key under the name the add created it with', () => {
      const unnamed: ForeignKeySchema = {
        columns: ['companyId'],
        references: { table: 'FkCompany', columns: ['id'] },
      };

      const [added] = generator.generateAlterTable({
        type: 'alter',
        tableName: 'FkEmployee',
        foreignKeysToAdd: [unnamed],
      });
      const [dropped] = generator.generateAlterTableDown({
        type: 'alter',
        tableName: 'FkEmployee',
        foreignKeysToAdd: [unnamed],
      });

      expect(added).toContain('ADD CONSTRAINT "FkEmployee__companyId_fk"');
      expect(dropped).toBe('ALTER TABLE "FkEmployee" DROP CONSTRAINT "FkEmployee__companyId_fk";');
    });
  });

  describe('generateAlterTableDown', () => {
    it('should reverse an added foreign key by dropping it', () => {
      const statements = generator.generateAlterTableDown({
        type: 'alter',
        tableName: 'FkEmployee',
        foreignKeysToAdd: [companyFk('FkEmployee__companyId_fk', 'CASCADE')],
      });

      expect(statements).toEqual(['ALTER TABLE "FkEmployee" DROP CONSTRAINT "FkEmployee__companyId_fk";']);
    });

    it('should reverse an altered foreign key by restoring the one the database had', () => {
      const statements = generator.generateAlterTableDown({
        type: 'alter',
        tableName: 'FkEmployee',
        ...alterFk(),
      });

      expect(statements).toEqual([
        'ALTER TABLE "FkEmployee" DROP CONSTRAINT "FkEmployee__companyId_fk";',
        'ALTER TABLE "FkEmployee" ADD CONSTRAINT "employee_company_fk" ' +
          'FOREIGN KEY ("companyId") REFERENCES "FkCompany" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;',
      ]);
    });
  });
});

function companyFk(name: string, onDelete: ForeignKeyAction): ForeignKeySchema {
  return {
    name,
    columns: ['companyId'],
    references: { table: 'FkCompany', columns: ['id'] },
    onDelete,
    onUpdate: 'NO ACTION',
  };
}

/** The `from`/`to` pair every alter assertion above shares. */
function alterFk(): Pick<SchemaDiff, 'foreignKeysToAlter'> {
  return {
    foreignKeysToAlter: [
      { from: companyFk('employee_company_fk', 'NO ACTION'), to: companyFk('FkEmployee__companyId_fk', 'CASCADE') },
    ],
  };
}

function tables() {
  const company = tableNode('FkCompany', [
    { name: 'id', sql: 'INTEGER', isPrimaryKey: true, isAutoIncrement: true },
    { name: 'name', sql: 'VARCHAR', length: 255 },
  ]);
  return {
    company,
    employee: tableNode('FkEmployee', [
      { name: 'id', sql: 'INTEGER', isPrimaryKey: true, isAutoIncrement: true },
      { name: 'name', sql: 'VARCHAR', length: 255 },
      // The type a `@Field({ references })` column derives from the key it points at.
      { name: 'companyId', sql: 'BIGINT' },
    ]),
    setDefault: tableNode('FkSetDefault', [
      { name: 'id', sql: 'INTEGER', isPrimaryKey: true, isAutoIncrement: true },
      // The type a `@Field({ references })` column derives from the key it points at.
      { name: 'companyId', sql: 'BIGINT' },
    ]),
  };
}

/** As `baseSqlIntrospector.buildRelationships` fills it: on the table node, both ends resolved. */
function addRelation(from: TableNode, to: TableNode, name: string, onDelete: ForeignKeyAction): void {
  const relation: RelationshipNode = {
    name,
    type: 'ManyToOne',
    from: { table: from, columns: [from.columns.get('companyId')!] },
    to: { table: to, columns: [to.columns.get('id')!] },
    onDelete,
    onUpdate: 'NO ACTION',
  };
  from.outgoingRelations.push(relation);
  to.incomingRelations.push(relation);
}

/** The index the migrator gives a foreign key column, under a name of the database's own. */
function addCompanyIndex(table: TableNode, name: string): void {
  table.indexes.push({ name, table, entries: [{ column: 'companyId' }], unique: false });
}

function tableNode(
  name: string,
  cols: { name: string; sql: string; length?: number; isPrimaryKey?: boolean; isAutoIncrement?: boolean }[],
): TableNode {
  const columns = new Map<string, ColumnNode>();
  const table: TableNode = {
    name,
    columns,
    primaryKey: [],
    indexes: [],
    incomingRelations: [],
    outgoingRelations: [],
  };

  for (const col of cols) {
    columns.set(col.name, {
      name: col.name,
      type: { ...sqlToCanonical(col.sql), ...(col.length ? { length: col.length } : {}) },
      nullable: !col.isPrimaryKey,
      isPrimaryKey: !!col.isPrimaryKey,
      isAutoIncrement: !!col.isAutoIncrement,
      isUnique: false,
      table,
      referencedBy: [],
    });
  }

  table.primaryKey.push(...[...columns.values()].filter((column) => column.isPrimaryKey));

  return table;
}
