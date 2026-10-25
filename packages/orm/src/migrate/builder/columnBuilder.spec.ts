import { describe, expect, it } from 'vitest';
import { MySqlDialect } from '../../mysql/mysqlDialect.js';
import { canonicalToSql } from '../../schema/canonicalType.js';
import { SqlExpression } from '../../schema/sqlExpression.js';
import { sql } from '../../util/sql.js';
import { tableColumns } from './columnBuilder.js';

const columns = tableColumns((column) => column);

describe('TableColumn', () => {
  describe('basic construction', () => {
    it('should create a column with name and type', () => {
      const col = columns.string('email');
      const def = col.build();

      expect(def.name).toBe('email');
      expect(def.type.category).toBe('string');
      expect(def.nullable).toBe(false); // Default is non-null (safer)
    });

    it("should set a decimal type's precision and scale", () => {
      expect(columns.decimal('price').precision(10).scale(2).build().type).toMatchObject({ precision: 10, scale: 2 });
    });

    it('should make the type unsigned as its options say', () => {
      expect(columns.integer('n').unsigned().build().type).toEqual({
        category: 'integer',
        unsigned: true,
      });
    });

    it('should reference a table', () => {
      const def = columns.integer('userId').references('users', 'id').onDelete('CASCADE').build();
      expect(def.foreignKey).toBeDefined();
      expect(def.foreignKey?.references.table).toBe('users');
      expect(def.foreignKey?.references.columns).toEqual(['id']);
      expect(def.foreignKey?.onDelete).toBe('CASCADE');
    });

    /** No action is stated, so the generator renders its own default, as for any other foreign key. */
    it('should reference the id and state no action for an inline reference', () => {
      const def = columns.integer('userId').references('users').build();
      expect(def.foreignKey).toEqual({ references: { table: 'users', columns: ['id'] } });
    });
  });

  describe('fluent API', () => {
    it('should set nullable', () => {
      const col = columns.string('email').nullable();
      expect(col.build().nullable).toBe(true);
    });

    it('should set default value', () => {
      const col = columns.boolean('active').default(true);
      expect(col.build().defaultValue).toBe(true);
    });

    it('should set primary key, NOT NULL', () => {
      const def = columns.integer('id').id().build();
      expect(def.isPrimaryKey).toBe(true);
      expect(def.nullable).toBe(false);
    });

    it('should refuse a nullable primary key', () => {
      expect(() => columns.integer('id').nullable().id().build()).toThrow(
        "'id' cannot use 'nullable': it is ignored on a primary key",
      );
    });

    it('should set unsigned, keeping the type', () => {
      const col = columns.bigint('n').unsigned();
      expect(col.build().type).toEqual({ category: 'integer', size: 'big', unsigned: true });
    });

    it('should set autoIncrement', () => {
      const col = columns.integer('id').autoIncrement();
      expect(col.build().isAutoIncrement).toBe(true);
    });

    it('should set unique', () => {
      const col = columns.string('email').unique();
      expect(col.build().isUnique).toBe(true);
    });

    it('should set comment', () => {
      const col = columns.string('email').comment('User email');
      expect(col.build().comment).toBe('User email');
    });

    it('should set index', () => {
      const col = columns.string('email').index('email_idx');
      expect(col.build().index).toBe('email_idx');
    });

    it('should set index with auto name', () => {
      const col = columns.string('email').index();
      expect(col.build().index).toBe(true);
    });
  });

  describe('foreign key', () => {
    it('should set references', () => {
      const col = columns.integer('userId').references('users', 'id');
      const def = col.build();

      expect(def.foreignKey).toBeDefined();
      expect(def.foreignKey?.references.table).toBe('users');
      expect(def.foreignKey?.references.columns).toEqual(['id']);
    });

    it('should set onDelete action', () => {
      const col = columns.integer('userId').references('users', 'id').onDelete('CASCADE');

      expect(col.build().foreignKey?.onDelete).toBe('CASCADE');
    });

    it('should set onUpdate action', () => {
      const col = columns.integer('userId').references('users').onUpdate('SET NULL');

      expect(col.build().foreignKey?.onUpdate).toBe('SET NULL');
    });
  });

  describe('chaining', () => {
    it('should support method chaining', () => {
      const col = columns.string('email').unique().comment('Primary email').index();

      const def = col.build();

      expect(def.nullable).toBe(false);
      expect(def.isUnique).toBe(true);
      expect(def.comment).toBe('Primary email');
      expect(def.index).toBe(true);
    });
  });

  describe('as an entity column reads', () => {
    it('should make a text column unbounded on every engine, as `f.text()` is', () => {
      expect(canonicalToSql(columns.text('body').build().type, new MySqlDialect())).toBe('TEXT');
    });

    it('should leave a key unincremented unless it says so', () => {
      expect(columns.bigint('id').id().build()).toMatchObject({ isPrimaryKey: true, isAutoIncrement: false });
      expect(columns.id().build()).toMatchObject({ isPrimaryKey: true, isAutoIncrement: true });
    });

    it('should hold a SQL default as the expression an entity default is', () => {
      expect(
        columns
          .integer('n')
          .default(sql`1 + 1`)
          .build().defaultValue,
      ).toEqual(SqlExpression.parenthesized('1 + 1'));
    });

    it('should generate a column from its SQL text', () => {
      expect(columns.integer('total').as('price * qty').build().generatedAs).toBe('price * qty');
    });

    it('should refuse SQL binding a value, which DDL has nowhere to put', () => {
      expect(() =>
        columns
          .integer('n')
          .default(sql`${1} + 1`)
          .build(),
      ).toThrow('binds nothing');
    });

    it('should refuse an option its column cannot use, as an entity column does', () => {
      expect(() => columns.string('code').autoIncrement().build()).toThrow(
        "'code' cannot use 'autoIncrement': it applies to a numeric column, not to a string one",
      );
      expect(() => columns.integer('n').as('a + b').default(0).build()).toThrow(
        "'n' cannot use 'defaultValue': it is ignored on a column the database writes",
      );
    });
  });

  it('should type a vector column without dimensions as an unsized one', () => {
    expect(columns.vector('embedding').build().type.category).toBe('vector');
    expect(columns.vector('embedding', 3).build().type.length).toBe(3);
  });
});
