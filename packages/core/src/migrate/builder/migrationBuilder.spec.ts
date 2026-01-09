import { describe, expect, it, vi } from 'vitest';
import { createDryRunBuilder, MigrationBuilder, OperationRecorder } from './migrationBuilder.js';
import type {
  AddColumnOperation,
  AddForeignKeyOperation,
  AlterColumnOperation,
  CreateIndexOperation,
  CreateTableOperation,
  DropColumnOperation,
  DropForeignKeyOperation,
  DropIndexOperation,
  DropTableOperation,
  RawSqlOperation,
  RenameColumnOperation,
  RenameTableOperation,
} from './types.js';

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

      const createOp = ops[0] as CreateTableOperation;
      expect(createOp.table.name).toBe('users');
      expect(createOp.table.columns.length).toBe(2);
    });
  });

  describe('dropTable', () => {
    it('should record dropTable operation', async () => {
      const recorder = createDryRunBuilder();

      await recorder.dropTable('users');

      const ops = recorder.getOperations();
      expect(ops.length).toBe(1);
      expect(ops[0].type).toBe('dropTable');
      expect((ops[0] as DropTableOperation).tableName).toBe('users');
    });

    it('should support ifExists option', async () => {
      const recorder = createDryRunBuilder();

      await recorder.dropTable('users', { ifExists: true });

      const ops = recorder.getOperations();
      expect((ops[0] as DropTableOperation).ifExists).toBe(true);
    });

    it('should support cascade option', async () => {
      const recorder = createDryRunBuilder();

      await recorder.dropTable('users', { cascade: true });

      const ops = recorder.getOperations();
      expect((ops[0] as DropTableOperation).cascade).toBe(true);
    });
  });

  describe('renameTable', () => {
    it('should record renameTable operation', async () => {
      const recorder = createDryRunBuilder();

      await recorder.renameTable('old_users', 'users');

      const ops = recorder.getOperations();
      expect(ops.length).toBe(1);
      expect(ops[0].type).toBe('renameTable');
      expect((ops[0] as RenameTableOperation).oldName).toBe('old_users');
      expect((ops[0] as RenameTableOperation).newName).toBe('users');
    });
  });

  describe('addColumn', () => {
    it('should record addColumn operation', async () => {
      const recorder = createDryRunBuilder();

      await recorder.addColumn('users', 'age', (col) => {
        col.nullable(false);
      });

      const ops = recorder.getOperations();
      expect(ops.length).toBe(1);
      expect(ops[0].type).toBe('addColumn');
      expect((ops[0] as AddColumnOperation).tableName).toBe('users');
      expect((ops[0] as AddColumnOperation).column.name).toBe('age');
    });
  });

  describe('dropColumn', () => {
    it('should record dropColumn operation', async () => {
      const recorder = createDryRunBuilder();

      await recorder.dropColumn('users', 'age');

      const ops = recorder.getOperations();
      expect(ops.length).toBe(1);
      expect(ops[0].type).toBe('dropColumn');
      expect((ops[0] as DropColumnOperation).tableName).toBe('users');
      expect((ops[0] as DropColumnOperation).columnName).toBe('age');
    });
  });

  describe('renameColumn', () => {
    it('should record renameColumn operation', async () => {
      const recorder = createDryRunBuilder();

      await recorder.renameColumn('users', 'old_name', 'new_name');

      const ops = recorder.getOperations();
      expect(ops.length).toBe(1);
      expect(ops[0].type).toBe('renameColumn');
      expect((ops[0] as RenameColumnOperation).oldName).toBe('old_name');
      expect((ops[0] as RenameColumnOperation).newName).toBe('new_name');
    });
  });

  describe('createIndex', () => {
    it('should record createIndex operation', async () => {
      const recorder = createDryRunBuilder();

      await recorder.createIndex('users', ['email']);

      const ops = recorder.getOperations();
      expect(ops.length).toBe(1);
      expect(ops[0].type).toBe('createIndex');
      expect((ops[0] as CreateIndexOperation).index.columns).toEqual(['email']);
    });

    it('should auto-generate index name', async () => {
      const recorder = createDryRunBuilder();

      await recorder.createIndex('users', ['email', 'status']);

      const ops = recorder.getOperations();
      expect((ops[0] as CreateIndexOperation).index.name).toBe('idx_users_email_status');
    });

    it('should use custom index name', async () => {
      const recorder = createDryRunBuilder();

      await recorder.createIndex('users', ['email'], { name: 'custom_idx' });

      const ops = recorder.getOperations();
      expect((ops[0] as CreateIndexOperation).index.name).toBe('custom_idx');
    });

    it('should support unique option', async () => {
      const recorder = createDryRunBuilder();

      await recorder.createIndex('users', ['email'], { unique: true });

      const ops = recorder.getOperations();
      expect((ops[0] as CreateIndexOperation).index.unique).toBe(true);
    });
  });

  describe('dropIndex', () => {
    it('should record dropIndex operation', async () => {
      const recorder = createDryRunBuilder();

      await recorder.dropIndex('users', 'idx_users_email');

      const ops = recorder.getOperations();
      expect(ops.length).toBe(1);
      expect(ops[0].type).toBe('dropIndex');
      expect((ops[0] as DropIndexOperation).indexName).toBe('idx_users_email');
    });
  });

  describe('addForeignKey', () => {
    it('should record addForeignKey operation', async () => {
      const recorder = createDryRunBuilder();

      await recorder.addForeignKey('posts', ['authorId'], { table: 'users', columns: ['id'] });

      const ops = recorder.getOperations();
      expect(ops.length).toBe(1);
      expect(ops[0].type).toBe('addForeignKey');
      expect((ops[0] as AddForeignKeyOperation).foreignKey.columns).toEqual(['authorId']);
      expect((ops[0] as AddForeignKeyOperation).foreignKey.referencesTable).toBe('users');
    });

    it('should support onDelete option', async () => {
      const recorder = createDryRunBuilder();

      await recorder.addForeignKey('posts', ['authorId'], { table: 'users', columns: ['id'] }, { onDelete: 'CASCADE' });

      const ops = recorder.getOperations();
      expect((ops[0] as AddForeignKeyOperation).foreignKey.onDelete).toBe('CASCADE');
    });
  });

  describe('dropForeignKey', () => {
    it('should record dropForeignKey operation', async () => {
      const recorder = createDryRunBuilder();

      await recorder.dropForeignKey('posts', 'fk_posts_author');

      const ops = recorder.getOperations();
      expect(ops.length).toBe(1);
      expect(ops[0].type).toBe('dropForeignKey');
      expect((ops[0] as DropForeignKeyOperation).constraintName).toBe('fk_posts_author');
    });
  });

  describe('raw', () => {
    it('should record raw SQL operation', async () => {
      const recorder = createDryRunBuilder();

      await recorder.raw('ALTER TABLE users ADD CONSTRAINT custom CHECK (age > 0)');

      const ops = recorder.getOperations();
      expect(ops.length).toBe(1);
      expect(ops[0].type).toBe('raw');
      expect((ops[0] as RawSqlOperation).sql).toBe('ALTER TABLE users ADD CONSTRAINT custom CHECK (age > 0)');
    });
  });

  describe('multiple operations', () => {
    it('should record multiple operations in order', async () => {
      const recorder = createDryRunBuilder();

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
      const recorder = createDryRunBuilder();

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
      const recorder = createDryRunBuilder();

      await recorder.alterTable('users', (table) => {
        table.addColumn('email', (col) => col.unique());
        table.dropColumn('old_field');
        table.renameColumn('old_name', 'new_name');
        table.alterColumn('email', (col) => col.nullable(true));
      });

      const ops = recorder.getOperations();
      expect(ops.map((o) => o.type)).toEqual(['addColumn', 'dropColumn', 'renameColumn', 'alterColumn']);
      expect((ops[3] as AlterColumnOperation).columnName).toBe('email');
    });
  });

  describe('alterColumn', () => {
    it('should record alterColumn operation', async () => {
      const recorder = createDryRunBuilder();

      await recorder.alterColumn('users', 'email', (col) => col.nullable(true));

      const ops = recorder.getOperations();
      expect(ops.length).toBe(1);
      expect(ops[0].type).toBe('alterColumn');
    });
  });

  describe('alterTable operations', () => {
    it('should record addIndex, dropIndex, addForeignKey, dropForeignKey', async () => {
      const recorder = createDryRunBuilder();

      await recorder.alterTable('users', (table) => {
        table.addIndex(['email'], { unique: true, name: 'custom_idx' });
        table.dropIndex('custom_idx');
        table.addForeignKey(
          ['profile_id'],
          { table: 'profiles', columns: ['id'] },
          { onDelete: 'CASCADE', name: 'fk_users_profile' },
        );
        table.dropForeignKey('fk_users_profile');
      });

      const ops = recorder.getOperations();
      expect(ops.map((o) => o.type)).toEqual(['createIndex', 'dropIndex', 'addForeignKey', 'dropForeignKey']);

      const createIndexOp = ops[0] as CreateIndexOperation;
      expect(createIndexOp.index.name).toBe('custom_idx');
      expect(createIndexOp.index.unique).toBe(true);

      const addFkOp = ops[2] as AddForeignKeyOperation;
      expect(addFkOp.foreignKey.referencesTable).toBe('profiles');
      expect(addFkOp.foreignKey.onDelete).toBe('CASCADE');
      expect(addFkOp.foreignKey.name).toBe('fk_users_profile');
    });
  });

  describe('default values', () => {
    it('should use default names and actions if not provided', async () => {
      const recorder = new OperationRecorder();
      await recorder.alterTable('users', (table) => {
        table.addIndex(['name']);
        table.addForeignKey(['role_id'], { table: 'roles', columns: ['id'] });
      });

      const ops = recorder.getOperations();
      const idxOp = ops.find((o) => o.type === 'createIndex') as CreateIndexOperation;
      const fkOp = ops.find((o) => o.type === 'addForeignKey') as AddForeignKeyOperation;

      expect(idxOp.index.name).toBe('idx_users_name');
      expect(idxOp.index.unique).toBe(false);
      expect(fkOp.foreignKey.onDelete).toBe('NO ACTION');
      expect(fkOp.foreignKey.onUpdate).toBe('NO ACTION');
    });
  });
});

describe('MigrationBuilder', () => {
  const createMockQuerier = () => ({
    run: vi.fn().mockResolvedValue({}),
    dialect: { dialect: 'postgres' as const, escapeIdChar: '"' as const, placeholder: () => '?' },
  });

  describe('execution', () => {
    it('should generate SQL and run it', async () => {
      const mockQuerier = createMockQuerier();
      const builder = new MigrationBuilder(mockQuerier as any);

      await builder.createTable('users', (table) => {
        table.id();
      });

      expect(mockQuerier.run).toHaveBeenCalled();
      const calledSql = mockQuerier.run.mock.calls[0][0];
      expect(calledSql).toContain('CREATE TABLE "users"');
      expect(builder.getOperations().length).toBe(1);
    });
  });

  describe('raw execution', () => {
    it('should run raw SQL', async () => {
      const mockQuerier = createMockQuerier();
      const builder = new MigrationBuilder(mockQuerier as any);

      await builder.raw('SELECT 1');

      expect(mockQuerier.run).toHaveBeenCalledWith('SELECT 1');
    });
  });

  describe('all operations with execution', () => {
    it('should generate SQL for all operations', async () => {
      const mockQuerier = createMockQuerier();
      const builder = new MigrationBuilder(mockQuerier as any);

      await builder.createTable('t', (t) => t.id());
      await builder.dropTable('t');
      await builder.renameTable('t', 't2');
      await builder.addColumn('t', 'c', (c) => c.nullable());
      await builder.dropColumn('t', 'c');
      await builder.renameColumn('t', 'c', 'c2');
      await builder.alterColumn('t', 'c', (c) => c.nullable(true));
      await builder.createIndex('t', ['c']);
      await builder.dropIndex('t', 'i');
      await builder.addForeignKey('t', ['c'], { table: 't2', columns: ['id'] });
      await builder.dropForeignKey('t', 'f');

      // Each operation should have called querier.run
      expect(mockQuerier.run).toHaveBeenCalledTimes(11);
    });
  });
});
