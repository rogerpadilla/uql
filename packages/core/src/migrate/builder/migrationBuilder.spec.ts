import { describe, expect, it } from 'vitest';
import { SqlSchemaGenerator } from '../schemaGenerator.js';
import { createDryRunBuilder, MigrationBuilder } from './migrationBuilder.js';
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

describe('MigrationBuilder', () => {
  describe('createTable', () => {
    it('should record createTable operation', async () => {
      const builder = createDryRunBuilder();

      await builder.createTable('users', (table) => {
        table.id();
        table.string('email', { unique: true });
      });

      const ops = builder.getOperations();
      expect(ops.length).toBe(1);
      expect(ops[0].type).toBe('createTable');

      const createOp = ops[0] as CreateTableOperation;
      expect(createOp.table.name).toBe('users');
      expect(createOp.table.columns.length).toBe(2);
    });
  });

  describe('dropTable', () => {
    it('should record dropTable operation', async () => {
      const builder = createDryRunBuilder();

      await builder.dropTable('users');

      const ops = builder.getOperations();
      expect(ops.length).toBe(1);
      expect(ops[0].type).toBe('dropTable');
      expect((ops[0] as DropTableOperation).tableName).toBe('users');
    });

    it('should support ifExists option', async () => {
      const builder = createDryRunBuilder();

      await builder.dropTable('users', { ifExists: true });

      const ops = builder.getOperations();
      expect((ops[0] as DropTableOperation).ifExists).toBe(true);
    });

    it('should support cascade option', async () => {
      const builder = createDryRunBuilder();

      await builder.dropTable('users', { cascade: true });

      const ops = builder.getOperations();
      expect((ops[0] as DropTableOperation).cascade).toBe(true);
    });
  });

  describe('renameTable', () => {
    it('should record renameTable operation', async () => {
      const builder = createDryRunBuilder();

      await builder.renameTable('old_users', 'users');

      const ops = builder.getOperations();
      expect(ops.length).toBe(1);
      expect(ops[0].type).toBe('renameTable');
      expect((ops[0] as RenameTableOperation).oldName).toBe('old_users');
      expect((ops[0] as RenameTableOperation).newName).toBe('users');
    });
  });

  describe('addColumn', () => {
    it('should record addColumn operation', async () => {
      const builder = createDryRunBuilder();

      await builder.addColumn('users', 'age', (col) => {
        col.nullable(false);
      });

      const ops = builder.getOperations();
      expect(ops.length).toBe(1);
      expect(ops[0].type).toBe('addColumn');
      expect((ops[0] as AddColumnOperation).tableName).toBe('users');
      expect((ops[0] as AddColumnOperation).column.name).toBe('age');
    });
  });

  describe('dropColumn', () => {
    it('should record dropColumn operation', async () => {
      const builder = createDryRunBuilder();

      await builder.dropColumn('users', 'age');

      const ops = builder.getOperations();
      expect(ops.length).toBe(1);
      expect(ops[0].type).toBe('dropColumn');
      expect((ops[0] as DropColumnOperation).tableName).toBe('users');
      expect((ops[0] as DropColumnOperation).columnName).toBe('age');
    });
  });

  describe('renameColumn', () => {
    it('should record renameColumn operation', async () => {
      const builder = createDryRunBuilder();

      await builder.renameColumn('users', 'old_name', 'new_name');

      const ops = builder.getOperations();
      expect(ops.length).toBe(1);
      expect(ops[0].type).toBe('renameColumn');
      expect((ops[0] as RenameColumnOperation).oldName).toBe('old_name');
      expect((ops[0] as RenameColumnOperation).newName).toBe('new_name');
    });
  });

  describe('createIndex', () => {
    it('should record createIndex operation', async () => {
      const builder = createDryRunBuilder();

      await builder.createIndex('users', ['email']);

      const ops = builder.getOperations();
      expect(ops.length).toBe(1);
      expect(ops[0].type).toBe('createIndex');
      expect((ops[0] as CreateIndexOperation).index.columns).toEqual(['email']);
    });

    it('should auto-generate index name', async () => {
      const builder = createDryRunBuilder();

      await builder.createIndex('users', ['email', 'status']);

      const ops = builder.getOperations();
      expect((ops[0] as CreateIndexOperation).index.name).toBe('idx_users_email_status');
    });

    it('should use custom index name', async () => {
      const builder = createDryRunBuilder();

      await builder.createIndex('users', ['email'], { name: 'custom_idx' });

      const ops = builder.getOperations();
      expect((ops[0] as CreateIndexOperation).index.name).toBe('custom_idx');
    });

    it('should support unique option', async () => {
      const builder = createDryRunBuilder();

      await builder.createIndex('users', ['email'], { unique: true });

      const ops = builder.getOperations();
      expect((ops[0] as CreateIndexOperation).index.unique).toBe(true);
    });
  });

  describe('dropIndex', () => {
    it('should record dropIndex operation', async () => {
      const builder = createDryRunBuilder();

      await builder.dropIndex('users', 'idx_users_email');

      const ops = builder.getOperations();
      expect(ops.length).toBe(1);
      expect(ops[0].type).toBe('dropIndex');
      expect((ops[0] as DropIndexOperation).indexName).toBe('idx_users_email');
    });
  });

  describe('addForeignKey', () => {
    it('should record addForeignKey operation', async () => {
      const builder = createDryRunBuilder();

      await builder.addForeignKey('posts', ['authorId'], { table: 'users', columns: ['id'] });

      const ops = builder.getOperations();
      expect(ops.length).toBe(1);
      expect(ops[0].type).toBe('addForeignKey');
      expect((ops[0] as AddForeignKeyOperation).foreignKey.columns).toEqual(['authorId']);
      expect((ops[0] as AddForeignKeyOperation).foreignKey.referencesTable).toBe('users');
    });

    it('should support onDelete option', async () => {
      const builder = createDryRunBuilder();

      await builder.addForeignKey('posts', ['authorId'], { table: 'users', columns: ['id'] }, { onDelete: 'CASCADE' });

      const ops = builder.getOperations();
      expect((ops[0] as AddForeignKeyOperation).foreignKey.onDelete).toBe('CASCADE');
    });
  });

  describe('dropForeignKey', () => {
    it('should record dropForeignKey operation', async () => {
      const builder = createDryRunBuilder();

      await builder.dropForeignKey('posts', 'fk_posts_author');

      const ops = builder.getOperations();
      expect(ops.length).toBe(1);
      expect(ops[0].type).toBe('dropForeignKey');
      expect((ops[0] as DropForeignKeyOperation).constraintName).toBe('fk_posts_author');
    });
  });

  describe('raw', () => {
    it('should record raw SQL operation', async () => {
      const builder = createDryRunBuilder();

      await builder.raw('ALTER TABLE users ADD CONSTRAINT custom CHECK (age > 0)');

      const ops = builder.getOperations();
      expect(ops.length).toBe(1);
      expect(ops[0].type).toBe('raw');
      expect((ops[0] as RawSqlOperation).sql).toBe('ALTER TABLE users ADD CONSTRAINT custom CHECK (age > 0)');
    });
  });

  describe('multiple operations', () => {
    it('should record multiple operations in order', async () => {
      const builder = createDryRunBuilder();

      await builder.createTable('users', (table) => {
        table.id();
        table.string('email');
      });

      await builder.createTable('posts', (table) => {
        table.id();
        table.string('title');
        table.integer('authorId').references('users', 'id');
      });

      await builder.createIndex('users', ['email'], { unique: true });

      const ops = builder.getOperations();
      expect(ops.length).toBe(3);
      expect(ops[0].type).toBe('createTable');
      expect(ops[1].type).toBe('createTable');
      expect(ops[2].type).toBe('createIndex');
    });
  });

  describe('getOperations', () => {
    it('should return a copy of operations', async () => {
      const builder = createDryRunBuilder();

      await builder.createTable('users', (table) => {
        table.id();
      });

      const ops1 = builder.getOperations();
      const ops2 = builder.getOperations();

      expect(ops1).not.toBe(ops2);
      expect(ops1).toEqual(ops2);
    });
  });

  describe('alterTable', () => {
    it('should record alterTable operation with nested column changes', async () => {
      const builder = createDryRunBuilder();

      await builder.alterTable('users', (table) => {
        table.addColumn('email', (col) => col.unique());
        table.dropColumn('old_field');
        table.renameColumn('old_name', 'new_name');
        table.alterColumn('email', (col) => col.nullable(true));
      });

      const ops = builder.getOperations();
      expect(ops.map((o) => o.type)).toEqual(['addColumn', 'dropColumn', 'renameColumn', 'alterColumn']);
      expect((ops[3] as AlterColumnOperation).columnName).toBe('email');
    });
  });

  describe('alterColumn', () => {
    it('should record alterColumn operation', async () => {
      const builder = createDryRunBuilder();

      await builder.alterColumn('users', 'email', (col) => col.nullable(true));

      const ops = builder.getOperations();
      expect(ops.length).toBe(1);
      expect(ops[0].type).toBe('alterColumn');
    });
  });

  describe('alterTable operations', () => {
    it('should record addIndex, dropIndex, addForeignKey, dropForeignKey', async () => {
      const builder = createDryRunBuilder();

      await builder.alterTable('users', (table) => {
        table.addIndex(['email'], { unique: true, name: 'custom_idx' });
        table.dropIndex('custom_idx');
        table.addForeignKey(
          ['profile_id'],
          { table: 'profiles', columns: ['id'] },
          { onDelete: 'CASCADE', name: 'fk_users_profile' },
        );
        table.dropForeignKey('fk_users_profile');
      });

      const ops = builder.getOperations();
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

  describe('execution', () => {
    it('should generate SQL and run it when not in dry-run', async () => {
      let ranSql = '';
      const mockQuerier = {
        run: async (sql: string) => {
          ranSql = sql;
        },
      } as any;
      const generator = new SqlSchemaGenerator('postgres');

      const builder = new MigrationBuilder(mockQuerier, generator);

      await builder.createTable('users', (table) => {
        table.id();
      });

      expect(ranSql).toContain('CREATE TABLE "users"');
      expect(builder.getOperations().length).toBe(1);
    });
  });

  describe('raw execution', () => {
    it('should run raw SQL when not in dry-run', async () => {
      let ranSql = '';
      const mockQuerier = {
        run: async (sql: string) => {
          ranSql = sql;
        },
      } as any;

      const builder = new MigrationBuilder(mockQuerier);

      await builder.raw('SELECT 1');

      expect(ranSql).toBe('SELECT 1');
    });
  });

  describe('all operations with execution', () => {
    it('should generate SQL for all operations', async () => {
      const mockQuerier = { run: async () => {} } as any;
      const opsCalled: string[] = [];
      const mockGenerator = {
        generateCreateTableFromDefinition: () => {
          opsCalled.push('createTable');
          return '';
        },
        generateDropTableSql: () => {
          opsCalled.push('dropTable');
          return '';
        },
        generateRenameTableSql: () => {
          opsCalled.push('renameTable');
          return '';
        },
        generateAddColumnSql: () => {
          opsCalled.push('addColumn');
          return '';
        },
        generateDropColumnSql: () => {
          opsCalled.push('dropColumn');
          return '';
        },
        generateRenameColumnSql: () => {
          opsCalled.push('renameColumn');
          return '';
        },
        generateAlterColumnSql: () => {
          opsCalled.push('alterColumn');
          return '';
        },
        generateCreateIndexSql: () => {
          opsCalled.push('createIndex');
          return '';
        },
        generateDropIndexSql: () => {
          opsCalled.push('dropIndex');
          return '';
        },
        generateAddForeignKeySql: () => {
          opsCalled.push('addForeignKey');
          return '';
        },
        generateDropForeignKeySql: () => {
          opsCalled.push('dropForeignKey');
          return '';
        },
      } as any;

      const builder = new MigrationBuilder(mockQuerier, mockGenerator);

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

      expect(opsCalled).toEqual([
        'createTable',
        'dropTable',
        'renameTable',
        'addColumn',
        'dropColumn',
        'renameColumn',
        'alterColumn',
        'createIndex',
        'dropIndex',
        'addForeignKey',
        'dropForeignKey',
      ]);
    });
  });

  describe('operationToSql', () => {
    it('should handle raw operation', () => {
      const builder = new MigrationBuilder(undefined, {} as any);
      const res = (builder as any).operationToSql({
        type: 'raw',
        sql: 'SELECT 1',
      });
      expect(res).toBe('SELECT 1');
    });

    it('should return undefined for unknown operation type', () => {
      const builder = new MigrationBuilder(undefined, {} as any);
      const res = (builder as any).operationToSql({ type: 'unknown' });
      expect(res).toBeUndefined();
    });

    it('should return undefined if no generator', () => {
      const builder = new MigrationBuilder();
      const res = (builder as any).operationToSql({
        type: 'dropTable',
        tableName: 't',
      });
      expect(res).toBeUndefined();
    });

    it('should use default names and actions if not provided', async () => {
      const builder = new MigrationBuilder();
      await builder.alterTable('users', (table) => {
        table.addIndex(['name']);
        table.addForeignKey(['role_id'], { table: 'roles', columns: ['id'] });
      });

      const ops = builder.getOperations();
      const idxOp = ops.find((o) => o.type === 'createIndex') as CreateIndexOperation;
      const fkOp = ops.find((o) => o.type === 'addForeignKey') as AddForeignKeyOperation;

      expect(idxOp.index.name).toBe('idx_users_name');
      expect(idxOp.index.unique).toBe(false);
      expect(fkOp.foreignKey.onDelete).toBe('NO ACTION');
      expect(fkOp.foreignKey.onUpdate).toBe('NO ACTION');
    });
  });
});
