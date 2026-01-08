import { describe, expect, it } from 'vitest';
import { ColumnBuilder } from './columnBuilder.js';

describe('ColumnBuilder', () => {
  describe('basic construction', () => {
    it('should create a column with name and type', () => {
      const col = new ColumnBuilder('email', { category: 'string', length: 255 });
      const def = col.build();

      expect(def.name).toBe('email');
      expect(def.type.category).toBe('string');
      expect(def.nullable).toBe(false); // Default is non-null (safer)
    });

    it('should support references option in constructor', () => {
      const col = new ColumnBuilder(
        'userId',
        { category: 'integer' },
        {
          references: { table: 'users', column: 'id', onDelete: 'CASCADE' },
        },
      );
      const def = col.build();
      expect(def.foreignKey).toBeDefined();
      expect(def.foreignKey?.table).toBe('users');
      expect(def.foreignKey?.columns).toEqual(['id']);
      expect(def.foreignKey?.onDelete).toBe('CASCADE');
    });

    it('should use default values for inline references', () => {
      const col = new ColumnBuilder(
        'userId',
        { category: 'integer' },
        {
          references: { table: 'users' },
        },
      );
      const def = col.build();
      expect(def.foreignKey?.columns).toEqual(['id']);
      expect(def.foreignKey?.onDelete).toBe('NO ACTION');
      expect(def.foreignKey?.onUpdate).toBe('NO ACTION');
    });
  });

  describe('fluent API', () => {
    it('should set nullable', () => {
      const col = new ColumnBuilder('email', { category: 'string' }).nullable(false);
      expect(col.build().nullable).toBe(false);
    });

    it('should set notNullable', () => {
      const col = new ColumnBuilder('email', { category: 'string' }).notNullable();
      expect(col.build().nullable).toBe(false);
    });

    it('should set default value', () => {
      const col = new ColumnBuilder('active', { category: 'boolean' }).defaultValue(true);
      expect(col.build().defaultValue).toBe(true);
    });

    it('should set primary key', () => {
      const col = new ColumnBuilder('id', { category: 'integer' }).primaryKey();
      const def = col.build();
      expect(def.primaryKey).toBe(true);
      expect(def.nullable).toBe(false); // PK implies NOT NULL
    });

    it('should set autoIncrement', () => {
      const col = new ColumnBuilder('id', { category: 'integer' }).autoIncrement();
      expect(col.build().autoIncrement).toBe(true);
    });

    it('should set unique', () => {
      const col = new ColumnBuilder('email', { category: 'string' }).unique();
      expect(col.build().unique).toBe(true);
    });

    it('should set comment', () => {
      const col = new ColumnBuilder('email', { category: 'string' }).comment('User email');
      expect(col.build().comment).toBe('User email');
    });

    it('should set index', () => {
      const col = new ColumnBuilder('email', { category: 'string' }).index('idx_email');
      expect(col.build().index).toBe('idx_email');
    });

    it('should set index with auto name', () => {
      const col = new ColumnBuilder('email', { category: 'string' }).index();
      expect(col.build().index).toBe(true);
    });
  });

  describe('foreign key', () => {
    it('should set references', () => {
      const col = new ColumnBuilder('userId', { category: 'integer' }).references('users', 'id');
      const def = col.build();

      expect(def.foreignKey).toBeDefined();
      expect(def.foreignKey?.table).toBe('users');
      expect(def.foreignKey?.columns).toEqual(['id']);
    });

    it('should set onDelete action', () => {
      const col = new ColumnBuilder('userId', { category: 'integer' }).references('users', 'id').onDelete('CASCADE');

      expect(col.build().foreignKey?.onDelete).toBe('CASCADE');
    });

    it('should set onUpdate action', () => {
      const col = new ColumnBuilder('userId', { category: 'integer' }).references('users').onUpdate('SET NULL');

      expect(col.build().foreignKey?.onUpdate).toBe('SET NULL');
    });

    it('should do nothing if onDelete/onUpdate called without references', () => {
      const col = new ColumnBuilder('userId', { category: 'integer' }).onDelete('CASCADE').onUpdate('CASCADE');
      expect(col.build().foreignKey).toBeUndefined();
    });
  });

  describe('chaining', () => {
    it('should support method chaining', () => {
      const col = new ColumnBuilder('email', { category: 'string', length: 255 })
        .notNullable()
        .unique()
        .comment('Primary email')
        .index();

      const def = col.build();

      expect(def.nullable).toBe(false);
      expect(def.unique).toBe(true);
      expect(def.comment).toBe('Primary email');
      expect(def.index).toBe(true);
    });
  });
});
