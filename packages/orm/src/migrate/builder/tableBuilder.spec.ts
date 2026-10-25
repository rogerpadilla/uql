import { describe, expect, it } from 'vitest';
import { PostgresDialect } from '../../postgres/postgresDialect.js';
import { currentTimestamp, uuid, sql } from '../../util/index.js';
import { formatDefaultValue } from '../ddl/defaultSql.js';
import { renderIndexDefinition } from '../generator/definitionToNode.js';
import { tableBuilder } from './tableBuilder.js';
import type { TableDefinition } from './types.js';

/** A built table's indexes as a migration renders them, which is where an unnamed one is named. */
const dialect = new PostgresDialect();

function rendered(def: TableDefinition) {
  return def.indexes.map((index) =>
    renderIndexDefinition(def.name, index, (statement) => dialect.compileDdl(statement)),
  );
}

describe('tableBuilder', () => {
  describe('basic construction', () => {
    it('should create a table with name', () => {
      const table = tableBuilder('users');
      const def = table.build();

      expect(def.name).toBe('users');
      expect(def.columns).toEqual([]);
    });
  });

  describe('column types', () => {
    it('should add id column', () => {
      const table = tableBuilder('users');
      table.id();
      const def = table.build();

      expect(def.columns.length).toBe(1);
      expect(def.columns[0].name).toBe('id');
      expect(def.columns[0].isPrimaryKey).toBe(true);
      expect(def.columns[0].isAutoIncrement).toBe(true);
    });

    it('should add custom id name', () => {
      const table = tableBuilder('users');
      table.id('user_id');
      const def = table.build();

      expect(def.columns[0].name).toBe('user_id');
    });

    it('should add integer column', () => {
      const table = tableBuilder('users');
      table.integer('age');
      const def = table.build();

      expect(def.columns[0].type.category).toBe('integer');
    });

    it('should add smallint column', () => {
      const table = tableBuilder('users');
      table.smallint('rank');
      const def = table.build();

      expect(def.columns[0].type.size).toBe('small');
    });

    it('should add bigint column', () => {
      const table = tableBuilder('users');
      table.bigint('views');
      const def = table.build();

      expect(def.columns[0].type.size).toBe('big');
    });

    it('should add float column', () => {
      const table = tableBuilder('users');
      table.float('score');
      const def = table.build();

      expect(def.columns[0].type.category).toBe('float');
    });

    it('should add double column', () => {
      const table = tableBuilder('users');
      table.double('amount');
      const def = table.build();

      expect(def.columns[0].type.category).toBe('float');
      expect(def.columns[0].type.size).toBe('big');
    });

    it('should add decimal column', () => {
      const table = tableBuilder('users');
      table.decimal('price', 10, 2);
      const def = table.build();

      expect(def.columns[0].type.category).toBe('decimal');
      expect(def.columns[0].type.precision).toBe(10);
      expect(def.columns[0].type.scale).toBe(2);
    });

    it('should add string column', () => {
      const table = tableBuilder('users');
      table.string('name').length(100);
      const def = table.build();

      expect(def.columns[0].type.category).toBe('string');
      expect(def.columns[0].type.length).toBe(100);
    });

    it('should add string column with default length', () => {
      const table = tableBuilder('users');
      table.string('name');
      const def = table.build();

      expect(def.columns[0].type.length).toBe(255);
    });

    it('should add char column', () => {
      const table = tableBuilder('users');
      table.char('code').length(5);
      const def = table.build();

      expect(def.columns[0].type.length).toBe(5);
    });

    it('should add text column', () => {
      const table = tableBuilder('users');
      table.text('bio');
      const def = table.build();

      expect(def.columns[0].type.category).toBe('string');
    });

    it('should add boolean column', () => {
      const table = tableBuilder('users');
      table.boolean('active');
      const def = table.build();

      expect(def.columns[0].type.category).toBe('boolean');
    });

    it('should add date column', () => {
      const table = tableBuilder('users');
      table.date('birthdate');
      const def = table.build();

      expect(def.columns[0].type.category).toBe('date');
    });

    it('should add time column', () => {
      const table = tableBuilder('users');
      table.time('startTime');
      const def = table.build();

      expect(def.columns[0].type.category).toBe('time');
    });

    it('should add timestamp column', () => {
      const table = tableBuilder('users');
      table.timestamp('createdAt');
      const def = table.build();

      expect(def.columns[0].type.category).toBe('timestamp');
    });

    it('should add timestamptz column', () => {
      const table = tableBuilder('users');
      table.timestamptz('createdAt');
      const def = table.build();

      expect(def.columns[0].type.withTimezone).toBe(true);
    });

    it('should add json column', () => {
      const table = tableBuilder('users');
      table.json('metadata');
      const def = table.build();

      expect(def.columns[0].type.category).toBe('json');
    });

    it('should add jsonb column', () => {
      const table = tableBuilder('users');
      table.jsonb('metadata');
      const def = table.build();

      expect(def.columns[0].type.category).toBe('json');
    });

    it('should add uuid column', () => {
      const table = tableBuilder('users');
      table.uuid('publicId');
      const def = table.build();

      expect(def.columns[0].type.category).toBe('uuid');
    });

    it('should add blob column', () => {
      const table = tableBuilder('users');
      table.blob('data');
      const def = table.build();

      expect(def.columns[0].type.category).toBe('blob');
    });

    it('should add vector column', () => {
      const table = tableBuilder('users');
      table.vector('embedding', 1536);
      const def = table.build();

      expect(def.columns[0].type.category).toBe('vector');
      expect(def.columns[0].type.length).toBe(1536);
    });
  });

  describe('SQL defaults', () => {
    it('should take the values and raw SQL an entity takes, through default()', () => {
      const table = tableBuilder('events');
      table.timestamp('at').default(currentTimestamp);
      table.uuid('key').default(uuid);
      table.bigint('seq').default(sql`nextval('s')`);

      const statement = table
        .build()
        .columns.map((column) => formatDefaultValue(column.defaultValue, new PostgresDialect()));
      expect(statement).toEqual(['CURRENT_TIMESTAMP', 'gen_random_uuid()', "(nextval('s'))"]);
    });
  });

  describe('convenience methods', () => {
    it('should add createdAt column', () => {
      const table = tableBuilder('users');
      table.createdAt();
      const def = table.build();

      expect(def.columns[0].name).toBe('createdAt');
      expect(def.columns[0].type).toEqual({ category: 'timestamp', withTimezone: true, precision: 3 });
      expect(def.columns[0].nullable).toBe(false);
      expect(def.columns[0].defaultValue).toBeDefined();
    });

    it('should add updatedAt column', () => {
      const table = tableBuilder('users');
      table.updatedAt();
      const def = table.build();

      expect(def.columns[0].name).toBe('updatedAt');
      expect(def.columns[0].type).toEqual({ category: 'timestamp', withTimezone: true, precision: 3 });
    });

    it('should add timestamps', () => {
      const table = tableBuilder('users');
      table.timestamps();
      const def = table.build();

      expect(def.columns.length).toBe(2);
      expect(def.columns[0].name).toBe('createdAt');
      expect(def.columns[1].name).toBe('updatedAt');
    });
  });

  describe('indexes and constraints', () => {
    it('should add composite primary key', () => {
      const table = tableBuilder('user_roles');
      table.integer('userId');
      table.integer('roleId');
      table.primaryKey(['userId', 'roleId']);
      const def = table.build();

      expect(def.primaryKey).toEqual(['userId', 'roleId']);
    });

    it('should add unique constraint', () => {
      const table = tableBuilder('users');
      table.string('email');
      table.string('username');
      table.unique(['email', 'username'], 'users_email_username_uk');
      const def = table.build();

      expect(def.indexes.length).toBe(1);
      expect(rendered(def)[0].name).toBe('users_email_username_uk');
      expect(def.indexes[0].unique).toBe(true);
    });

    it('should auto-generate unique constraint name', () => {
      const table = tableBuilder('users');
      table.unique(['email']);
      const def = table.build();

      expect(rendered(def)[0].name).toBe('users__email_uk');
    });

    it('should add composite index', () => {
      const table = tableBuilder('users');
      table.index(['lastName', 'firstName'], 'users__name_idx');
      const def = table.build();

      expect(rendered(def)[0].name).toBe('users__name_idx');
      expect(def.indexes[0].entries).toEqual([{ column: 'lastName' }, { column: 'firstName' }]);
      expect(def.indexes[0].unique).toBe(false);
    });

    /** `unique` is one of `@Index`'s options, so `index` takes it; only `unique()` derives the `_uk` name. */
    it('should make an index unique where its options say so', () => {
      const table = tableBuilder('users');
      table.index(['email'], { unique: true });

      expect(rendered(table.build())).toEqual([
        { name: 'users__email_idx', entries: [{ column: 'email' }], unique: true },
      ]);
    });

    it('should take the same entries and options as the @Index decorator', () => {
      const table = tableBuilder('notes');
      table.index([sql`lower("email")`, { column: 'body', prefixLength: 64 }], {
        name: 'notes_lookup_idx',
        type: 'gin',
        where: sql`"deletedAt" IS NULL`,
        include: ['title'],
      });
      expect(rendered(table.build())[0]).toEqual({
        name: 'notes_lookup_idx',
        entries: [{ expression: 'lower("email")' }, { column: 'body', prefixLength: 64 }],
        unique: false,
        type: 'gin',
        where: '"deletedAt" IS NULL',
        include: ['title'],
      });
    });

    it('should name an index after its entries when none is given', () => {
      const table = tableBuilder('notes');
      table.index([{ column: 'tenantId' }, { column: 'createdAt', order: 'desc' }]);

      expect(rendered(table.build())[0].name).toBe('notes__tenantId_createdAt_idx');
    });

    it('should name an expression after its position, as an entity names one', () => {
      const table = tableBuilder('notes');
      table.unique(['tenantId', sql`lower("email")`]);

      expect(rendered(table.build())[0].name).toBe('notes__tenantId_expr1_uk');
    });

    it('should add table-level foreign key with options', () => {
      const table = tableBuilder('posts');
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
      expect(def.foreignKeys[0].references.table).toBe('users');
      expect(def.foreignKeys[0].onDelete).toBe('CASCADE');
      expect(def.foreignKeys[0].onUpdate).toBe('CASCADE');
      expect(def.foreignKeys[0].name).toBe('posts_author_fk');
    });
  });

  describe('column-level indexes', () => {
    it('should collect column-level indexes', () => {
      const table = tableBuilder('users');
      table.string('email').index('email_idx');
      const def = table.build();

      expect(def.indexes.length).toBe(1);
      expect(rendered(def)[0].name).toBe('email_idx');
    });

    it('should auto-generate index name', () => {
      const table = tableBuilder('users');
      table.string('email').index();
      const def = table.build();

      expect(rendered(def)[0].name).toBe('users__email_idx');
    });

    /** A unique column is a unique index, the one spelling of uniqueness every engine can add and drop. */
    it('should make a unique column a unique index', () => {
      const table = tableBuilder('users');
      table.string('email').unique();

      expect(rendered(table.build())).toEqual([
        { name: 'users__email_idx', entries: [{ column: 'email' }], unique: true },
      ]);
    });
  });

  describe('table comment', () => {
    it('should set table comment', () => {
      const table = tableBuilder('users');
      table.comment('User accounts');
      const def = table.build();

      expect(def.comment).toBe('User accounts');
    });
  });

  describe('full table example', () => {
    it('should build a complete table', () => {
      const table = tableBuilder('users');
      table.id();
      table.string('email').unique();
      table.string('name').length(100).nullable();
      table.boolean('active').default(true);
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
      const table = tableBuilder('users');
      table.index(['email']);
      const def = table.build();

      expect(rendered(def)[0].name).toBe('users__email_idx');
      expect(def.indexes[0].unique).toBe(false);
    });

    it('should skip FK builder when references not called', () => {
      const table = tableBuilder('posts');
      table.integer('authorId');
      table.foreignKey(['authorId']); // no .references() call
      const def = table.build();

      expect(def.foreignKeys.length).toBe(0);
    });

    it('should skip duplicate column-level index if table-level index exists', () => {
      const table = tableBuilder('users');
      table.string('email').index('users__email_idx');
      table.index(['email'], 'users__email_idx'); // same name as column-level
      const def = table.build();

      // Should not duplicate the index
      expect(def.indexes.filter((i) => i.name === 'users__email_idx').length).toBe(1);
    });
  });
});

describe('partial-index predicate', () => {
  it('should be rendered for the engine the migration runs on, a value written as its literal', () => {
    const table = tableBuilder('Item');
    table.index(['name'], { where: sql`"stock" > ${0}` });
    expect(rendered(table.build())[0].where).toBe('"stock" > 0');
  });
});
