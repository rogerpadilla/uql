import { describe, expect, it } from 'vitest';
import { raw } from '../../util/index.js';
import { TableBuilder } from './tableBuilder.js';

describe('TableBuilder', () => {
  describe('basic construction', () => {
    it('should create a table with name', () => {
      const table = new TableBuilder('users');
      const def = table.build();

      expect(def.name).toBe('users');
      expect(def.columns).toEqual([]);
    });
  });

  describe('column types', () => {
    it('should add id column', () => {
      const table = new TableBuilder('users');
      table.id();
      const def = table.build();

      expect(def.columns.length).toBe(1);
      expect(def.columns[0].name).toBe('id');
      expect(def.columns[0].primaryKey).toBe(true);
      expect(def.columns[0].autoIncrement).toBe(true);
    });

    it('should add custom id name', () => {
      const table = new TableBuilder('users');
      table.id('user_id');
      const def = table.build();

      expect(def.columns[0].name).toBe('user_id');
    });

    it('should add integer column', () => {
      const table = new TableBuilder('users');
      table.integer('age');
      const def = table.build();

      expect(def.columns[0].type.category).toBe('integer');
    });

    it('should add smallint column', () => {
      const table = new TableBuilder('users');
      table.smallint('rank');
      const def = table.build();

      expect(def.columns[0].type.size).toBe('small');
    });

    it('should add bigint column', () => {
      const table = new TableBuilder('users');
      table.bigint('views');
      const def = table.build();

      expect(def.columns[0].type.size).toBe('big');
    });

    it('should add float column', () => {
      const table = new TableBuilder('users');
      table.float('score');
      const def = table.build();

      expect(def.columns[0].type.category).toBe('float');
    });

    it('should add double column', () => {
      const table = new TableBuilder('users');
      table.double('amount');
      const def = table.build();

      expect(def.columns[0].type.category).toBe('float');
      expect(def.columns[0].type.size).toBe('big');
    });

    it('should add decimal column', () => {
      const table = new TableBuilder('users');
      table.decimal('price', { precision: 10, scale: 2 });
      const def = table.build();

      expect(def.columns[0].type.category).toBe('decimal');
      expect(def.columns[0].type.precision).toBe(10);
      expect(def.columns[0].type.scale).toBe(2);
    });

    it('should add string column', () => {
      const table = new TableBuilder('users');
      table.string('name', { length: 100 });
      const def = table.build();

      expect(def.columns[0].type.category).toBe('string');
      expect(def.columns[0].type.length).toBe(100);
    });

    it('should add string column with default length', () => {
      const table = new TableBuilder('users');
      table.string('name');
      const def = table.build();

      expect(def.columns[0].type.length).toBe(255);
    });

    it('should add char column', () => {
      const table = new TableBuilder('users');
      table.char('code', { length: 5 });
      const def = table.build();

      expect(def.columns[0].type.length).toBe(5);
    });

    it('should add text column', () => {
      const table = new TableBuilder('users');
      table.text('bio');
      const def = table.build();

      expect(def.columns[0].type.category).toBe('string');
    });

    it('should add boolean column', () => {
      const table = new TableBuilder('users');
      table.boolean('active');
      const def = table.build();

      expect(def.columns[0].type.category).toBe('boolean');
    });

    it('should add date column', () => {
      const table = new TableBuilder('users');
      table.date('birthdate');
      const def = table.build();

      expect(def.columns[0].type.category).toBe('date');
    });

    it('should add time column', () => {
      const table = new TableBuilder('users');
      table.time('startTime');
      const def = table.build();

      expect(def.columns[0].type.category).toBe('time');
    });

    it('should add timestamp column', () => {
      const table = new TableBuilder('users');
      table.timestamp('createdAt');
      const def = table.build();

      expect(def.columns[0].type.category).toBe('timestamp');
    });

    it('should add timestamptz column', () => {
      const table = new TableBuilder('users');
      table.timestamptz('createdAt');
      const def = table.build();

      expect(def.columns[0].type.withTimezone).toBe(true);
    });

    it('should add json column', () => {
      const table = new TableBuilder('users');
      table.json('metadata');
      const def = table.build();

      expect(def.columns[0].type.category).toBe('json');
    });

    it('should add jsonb column', () => {
      const table = new TableBuilder('users');
      table.jsonb('metadata');
      const def = table.build();

      expect(def.columns[0].type.category).toBe('json');
    });

    it('should add uuid column', () => {
      const table = new TableBuilder('users');
      table.uuid('publicId');
      const def = table.build();

      expect(def.columns[0].type.category).toBe('uuid');
    });

    it('should add blob column', () => {
      const table = new TableBuilder('users');
      table.blob('data');
      const def = table.build();

      expect(def.columns[0].type.category).toBe('blob');
    });

    it('should add vector column', () => {
      const table = new TableBuilder('users');
      table.vector('embedding', { dimensions: 1536 });
      const def = table.build();

      expect(def.columns[0].type.category).toBe('vector');
      expect(def.columns[0].type.length).toBe(1536);
    });
  });

  describe('convenience methods', () => {
    it('should add createdAt column', () => {
      const table = new TableBuilder('users');
      table.createdAt();
      const def = table.build();

      expect(def.columns[0].name).toBe('createdAt');
      expect(def.columns[0].type.category).toBe('timestamp');
      expect(def.columns[0].nullable).toBe(false);
      expect(def.columns[0].defaultValue).toBeDefined();
    });

    it('should add updatedAt column', () => {
      const table = new TableBuilder('users');
      table.updatedAt();
      const def = table.build();

      expect(def.columns[0].name).toBe('updatedAt');
    });

    it('should add timestamps', () => {
      const table = new TableBuilder('users');
      table.timestamps();
      const def = table.build();

      expect(def.columns.length).toBe(2);
      expect(def.columns[0].name).toBe('createdAt');
      expect(def.columns[1].name).toBe('updatedAt');
    });
  });

  describe('indexes and constraints', () => {
    it('should add composite primary key', () => {
      const table = new TableBuilder('user_roles');
      table.integer('userId');
      table.integer('roleId');
      table.primaryKey(['userId', 'roleId']);
      const def = table.build();

      expect(def.primaryKey).toEqual(['userId', 'roleId']);
    });

    it('should add unique constraint', () => {
      const table = new TableBuilder('users');
      table.string('email');
      table.string('username');
      table.unique(['email', 'username'], 'users_email_username_uk');
      const def = table.build();

      expect(def.indexes.length).toBe(1);
      expect(def.indexes[0].name).toBe('users_email_username_uk');
      expect(def.indexes[0].unique).toBe(true);
    });

    it('should auto-generate unique constraint name', () => {
      const table = new TableBuilder('users');
      table.unique(['email']);
      const def = table.build();

      expect(def.indexes[0].name).toBe('users__email_uk');
    });

    it('should add composite index', () => {
      const table = new TableBuilder('users');
      table.index(['lastName', 'firstName'], 'users__name_idx');
      const def = table.build();

      expect(def.indexes[0].name).toBe('users__name_idx');
      expect(def.indexes[0].entries).toEqual([{ column: 'lastName' }, { column: 'firstName' }]);
      expect(def.indexes[0].unique).toBe(false);
    });

    it('should take the same entries and options as the @Index decorator', () => {
      const table = new TableBuilder('notes');
      table.index([raw`lower("email")`, { column: 'body', length: 64 }], {
        name: 'notes_lookup_idx',
        type: 'gin',
        where: '"deletedAt" IS NULL',
        include: ['title'],
      });
      const def = table.build();

      expect(def.indexes[0]).toEqual({
        name: 'notes_lookup_idx',
        entries: [
          { column: 'lower("email")', expression: true },
          { column: 'body', length: 64 },
        ],
        unique: false,
        type: 'gin',
        where: '"deletedAt" IS NULL',
        include: ['title'],
      });
    });

    it('should name an index after its entries when none is given', () => {
      const table = new TableBuilder('notes');
      table.index([{ column: 'tenantId' }, { column: 'createdAt', order: 'desc' }]);

      expect(table.build().indexes[0].name).toBe('notes__tenantId_createdAt_idx');
    });

    it('should add table-level foreign key with options', () => {
      const table = new TableBuilder('posts');
      table.integer('authorId');
      table
        .foreignKey(['authorId'])
        .references('users', ['id'])
        .onDelete('CASCADE')
        .onUpdate('CASCADE')
        .name('posts_author_fk');
      const def = table.build();

      expect(def.foreignKeys.length).toBe(1);
      expect(def.foreignKeys[0].columns).toEqual(['authorId']);
      expect(def.foreignKeys[0].referencesTable).toBe('users');
      expect(def.foreignKeys[0].onDelete).toBe('CASCADE');
      expect(def.foreignKeys[0].onUpdate).toBe('CASCADE');
      expect(def.foreignKeys[0].name).toBe('posts_author_fk');
    });
  });

  describe('column-level indexes', () => {
    it('should collect column-level indexes', () => {
      const table = new TableBuilder('users');
      table.string('email').index('email_idx');
      const def = table.build();

      expect(def.indexes.length).toBe(1);
      expect(def.indexes[0].name).toBe('email_idx');
    });

    it('should auto-generate index name', () => {
      const table = new TableBuilder('users');
      table.string('email').index();
      const def = table.build();

      expect(def.indexes[0].name).toBe('users__email_idx');
    });
  });

  describe('table comment', () => {
    it('should set table comment', () => {
      const table = new TableBuilder('users');
      table.comment('User accounts');
      const def = table.build();

      expect(def.comment).toBe('User accounts');
    });
  });

  describe('full table example', () => {
    it('should build a complete table', () => {
      const table = new TableBuilder('users');
      table.id();
      table.string('email', { unique: true });
      table.string('name', { length: 100, nullable: true });
      table.boolean('active', { defaultValue: true });
      table.timestamps();
      table.comment('User accounts table');

      const def = table.build();

      expect(def.name).toBe('users');
      expect(def.columns.length).toBe(6);
      expect(def.comment).toBe('User accounts table');
    });
  });

  describe('edge cases', () => {
    it('should auto-generate index name for table-level index()', () => {
      const table = new TableBuilder('users');
      table.index(['email']);
      const def = table.build();

      expect(def.indexes[0].name).toBe('users__email_idx');
      expect(def.indexes[0].unique).toBe(false);
    });

    it('should skip FK builder when references not called', () => {
      const table = new TableBuilder('posts');
      table.integer('authorId');
      table.foreignKey(['authorId']); // no .references() call
      const def = table.build();

      expect(def.foreignKeys.length).toBe(0);
    });

    it('should skip duplicate column-level index if table-level index exists', () => {
      const table = new TableBuilder('users');
      table.string('email').index('users__email_idx');
      table.index(['email'], 'users__email_idx'); // same name as column-level
      const def = table.build();

      // Should not duplicate the index
      expect(def.indexes.filter((i) => i.name === 'users__email_idx').length).toBe(1);
    });
  });
});

describe('partial-index predicate', () => {
  it('takes raw with no interpolation and normalizes it to text', () => {
    const table = new TableBuilder('Item');
    table.index(['name'], { where: raw`"isActive" IS TRUE` });
    expect(table.build().indexes[0]?.where).toBe('"isActive" IS TRUE');
  });

  it('still takes the older bare string', () => {
    const table = new TableBuilder('Item');
    table.index(['name'], { where: '"isActive" IS TRUE' });
    expect(table.build().indexes[0]?.where).toBe('"isActive" IS TRUE');
  });

  it('refuses a predicate that would need a bound value, which DDL cannot carry', () => {
    const table = new TableBuilder('Item');
    expect(() => table.index(['name'], { where: raw`"stock" > ${0}` })).toThrow(/needs raw\(\) with no interpolation/);
  });
});
