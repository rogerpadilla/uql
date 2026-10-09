import { describe, expect, it } from 'vitest';
import { ColumnDefinitionBuilder } from './columnBuilder.js';

describe('ColumnDefinitionBuilder', () => {
  describe('basic construction', () => {
    it('should create a column with name and type', () => {
      const col = new ColumnDefinitionBuilder('email', { category: 'string', length: 255 });
      const def = col.build();

      expect(def.name).toBe('email');
      expect(def.type.category).toBe('string');
      expect(def.nullable).toBe(false); // Default is non-null (safer)
    });

    it('should make the type unsigned as its options say', () => {
      expect(new ColumnDefinitionBuilder('n', { category: 'integer' }, { unsigned: true }).build().type).toEqual({
        category: 'integer',
        unsigned: true,
      });
    });

    it('should support references option in constructor', () => {
      const col = new ColumnDefinitionBuilder(
        'userId',
        { category: 'integer' },
        {
          references: { table: 'users', column: 'id', onDelete: 'CASCADE' },
        },
      );
      const def = col.build();
      expect(def.foreignKey).toBeDefined();
      expect(def.foreignKey?.references.table).toBe('users');
      expect(def.foreignKey?.references.columns).toEqual(['id']);
      expect(def.foreignKey?.onDelete).toBe('CASCADE');
    });

    /** No action is stated, so the generator renders its own default, as for any other foreign key. */
    it('should reference the id and state no action for an inline reference', () => {
      const def = new ColumnDefinitionBuilder(
        'userId',
        { category: 'integer' },
        { references: { table: 'users' } },
      ).build();
      expect(def.foreignKey).toEqual({ references: { table: 'users', columns: ['id'] } });
    });
  });

  describe('fluent API', () => {
    it('should set nullable', () => {
      const col = new ColumnDefinitionBuilder('email', { category: 'string' }).nullable(false);
      expect(col.build().nullable).toBe(false);
    });

    it('should set notNullable', () => {
      const col = new ColumnDefinitionBuilder('email', { category: 'string' }).notNullable();
      expect(col.build().nullable).toBe(false);
    });

    it('should set default value', () => {
      const col = new ColumnDefinitionBuilder('active', { category: 'boolean' }).defaultValue(true);
      expect(col.build().defaultValue).toBe(true);
    });

    it('should set primary key', () => {
      const col = new ColumnDefinitionBuilder('id', { category: 'integer' }).primaryKey();
      const def = col.build();
      expect(def.isPrimaryKey).toBe(true);
      expect(def.nullable).toBe(false); // PK implies NOT NULL
    });

    it('should set unsigned, keeping the type', () => {
      const col = new ColumnDefinitionBuilder('n', { category: 'integer', size: 'big' }).unsigned();
      expect(col.build().type).toEqual({ category: 'integer', size: 'big', unsigned: true });
    });

    it('should set autoIncrement', () => {
      const col = new ColumnDefinitionBuilder('id', { category: 'integer' }).autoIncrement();
      expect(col.build().isAutoIncrement).toBe(true);
    });

    it('should set unique', () => {
      const col = new ColumnDefinitionBuilder('email', { category: 'string' }).unique();
      expect(col.build().isUnique).toBe(true);
    });

    it('should set comment', () => {
      const col = new ColumnDefinitionBuilder('email', { category: 'string' }).comment('User email');
      expect(col.build().comment).toBe('User email');
    });

    it('should set index', () => {
      const col = new ColumnDefinitionBuilder('email', { category: 'string' }).index('email_idx');
      expect(col.build().index).toBe('email_idx');
    });

    it('should set index with auto name', () => {
      const col = new ColumnDefinitionBuilder('email', { category: 'string' }).index();
      expect(col.build().index).toBe(true);
    });
  });

  describe('foreign key', () => {
    it('should set references', () => {
      const col = new ColumnDefinitionBuilder('userId', { category: 'integer' }).references('users', 'id');
      const def = col.build();

      expect(def.foreignKey).toBeDefined();
      expect(def.foreignKey?.references.table).toBe('users');
      expect(def.foreignKey?.references.columns).toEqual(['id']);
    });

    it('should set onDelete action', () => {
      const col = new ColumnDefinitionBuilder('userId', { category: 'integer' })
        .references('users', 'id')
        .onDelete('CASCADE');

      expect(col.build().foreignKey?.onDelete).toBe('CASCADE');
    });

    it('should set onUpdate action', () => {
      const col = new ColumnDefinitionBuilder('userId', { category: 'integer' })
        .references('users')
        .onUpdate('SET NULL');

      expect(col.build().foreignKey?.onUpdate).toBe('SET NULL');
    });

    it('should do nothing if onDelete/onUpdate called without references', () => {
      const col = new ColumnDefinitionBuilder('userId', { category: 'integer' })
        .onDelete('CASCADE')
        .onUpdate('CASCADE');
      expect(col.build().foreignKey).toBeUndefined();
    });
  });

  describe('chaining', () => {
    it('should support method chaining', () => {
      const col = new ColumnDefinitionBuilder('email', { category: 'string', length: 255 })
        .notNullable()
        .unique()
        .comment('Primary email')
        .index();

      const def = col.build();

      expect(def.nullable).toBe(false);
      expect(def.isUnique).toBe(true);
      expect(def.comment).toBe('Primary email');
      expect(def.index).toBe(true);
    });
  });
});
