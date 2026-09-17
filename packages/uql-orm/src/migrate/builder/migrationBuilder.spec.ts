import { describe, expect, it, vi } from 'vitest';
import { PostgresDialect } from '../../postgres/postgresDialect.js';
import { SqlSchemaGenerator } from '../schemaGenerator.js';
import { MigrationBuilder, OperationRecorder } from './migrationBuilder.js';

describe('OperationRecorder', () => {
  describe('createTable', () => {
    it('should record createTable operation', async () => {
      const recorder = new OperationRecorder();

      await recorder.createTable('users', (table) => {
        table.id();
        table.string('email', { unique: true });
      });

      const ops = recorder.getOperations();
      expect(ops.length).toBe(1);
      expect(ops[0].type).toBe('createTable');

      expect(ops[0]).toMatchObject({ table: { name: 'users', columns: [{ name: 'id' }, { name: 'email' }] } });
    });
  });

  describe('dropTable', () => {
    it('should record dropTable operation', async () => {
      const recorder = new OperationRecorder();

      await recorder.dropTable('users');

      const ops = recorder.getOperations();
      expect(ops.length).toBe(1);
      expect(ops[0].type).toBe('dropTable');
      expect(ops[0]).toMatchObject({ tableName: 'users' });
    });

    it('should support ifExists option', async () => {
      const recorder = new OperationRecorder();

      await recorder.dropTable('users', { ifExists: true });

      const ops = recorder.getOperations();
      expect(ops[0]).toMatchObject({ ifExists: true });
    });

    it('should support cascade option', async () => {
      const recorder = new OperationRecorder();

      await recorder.dropTable('users', { cascade: true });

      const ops = recorder.getOperations();
      expect(ops[0]).toMatchObject({ cascade: true });
    });
  });

  describe('renameTable', () => {
    it('should record renameTable operation', async () => {
      const recorder = new OperationRecorder();

      await recorder.renameTable('old_users', 'users');

      const ops = recorder.getOperations();
      expect(ops.length).toBe(1);
      expect(ops[0].type).toBe('renameTable');
      expect(ops[0]).toMatchObject({ oldName: 'old_users' });
      expect(ops[0]).toMatchObject({ newName: 'users' });
    });
  });

  describe('addColumn', () => {
    it('should record addColumn operation', async () => {
      const recorder = new OperationRecorder();

      await recorder.addColumn('users', (c) => c.integer('age'));

      const ops = recorder.getOperations();
      expect(ops.length).toBe(1);
      expect(ops[0].type).toBe('addColumn');
      expect(ops[0]).toMatchObject({ tableName: 'users' });
      expect(ops[0]).toMatchObject({ column: { name: 'age' } });
    });
  });

  describe('dropColumn', () => {
    it('should record dropColumn operation', async () => {
      const recorder = new OperationRecorder();

      await recorder.dropColumn('users', 'age');

      const ops = recorder.getOperations();
      expect(ops.length).toBe(1);
      expect(ops[0].type).toBe('dropColumn');
      expect(ops[0]).toMatchObject({ tableName: 'users' });
      expect(ops[0]).toMatchObject({ columnName: 'age' });
    });
  });

  describe('renameColumn', () => {
    it('should record renameColumn operation', async () => {
      const recorder = new OperationRecorder();

      await recorder.renameColumn('users', 'old_name', 'new_name');

      const ops = recorder.getOperations();
      expect(ops.length).toBe(1);
      expect(ops[0].type).toBe('renameColumn');
      expect(ops[0]).toMatchObject({ oldName: 'old_name' });
      expect(ops[0]).toMatchObject({ newName: 'new_name' });
    });
  });

  describe('createIndex', () => {
    it('should record createIndex operation', async () => {
      const recorder = new OperationRecorder();

      await recorder.createIndex('users', ['email']);

      const ops = recorder.getOperations();
      expect(ops.length).toBe(1);
      expect(ops[0].type).toBe('createIndex');
      expect(ops[0]).toMatchObject({ index: { entries: [{ column: 'email' }] } });
    });

    it('should auto-generate index name', async () => {
      const recorder = new OperationRecorder();

      await recorder.createIndex('users', ['email', 'status']);

      const ops = recorder.getOperations();
      expect(ops[0]).toMatchObject({ index: { name: 'users__email_status_idx' } });
    });

    it('should use custom index name', async () => {
      const recorder = new OperationRecorder();

      await recorder.createIndex('users', ['email'], { name: 'custom_idx' });

      const ops = recorder.getOperations();
      expect(ops[0]).toMatchObject({ index: { name: 'custom_idx' } });
    });

    it('should support unique option', async () => {
      const recorder = new OperationRecorder();

      await recorder.createIndex('users', ['email'], { unique: true });

      const ops = recorder.getOperations();
      expect(ops[0]).toMatchObject({ index: { unique: true } });
    });
  });

  describe('dropIndex', () => {
    it('should record dropIndex operation', async () => {
      const recorder = new OperationRecorder();

      await recorder.dropIndex('users', 'users__email_idx');

      const ops = recorder.getOperations();
      expect(ops.length).toBe(1);
      expect(ops[0].type).toBe('dropIndex');
      expect(ops[0]).toMatchObject({ indexName: 'users__email_idx' });
    });
  });

  describe('addForeignKey', () => {
    it('should record addForeignKey operation', async () => {
      const recorder = new OperationRecorder();

      await recorder.addForeignKey('posts', ['authorId'], { table: 'users', columns: ['id'] });

      const ops = recorder.getOperations();
      expect(ops.length).toBe(1);
      expect(ops[0].type).toBe('addForeignKey');
      expect(ops[0]).toMatchObject({ foreignKey: { columns: ['authorId'] } });
      expect(ops[0]).toMatchObject({ foreignKey: { references: { table: 'users' } } });
    });

    it('should support onDelete option', async () => {
      const recorder = new OperationRecorder();

      await recorder.addForeignKey('posts', ['authorId'], { table: 'users', columns: ['id'] }, { onDelete: 'CASCADE' });

      const ops = recorder.getOperations();
      expect(ops[0]).toMatchObject({ foreignKey: { onDelete: 'CASCADE' } });
    });
  });

  describe('dropForeignKey', () => {
    it('should record dropForeignKey operation', async () => {
      const recorder = new OperationRecorder();

      await recorder.dropForeignKey('posts', 'posts_author_fk');

      const ops = recorder.getOperations();
      expect(ops.length).toBe(1);
      expect(ops[0].type).toBe('dropForeignKey');
      expect(ops[0]).toMatchObject({ constraintName: 'posts_author_fk' });
    });
  });

  describe('raw', () => {
    it('should record raw SQL operation', async () => {
      const recorder = new OperationRecorder();

      await recorder.raw('ALTER TABLE users ADD CONSTRAINT custom CHECK (age > 0)');

      const ops = recorder.getOperations();
      expect(ops.length).toBe(1);
      expect(ops[0].type).toBe('raw');
      expect(ops[0]).toMatchObject({ sql: 'ALTER TABLE users ADD CONSTRAINT custom CHECK (age > 0)' });
    });
  });

  describe('multiple operations', () => {
    it('should record multiple operations in order', async () => {
      const recorder = new OperationRecorder();

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

      const ops = recorder.getOperations();
      expect(ops.length).toBe(3);
      expect(ops[0].type).toBe('createTable');
      expect(ops[1].type).toBe('createTable');
      expect(ops[2].type).toBe('createIndex');
    });
  });

  describe('getOperations', () => {
    it('should return a copy of operations', async () => {
      const recorder = new OperationRecorder();

      await recorder.createTable('users', (table) => {
        table.id();
      });

      const ops1 = recorder.getOperations();
      const ops2 = recorder.getOperations();

      expect(ops1).not.toBe(ops2);
      expect(ops1).toEqual(ops2);
    });
  });

  describe('alterTable', () => {
    it('should record alterTable operation with nested column changes', async () => {
      const recorder = new OperationRecorder();

      await recorder.alterTable('users', (table) => {
        table.addColumn((c) => c.string('email', { unique: true }));
        table.dropColumn('old_field');
        table.renameColumn('old_name', 'new_name');
        table.alterColumn((c) => c.string('email', { nullable: true }));
      });

      const ops = recorder.getOperations();
      expect(ops.map((o) => o.type)).toEqual(['addColumn', 'dropColumn', 'renameColumn', 'alterColumn']);
      expect(ops[3]).toMatchObject({ columnName: 'email' });
    });
  });

  describe('alterColumn', () => {
    it('should record alterColumn operation', async () => {
      const recorder = new OperationRecorder();

      await recorder.alterColumn('users', (c) => c.string('email', { nullable: true }));

      const ops = recorder.getOperations();
      expect(ops.length).toBe(1);
      expect(ops[0].type).toBe('alterColumn');
    });
  });

  describe('alterTable operations', () => {
    it('should record addIndex, dropIndex, addForeignKey, dropForeignKey', async () => {
      const recorder = new OperationRecorder();

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

      const ops = recorder.getOperations();
      expect(ops.map((o) => o.type)).toEqual(['createIndex', 'dropIndex', 'addForeignKey', 'dropForeignKey']);

      expect(ops[0]).toMatchObject({ index: { name: 'custom_idx', unique: true } });
      expect(ops[2]).toMatchObject({
        foreignKey: { references: { table: 'profiles' }, onDelete: 'CASCADE', name: 'users_profile_fk' },
      });
    });
  });

  describe('default values', () => {
    it('should use default names and actions if not provided', async () => {
      const recorder = new OperationRecorder();
      await recorder.alterTable('users', (table) => {
        table.addIndex(['name']);
        table.addForeignKey(['role_id'], { table: 'roles', columns: ['id'] });
      });

      expect(recorder.getOperations()).toMatchObject([
        { type: 'createIndex', index: { name: 'users__name_idx', unique: false } },
        { type: 'addForeignKey', foreignKey: { onDelete: 'NO ACTION', onUpdate: 'NO ACTION' } },
      ]);
    });
  });
});

describe('MigrationBuilder', () => {
  const createMockQuerier = () => ({
    run: vi.fn().mockResolvedValue({}),
    dialect: new PostgresDialect(),
  });

  const builderOn = (querier: ReturnType<typeof createMockQuerier>) =>
    new MigrationBuilder(new SqlSchemaGenerator(querier.dialect), (sql) => querier.run(sql));

  describe('execution', () => {
    it('should generate SQL and run it', async () => {
      const mockQuerier = createMockQuerier();
      const builder = builderOn(mockQuerier);

      await builder.createTable('users', (table) => {
        table.id();
      });

      expect(mockQuerier.run).toHaveBeenCalled();
      const calledSql = mockQuerier.run.mock.calls[0][0];
      expect(calledSql).toContain('CREATE TABLE "users"');
      expect(builder.getOperations().length).toBe(1);
    });
  });

  describe('alterTable execution', () => {
    /** Every nested change has run by the time `alterTable` resolves, in the order it was declared. */
    it('should record and run each nested column change', async () => {
      const mockQuerier = createMockQuerier();
      const builder = builderOn(mockQuerier);

      await builder.alterTable('users', (table) => {
        table.addColumn((c) => c.string('nickname', { nullable: true }));
        table.dropColumn('legacy');
      });

      expect(builder.getOperations().map((op) => op.type)).toEqual(['addColumn', 'dropColumn']);
      expect(mockQuerier.run).toHaveBeenCalledTimes(2);
      expect(mockQuerier.run.mock.calls.map(([sql]) => sql)).toEqual([
        'ALTER TABLE "users" ADD COLUMN "nickname" VARCHAR(255);',
        'ALTER TABLE "users" DROP COLUMN "legacy";',
      ]);
    });
  });

  describe('raw execution', () => {
    it('should run raw SQL', async () => {
      const mockQuerier = createMockQuerier();
      const builder = builderOn(mockQuerier);

      await builder.raw('SELECT 1');

      expect(mockQuerier.run).toHaveBeenCalledWith('SELECT 1');
    });
  });

  describe('all operations with execution', () => {
    it('should generate SQL for all operations', async () => {
      const mockQuerier = createMockQuerier();
      const builder = builderOn(mockQuerier);

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

      // Each operation should have called querier.run
      expect(mockQuerier.run).toHaveBeenCalledTimes(13);
    });
  });
});
