import { describe, expect, it, vi } from 'vitest';
import { PostgresDialect } from '../../postgres/postgresDialect.js';
import { createMockQuerier, sentStatements } from '../../test/index.js';
import { migrationBuilderFor } from '../migrationTarget.js';
import { MigrationOperationBuilder } from './migrationBuilder.js';
import type { AnyMigrationOperation } from './types.js';

/** A builder keeping each operation it is handed, in `operations`. */
function recording() {
  const operations: AnyMigrationOperation[] = [];
  const recorder = new MigrationOperationBuilder(async (operation) => {
    operations.push(operation);
  });
  return { recorder, operations };
}

describe('MigrationOperationBuilder operations', () => {
  describe('createTable', () => {
    it('should record createTable operation', async () => {
      const { recorder, operations } = recording();

      await recorder.createTable('users', (table) => {
        table.id();
        table.string('email', { unique: true });
      });

      const ops = operations;
      expect(ops.length).toBe(1);
      expect(ops[0].type).toBe('createTable');

      expect(ops[0]).toMatchObject({ table: { name: 'users', columns: [{ name: 'id' }, { name: 'email' }] } });
    });
  });

  describe('dropTable', () => {
    it('should record dropTable operation', async () => {
      const { recorder, operations } = recording();

      await recorder.dropTable('users');

      const ops = operations;
      expect(ops.length).toBe(1);
      expect(ops[0].type).toBe('dropTable');
      expect(ops[0]).toMatchObject({ tableName: 'users' });
    });

    it('should support ifExists option', async () => {
      const { recorder, operations } = recording();

      await recorder.dropTable('users', { ifExists: true });

      const ops = operations;
      expect(ops[0]).toMatchObject({ ifExists: true });
    });

    it('should support cascade option', async () => {
      const { recorder, operations } = recording();

      await recorder.dropTable('users', { cascade: true });

      const ops = operations;
      expect(ops[0]).toMatchObject({ cascade: true });
    });
  });

  describe('renameTable', () => {
    it('should record renameTable operation', async () => {
      const { recorder, operations } = recording();

      await recorder.renameTable('old_users', 'users');

      const ops = operations;
      expect(ops.length).toBe(1);
      expect(ops[0].type).toBe('renameTable');
      expect(ops[0]).toMatchObject({ oldName: 'old_users' });
      expect(ops[0]).toMatchObject({ newName: 'users' });
    });
  });

  describe('addColumn', () => {
    it('should record addColumn operation', async () => {
      const { recorder, operations } = recording();

      await recorder.addColumn('users', (c) => c.integer('age'));

      const ops = operations;
      expect(ops.length).toBe(1);
      expect(ops[0].type).toBe('addColumn');
      expect(ops[0]).toMatchObject({ tableName: 'users' });
      expect(ops[0]).toMatchObject({ column: { name: 'age' } });
    });
  });

  describe('dropColumn', () => {
    it('should record dropColumn operation', async () => {
      const { recorder, operations } = recording();

      await recorder.dropColumn('users', 'age');

      const ops = operations;
      expect(ops.length).toBe(1);
      expect(ops[0].type).toBe('dropColumn');
      expect(ops[0]).toMatchObject({ tableName: 'users' });
      expect(ops[0]).toMatchObject({ columnName: 'age' });
    });
  });

  describe('renameColumn', () => {
    it('should record renameColumn operation', async () => {
      const { recorder, operations } = recording();

      await recorder.renameColumn('users', 'old_name', 'new_name');

      const ops = operations;
      expect(ops.length).toBe(1);
      expect(ops[0].type).toBe('renameColumn');
      expect(ops[0]).toMatchObject({ oldName: 'old_name' });
      expect(ops[0]).toMatchObject({ newName: 'new_name' });
    });
  });

  describe('createIndex', () => {
    it('should record createIndex operation', async () => {
      const { recorder, operations } = recording();

      await recorder.createIndex('users', ['email']);

      const ops = operations;
      expect(ops.length).toBe(1);
      expect(ops[0].type).toBe('createIndex');
      expect(ops[0]).toMatchObject({ index: { entries: [{ column: 'email' }] } });
    });

    it('should record an unnamed index, which is named for its table when rendered', async () => {
      const { recorder, operations } = recording();

      await recorder.createIndex('users', ['email', 'status']);

      const ops = operations;
      expect(ops[0]).toMatchObject({
        index: { name: undefined, entries: [{ column: 'email' }, { column: 'status' }] },
      });
    });

    it('should use custom index name', async () => {
      const { recorder, operations } = recording();

      await recorder.createIndex('users', ['email'], { name: 'custom_idx' });

      const ops = operations;
      expect(ops[0]).toMatchObject({ index: { name: 'custom_idx' } });
    });

    it('should support unique option', async () => {
      const { recorder, operations } = recording();

      await recorder.createIndex('users', ['email'], { unique: true });

      const ops = operations;
      expect(ops[0]).toMatchObject({ index: { unique: true } });
    });
  });

  describe('dropIndex', () => {
    it('should record dropIndex operation', async () => {
      const { recorder, operations } = recording();

      await recorder.dropIndex('users', 'users__email_idx');

      const ops = operations;
      expect(ops.length).toBe(1);
      expect(ops[0].type).toBe('dropIndex');
      expect(ops[0]).toMatchObject({ indexName: 'users__email_idx' });
    });
  });

  describe('addForeignKey', () => {
    it('should record addForeignKey operation', async () => {
      const { recorder, operations } = recording();

      await recorder.addForeignKey('posts', ['authorId'], { table: 'users', columns: ['id'] });

      const ops = operations;
      expect(ops.length).toBe(1);
      expect(ops[0].type).toBe('addForeignKey');
      expect(ops[0]).toMatchObject({ foreignKey: { columns: ['authorId'] } });
      expect(ops[0]).toMatchObject({ foreignKey: { references: { table: 'users' } } });
    });

    it('should support onDelete option', async () => {
      const { recorder, operations } = recording();

      await recorder.addForeignKey('posts', ['authorId'], { table: 'users', columns: ['id'] }, { onDelete: 'CASCADE' });

      const ops = operations;
      expect(ops[0]).toMatchObject({ foreignKey: { onDelete: 'CASCADE' } });
    });
  });

  describe('dropForeignKey', () => {
    it('should record dropForeignKey operation', async () => {
      const { recorder, operations } = recording();

      await recorder.dropForeignKey('posts', 'posts_author_fk');

      const ops = operations;
      expect(ops.length).toBe(1);
      expect(ops[0].type).toBe('dropForeignKey');
      expect(ops[0]).toMatchObject({ constraintName: 'posts_author_fk' });
    });
  });

  describe('raw', () => {
    it('should record raw SQL operation', async () => {
      const { recorder, operations } = recording();

      await recorder.raw('ALTER TABLE users ADD CONSTRAINT custom CHECK (age > 0)');

      const ops = operations;
      expect(ops.length).toBe(1);
      expect(ops[0].type).toBe('raw');
      expect(ops[0]).toMatchObject({ sql: 'ALTER TABLE users ADD CONSTRAINT custom CHECK (age > 0)' });
    });
  });

  describe('multiple operations', () => {
    it('should record multiple operations in order', async () => {
      const { recorder, operations } = recording();

      await recorder.createTable('users', (table) => {
        table.id();
        table.string('email');
      });

      await recorder.createTable('posts', (table) => {
        table.id();
        table.string('title');
        table.integer('authorId').references('users', 'id');
      });

      await recorder.createIndex('users', ['email'], { unique: true });

      const ops = operations;
      expect(ops.length).toBe(3);
      expect(ops[0].type).toBe('createTable');
      expect(ops[1].type).toBe('createTable');
      expect(ops[2].type).toBe('createIndex');
    });
  });

  describe('alterTable', () => {
    it('should record alterTable operation with nested column changes', async () => {
      const { recorder, operations } = recording();

      await recorder.alterTable('users', (table) => {
        table.addColumn((c) => c.string('email', { unique: true }));
        table.dropColumn('old_field');
        table.renameColumn('old_name', 'new_name');
        table.alterColumn((c) => c.string('email', { nullable: true }));
      });

      const ops = operations;
      expect(ops.map((o) => o.type)).toEqual(['addColumn', 'dropColumn', 'renameColumn', 'alterColumn']);
      expect(ops[3]).toMatchObject({ changes: { name: 'email' } });
    });
  });

  describe('alterColumn', () => {
    it('should record alterColumn operation', async () => {
      const { recorder, operations } = recording();

      await recorder.alterColumn('users', (c) => c.string('email', { nullable: true }));

      const ops = operations;
      expect(ops.length).toBe(1);
      expect(ops[0].type).toBe('alterColumn');
    });

    /** An alter restates the column alone, so an index or a key declared on it would be lost without a word. */
    it('should refuse an index or a foreign key declared on the column', async () => {
      const { recorder, operations } = recording();

      await expect(recorder.alterColumn('users', (c) => c.string('email').index())).rejects.toThrow(
        /alterColumn changes 'email' alone: add its index with createIndex/,
      );
      await expect(recorder.alterColumn('users', (c) => c.integer('orgId').references('orgs'))).rejects.toThrow(
        /alterColumn changes 'orgId' alone: .*its foreign key with addForeignKey/,
      );
      expect(operations).toEqual([]);
    });
  });

  describe('alterTable operations', () => {
    it('should record addIndex, dropIndex, addForeignKey, dropForeignKey', async () => {
      const { recorder, operations } = recording();

      await recorder.alterTable('users', (table) => {
        table.addIndex(['email'], { unique: true, name: 'custom_idx' });
        table.dropIndex('custom_idx');
        table.addForeignKey(
          ['profile_id'],
          { table: 'profiles', columns: ['id'] },
          { onDelete: 'CASCADE', name: 'users_profile_fk' },
        );
        table.dropForeignKey('users_profile_fk');
      });

      const ops = operations;
      expect(ops.map((o) => o.type)).toEqual(['createIndex', 'dropIndex', 'addForeignKey', 'dropForeignKey']);

      expect(ops[0]).toMatchObject({ index: { name: 'custom_idx', unique: true } });
      expect(ops[2]).toMatchObject({
        foreignKey: { references: { table: 'profiles' }, onDelete: 'CASCADE', name: 'users_profile_fk' },
      });
    });
  });

  describe('default values', () => {
    it('should use default names and actions if not provided', async () => {
      const { recorder, operations } = recording();
      await recorder.alterTable('users', (table) => {
        table.addIndex(['name']);
        table.addForeignKey(['role_id'], { table: 'roles', columns: ['id'] });
      });

      expect(operations).toMatchObject([
        { type: 'createIndex', index: { unique: false } },
        {
          type: 'addForeignKey',
          foreignKey: { columns: ['role_id'], references: { table: 'roles', columns: ['id'] } },
        },
      ]);
    });
  });
});

describe('migrationBuilderFor', () => {
  const dialect = new PostgresDialect();
  const sqlQuerier = () => createMockQuerier({ all: vi.fn(), run: vi.fn().mockResolvedValue({}), dialect });
  const sentSql = (querier: ReturnType<typeof sqlQuerier>) =>
    sentStatements(dialect, querier.run).map(({ sql }) => sql);

  describe('execution', () => {
    it('should generate SQL and run it', async () => {
      const mockQuerier = sqlQuerier();
      const builder = await migrationBuilderFor(mockQuerier);

      await builder.createTable('users', (table) => {
        table.id();
      });

      const [created] = sentSql(mockQuerier);
      expect(created).toContain('CREATE TABLE "users"');
    });
  });

  describe('alterTable execution', () => {
    /** Every nested change has run by the time `alterTable` resolves, in the order it was declared. */
    it('should run each nested column change', async () => {
      const mockQuerier = sqlQuerier();
      const builder = await migrationBuilderFor(mockQuerier);

      await builder.alterTable('users', (table) => {
        table.addColumn((c) => c.string('nickname', { nullable: true }));
        table.dropColumn('legacy');
      });

      expect(sentSql(mockQuerier)).toEqual([
        'ALTER TABLE "users" ADD COLUMN "nickname" VARCHAR(255);',
        'ALTER TABLE "users" DROP COLUMN "legacy";',
      ]);
    });
  });

  describe('raw execution', () => {
    it('should run raw SQL', async () => {
      const mockQuerier = sqlQuerier();
      const builder = await migrationBuilderFor(mockQuerier);

      await builder.raw('SELECT 1');

      expect(sentSql(mockQuerier)).toEqual(['SELECT 1']);
    });
  });

  describe('all operations with execution', () => {
    it('should generate SQL for all operations', async () => {
      const mockQuerier = sqlQuerier();
      const builder = await migrationBuilderFor(mockQuerier);

      await builder.createTable('t', (t) => t.id());
      await builder.dropTable('t');
      await builder.renameTable('t', 't2');
      await builder.addColumn('t', (c) => c.integer('c', { nullable: true }));
      await builder.dropColumn('t', 'c');
      await builder.renameColumn('t', 'c', 'c2');
      await builder.alterColumn('t', (c) => c.integer('c', { nullable: true }));
      await builder.createIndex('t', ['c']);
      await builder.dropIndex('t', 'i');
      await builder.addForeignKey('t', ['c'], { table: 't2', columns: ['id'] });
      await builder.dropForeignKey('t', 'f');

      // Each operation should have called querier.run, an alter once for all its clauses
      const sent = sentSql(mockQuerier);
      expect(sent).toHaveLength(11);
      expect(sent).toContain(
        'ALTER TABLE "t" ALTER COLUMN "c" TYPE INTEGER USING "c"::INTEGER, ALTER COLUMN "c" DROP NOT NULL, ALTER COLUMN "c" DROP DEFAULT;',
      );
    });
  });
});
