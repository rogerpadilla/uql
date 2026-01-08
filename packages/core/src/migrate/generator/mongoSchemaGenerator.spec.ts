import { describe, expect, it } from 'vitest';
import { Entity, Field, Id } from '../../entity/index.js';
import type { TableNode } from '../../schema/types.js';
import { MongoSchemaGenerator } from './mongoSchemaGenerator.js';

@Entity()
class MongoUser {
  @Id() id?: string;
  @Field({ index: true }) username?: string;
  @Field({ index: 'idx_email', unique: true }) email?: string;
}

describe('MongoSchemaGenerator', () => {
  const generator = new MongoSchemaGenerator();

  it('should generate createCollection statement', () => {
    const json = generator.generateCreateTable(MongoUser);
    const cmd = JSON.parse(json);

    expect(cmd).toMatchObject({
      action: 'createCollection',
      name: 'MongoUser',
    });
    expect(cmd.indexes).toHaveLength(2);
    expect(cmd.indexes).toContainEqual({
      name: 'idx_MongoUser_username',
      columns: ['username'],
      unique: false,
    });
    expect(cmd.indexes).toContainEqual({
      name: 'idx_email',
      columns: ['email'],
      unique: true,
    });
  });

  it('should generate dropCollection statement', () => {
    const json = generator.generateDropTable(MongoUser);
    const cmd = JSON.parse(json);

    expect(cmd).toMatchObject({
      action: 'dropCollection',
      name: 'MongoUser',
    });
  });

  it('should generate createIndex statement', () => {
    const json = generator.generateCreateIndex('MongoUser', {
      name: 'idx_test',
      columns: ['test'],
      unique: true,
    });
    const cmd = JSON.parse(json);

    expect(cmd).toMatchObject({
      action: 'createIndex',
      collection: 'MongoUser',
      name: 'idx_test',
      key: { test: 1 },
      options: { unique: true, name: 'idx_test' },
    });
  });

  it('should generate dropIndex statement', () => {
    const json = generator.generateDropIndex('MongoUser', 'idx_test');
    const cmd = JSON.parse(json);

    expect(cmd).toMatchObject({
      action: 'dropIndex',
      collection: 'MongoUser',
      name: 'idx_test',
    });
  });

  it('diffSchema should return create if currentSchema is undefined', () => {
    const diff = generator.diffSchema(MongoUser, undefined);
    expect(diff).toMatchObject({
      tableName: 'MongoUser',
      type: 'create',
    });
  });

  it('diffSchema should return alter if indexes are missing', () => {
    const currentSchema: TableNode = {
      name: 'MongoUser',
      columns: new Map(),
      indexes: [{ name: 'idx_MongoUser_username', table: {} as any, columns: [], unique: false }],
      schema: undefined as any,
      incomingRelations: [],
      outgoingRelations: [],
      primaryKey: [],
    };

    const diff = generator.diffSchema(MongoUser, currentSchema);
    expect(diff).toMatchObject({
      tableName: 'MongoUser',
      type: 'alter',
    });
    expect(diff).toBeDefined();
    expect(diff.indexesToAdd).toHaveLength(1);
    expect(diff.indexesToAdd[0].name).toBe('idx_email');
  });

  it('diffSchema should return undefined if in sync', () => {
    const currentSchema: TableNode = {
      name: 'MongoUser',
      columns: new Map(),
      indexes: [
        { name: 'idx_MongoUser_username', table: {} as any, columns: [], unique: false },
        { name: 'idx_email', table: {} as any, columns: [], unique: true },
      ],
      schema: undefined as any,
      incomingRelations: [],
      outgoingRelations: [],
      primaryKey: [],
    };

    const diff = generator.diffSchema(MongoUser, currentSchema);
    expect(diff).toBeUndefined();
  });

  it('should generate alter statements', () => {
    const diff = {
      tableName: 'MongoUser',
      type: 'alter' as const,
      indexesToAdd: [{ name: 'idx_test', columns: ['test'], unique: false }],
    };
    const statements = generator.generateAlterTable(diff);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain('"action":"createIndex"');
  });

  it('should generate alter down statements', () => {
    const diff = {
      tableName: 'MongoUser',
      type: 'alter' as const,
      indexesToAdd: [{ name: 'idx_test', columns: ['test'], unique: false }],
    };
    const statements = generator.generateAlterTableDown(diff);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain('"action":"dropIndex"');
  });

  it('should return empty string for getSqlType', () => {
    expect(generator.getSqlType({})).toBe('');
  });

  it('should cover no-op / empty return methods', () => {
    expect(generator.getBooleanType()).toBe('');
    expect(generator.generateColumnDefinitions()).toEqual([]);
    expect(generator.generateColumnDefinition()).toBe('');
    expect(generator.generateColumnDefinitionFromSchema()).toBe('');
    expect(generator.generateTableConstraints()).toEqual([]);
    expect(generator.generateAlterColumnStatements()).toEqual([]);
    expect(generator.getTableOptions()).toBe('');
    expect(generator.generateColumnComment()).toBe('');
    expect(generator.formatDefaultValue()).toBe('');
    expect(generator.generateAddColumnSql()).toBe('');
    expect(generator.generateDropColumnSql()).toBe('');
    expect(generator.generateRenameColumnSql()).toBe('');
    expect(generator.generateAlterColumnSql()).toBe('');
    expect(generator.generateAddForeignKeySql()).toBe('');
    expect(generator.generateDropForeignKeySql()).toBe('');
  });

  describe('Node-based generation', () => {
    const tableNode: TableNode = {
      name: 'users',
      columns: new Map(),
      indexes: [],
      primaryKey: [],
      incomingRelations: [],
      outgoingRelations: [],
      schema: {} as any,
    };

    it('should generate createTable from node', () => {
      expect(JSON.parse(generator.generateCreateTableFromNode(tableNode))).toMatchObject({
        action: 'createCollection',
        name: 'users',
      });
    });

    it('should generate dropTable from node', () => {
      expect(JSON.parse(generator.generateDropTableFromNode(tableNode))).toMatchObject({
        action: 'dropCollection',
        name: 'users',
      });
    });

    it('should generate createIndex from node', () => {
      const indexNode: any = {
        name: 'idx_test',
        table: tableNode,
        columns: [{ name: 'col1' }],
        unique: true,
      };
      expect(JSON.parse(generator.generateCreateIndexFromNode(indexNode))).toMatchObject({
        action: 'createIndex',
        collection: 'users',
        name: 'idx_test',
        key: { col1: 1 },
        options: { unique: true, name: 'idx_test' },
      });
    });
  });

  describe('Definition-based generation', () => {
    it('should generate createTable from definition', () => {
      const def: any = { name: 'posts' };
      expect(JSON.parse(generator.generateCreateTableFromDefinition(def))).toMatchObject({
        action: 'createCollection',
        name: 'posts',
      });
    });

    it('should generate generic SQL methods', () => {
      expect(JSON.parse(generator.generateDropTableSql('users'))).toMatchObject({
        action: 'dropCollection',
        name: 'users',
      });

      expect(JSON.parse(generator.generateRenameTableSql('old', 'new'))).toMatchObject({
        action: 'renameCollection',
        from: 'old',
        to: 'new',
      });

      const idx: any = { name: 'idx', columns: ['c'], unique: true };
      expect(JSON.parse(generator.generateCreateIndexSql('users', idx))).toMatchObject({
        action: 'createIndex',
        collection: 'users',
        name: 'idx',
      });

      expect(JSON.parse(generator.generateDropIndexSql('users', 'idx'))).toMatchObject({
        action: 'dropIndex',
        collection: 'users',
        name: 'idx',
      });
    });
  });
});
