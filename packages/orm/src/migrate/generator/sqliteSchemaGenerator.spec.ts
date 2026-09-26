import { describe, expect, it } from 'vitest';
import { Entity, Field, Id } from '../../entity/index.js';
import { SqliteDialect } from '../../sqlite/sqliteDialect.js';
import { assertDefined, mockSqlTableNode } from '../../test/index.js';
import { reverseDiff } from '../schemaChange.js';
import { SqlSchemaGenerator } from '../schemaGenerator.js';

@Entity()
class RebuiltUser {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) name?: string | null;
  @Field({ type: Number, nullable: false, defaultValue: 0 }) age?: number;
}

/** `RebuiltUser` as the database holds it: `age` still `years`, text and nullable, with what only SQLite can say of it. */
function rebuiltUserTable() {
  const table = mockSqlTableNode('RebuiltUser', [
    { name: 'id', sql: 'INTEGER', isPrimaryKey: true, isAutoIncrement: true },
    { name: 'name', sql: 'TEXT' },
    { name: 'age', sql: 'TEXT' },
  ]);
  table.indexes.push({ name: 'hand_made_name', table, entries: [{ column: 'name' }], unique: false });
  table.definition = [
    {
      kind: 'table',
      name: 'RebuiltUser',
      sql: "CREATE TABLE `RebuiltUser` (`id` INTEGER PRIMARY KEY AUTOINCREMENT, `name` TEXT, `years` TEXT CHECK (`years` <> ''))",
    },
    { kind: 'index', name: 'hand_made_name', sql: 'CREATE INDEX hand_made_name ON RebuiltUser (name)' },
    { kind: 'index', name: 'by_lower_name', sql: 'CREATE INDEX by_lower_name ON RebuiltUser (lower(name))' },
    {
      kind: 'trigger',
      name: '_uql_RebuiltUser__stamp_1',
      sql: 'CREATE TRIGGER `_uql_RebuiltUser__stamp_1` AFTER UPDATE ON `RebuiltUser` BEGIN SELECT 1; END',
    },
  ];
  return table;
}

/** The statements every rebuild of `RebuiltUser` opens with, failing where a foreign key would take rows with it. */
const GUARD = [
  'CREATE TABLE IF NOT EXISTS `_uql_rebuild_guard` (`referencing` INTEGER CONSTRAINT ' +
    '`turn foreign keys off to rebuild RebuiltUser: the rows referencing it would be lost` CHECK (`referencing` = 0));',
  'INSERT INTO `_uql_rebuild_guard` SELECT count(*) FROM pragma_foreign_keys AS k, sqlite_master AS m, ' +
    "pragma_foreign_key_list(m.name) AS f WHERE k.foreign_keys AND m.type = 'table' AND f.`table` = 'RebuiltUser' COLLATE NOCASE;",
  'DROP TABLE `_uql_rebuild_guard`;',
];

describe('SqliteSchemaGenerator Specifics', () => {
  const generator = new SqlSchemaGenerator(new SqliteDialect());

  it('should map column types correctly', () => {
    // Affinity, so a length is not a different column type here as it is everywhere else.
    expect(generator.getSqlType({ type: String })).toBe('TEXT');
    expect(generator.getSqlType({ type: String, length: 100 })).toBe('TEXT');
    expect(generator.getSqlType({ columnType: 'varchar' })).toBe('TEXT');
    expect(generator.getSqlType({ columnType: 'varchar', length: 100 })).toBe('TEXT');
    expect(generator.getSqlType({ columnType: 'int' })).toBe('INTEGER');
    expect(generator.getSqlType({ type: Boolean })).toBe('INTEGER');
  });

  it('should refuse a hand-written column alteration, which only a generated rebuild makes', () => {
    expect(() =>
      generator.generateAlterColumnSql('users', 'age', {
        name: 'age',
        type: { category: 'integer' },
        nullable: true,
        isPrimaryKey: false,
        isAutoIncrement: false,
        isUnique: false,
      }),
    ).toThrow('sqlite: Altering the column "age" of "users" rebuilds the table');
  });

  /**
   * The copy carries the rename and fills the nulls the column now refuses with its default. An index uql
   * did not make comes back, as SQLite keeps it where uql cannot read it; uql's own trigger is left to the
   * trigger reconcile.
   */
  it('should rebuild a table to retype a column, carrying its rename and filling its nulls', () => {
    const diff = generator.diffSchema(RebuiltUser, rebuiltUserTable(), undefined, [{ from: 'years', to: 'age' }]);
    assertDefined(diff);

    expect(generator.generateAlterTable(diff)).toEqual([
      ...GUARD,
      'CREATE TABLE `_uql_new_RebuiltUser` (\n  `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,\n  `name` TEXT,\n  `age` INTEGER NOT NULL DEFAULT 0\n);',
      'INSERT INTO `_uql_new_RebuiltUser` (`id`, `name`, `age`) SELECT `id`, `name`, coalesce(`years`, 0) FROM `RebuiltUser`;',
      'DROP TABLE `RebuiltUser`;',
      'ALTER TABLE `_uql_new_RebuiltUser` RENAME TO `RebuiltUser`;',
      'CREATE INDEX `hand_made_name` ON `RebuiltUser` (`name`);',
      'CREATE INDEX by_lower_name ON RebuiltUser (lower(name));',
    ]);
  });

  /** The rollback is the table as SQLite kept it, `CHECK` included, which introspection never reads. */
  it('should roll a rebuild back to the table exactly as it was', () => {
    const diff = generator.diffSchema(RebuiltUser, rebuiltUserTable(), undefined, [{ from: 'years', to: 'age' }]);
    assertDefined(diff);

    expect(generator.generateAlterTable(reverseDiff(diff))).toEqual([
      ...GUARD,
      "CREATE TABLE `_uql_new_RebuiltUser` (`id` INTEGER PRIMARY KEY AUTOINCREMENT, `name` TEXT, `years` TEXT CHECK (`years` <> ''));",
      'INSERT INTO `_uql_new_RebuiltUser` (`id`, `name`, `years`) SELECT `id`, `name`, `age` FROM `RebuiltUser`;',
      'DROP TABLE `RebuiltUser`;',
      'ALTER TABLE `_uql_new_RebuiltUser` RENAME TO `RebuiltUser`;',
      'CREATE INDEX hand_made_name ON RebuiltUser (name);',
      'CREATE INDEX by_lower_name ON RebuiltUser (lower(name));',
    ]);
  });

  it('should add a plain column in place, with no rebuild', () => {
    const table = mockSqlTableNode('RebuiltUser', [
      { name: 'id', sql: 'INTEGER', isPrimaryKey: true, isAutoIncrement: true },
      { name: 'name', sql: 'TEXT' },
    ]);

    const diff = generator.diffSchema(RebuiltUser, table);
    assertDefined(diff);

    expect(diff.rebuild).toBeUndefined();
    expect(generator.generateAlterTable(diff)).toEqual([
      'ALTER TABLE `RebuiltUser` ADD COLUMN `age` INTEGER NOT NULL DEFAULT 0;',
    ]);
  });

  it('should return empty string for column comment', () => {
    expect(generator.generateColumnComment('comment')).toBe('');
  });
});
