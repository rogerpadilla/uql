import { describe, expect, it } from 'vitest';
import { Entity, Field, Id } from '../../entity/index.js';
import type { IndexNode, TableNode } from '../../schema/types.js';
import type { IndexSchema } from '../../type/index.js';
import type { TableDefinition } from '../builder/types.js';
import { MongoSchemaGenerator } from './mongoSchemaGenerator.js';

@Entity()
class MongoUser {
  @Id({ type: String }) id?: string;
  @Field({ type: String, index: true }) username?: string;
  @Field({ type: String, index: 'email_idx', unique: true }) email?: string;
}

describe('MongoSchemaGenerator', () => {
  const generator = new MongoSchemaGenerator();

  /**
   * A collection plus one `createIndex` command per index, mirroring the SQL generator's
   * `[CREATE TABLE, ...CREATE INDEX]`. The key spec used to be re-derived in the migrator instead,
   * which is why a descending or text index could not be expressed at all.
   */
  it('should generate createCollection followed by a createIndex per index', () => {
    const statements = generator.generateCreateTable(MongoUser).map((json) => JSON.parse(json));

    expect(statements[0]).toMatchObject({ action: 'createCollection', name: 'MongoUser' });
    expect(statements.slice(1)).toEqual([
      {
        action: 'createIndex',
        collection: 'MongoUser',
        name: 'MongoUser__username_idx',
        key: { username: 1 },
        options: { name: 'MongoUser__username_idx', unique: false },
      },
      {
        action: 'createIndex',
        collection: 'MongoUser',
        name: 'email_idx',
        key: { email: 1 },
        options: { name: 'email_idx', unique: true },
      },
    ]);
  });

  it('should map a descending entry to -1 and a fulltext index to a text key', () => {
    const descending = JSON.parse(
      generator.generateCreateIndex('MongoUser', {
        name: 'recent_idx',
        entries: [{ column: 'createdAt', order: 'desc' }],
        unique: false,
      }),
    );
    const text = JSON.parse(
      generator.generateCreateIndex('MongoUser', {
        name: 'text_idx',
        entries: [{ column: 'username' }, { column: 'email' }],
        unique: false,
        type: 'fulltext',
      }),
    );

    expect(descending.key).toEqual({ createdAt: -1 });
    expect(text.key).toEqual({ username: 'text', email: 'text' });
  });

  it('should reject index options MongoDB has no equivalent for', () => {
    expect(() =>
      generator.generateCreateIndex('MongoUser', {
        name: 'expr_idx',
        entries: [{ column: 'lower(username)', expression: true }],
        unique: false,
      }),
    ).toThrow('mongodb does not support that index column option');

    expect(() =>
      generator.generateCreateIndex('MongoUser', {
        name: 'partial_idx',
        entries: [{ column: 'username' }],
        unique: false,
        where: 'deletedAt IS NULL',
      }),
    ).toThrow('mongodb does not support partial indexes from a SQL predicate');
  });

  it('should generate dropCollection statement', () => {
    const json = generator.generateDropTable('MongoUser');
    const cmd = JSON.parse(json);

    expect(cmd).toMatchObject({
      action: 'dropCollection',
      name: 'MongoUser',
    });
  });

  it('should generate createIndex statement', () => {
    const json = generator.generateCreateIndex('MongoUser', {
      name: 'test_idx',
      entries: [{ column: 'test' }],
      unique: true,
    });
    const cmd = JSON.parse(json);

    expect(cmd).toMatchObject({
      action: 'createIndex',
      collection: 'MongoUser',
      name: 'test_idx',
      key: { test: 1 },
      options: { unique: true, name: 'test_idx' },
    });
  });

  it('should generate dropIndex statement', () => {
    const json = generator.generateDropIndex('MongoUser', 'test_idx');
    const cmd = JSON.parse(json);

    expect(cmd).toMatchObject({
      action: 'dropIndex',
      collection: 'MongoUser',
      name: 'test_idx',
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
      indexes: [{ name: 'MongoUser__username_idx', table: {} as any, entries: [], unique: false }],
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
    expect(diff!.indexesToAdd).toHaveLength(1);
    expect(diff!.indexesToAdd![0].name).toBe('email_idx');
  });

  it('diffSchema should return undefined if in sync', () => {
    const currentSchema: TableNode = {
      name: 'MongoUser',
      columns: new Map(),
      indexes: [
        { name: 'MongoUser__username_idx', table: {} as any, entries: [], unique: false },
        { name: 'email_idx', table: {} as any, entries: [], unique: true },
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
      indexesToAdd: [{ name: 'test_idx', entries: [{ column: 'test' }], unique: false }],
    };
    const statements = generator.generateAlterTable(diff);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain('"action":"createIndex"');
  });

  it('should generate alter down statements', () => {
    const diff = {
      tableName: 'MongoUser',
      type: 'alter' as const,
      indexesToAdd: [{ name: 'test_idx', entries: [{ column: 'test' }], unique: false }],
    };
    const statements = generator.generateAlterTableDown(diff);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain('"action":"dropIndex"');
  });

  it('should return empty string for getSqlType', () => {
    expect(generator.getSqlType({})).toBe('');
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
      expect(JSON.parse(generator.generateCreateTableFromNode(tableNode)[0])).toMatchObject({
        action: 'createCollection',
        name: 'users',
      });
    });

    it('should generate dropTable from node', () => {
      expect(JSON.parse(generator.generateDropTable(tableNode.name))).toMatchObject({
        action: 'dropCollection',
        name: 'users',
      });
    });

    it('should generate createIndex from node', () => {
      const indexNode: IndexNode = {
        name: 'test_idx',
        table: tableNode,
        entries: [{ column: 'col1' }],
        unique: true,
      };
      expect(JSON.parse(generator.generateCreateIndexFromNode(indexNode))).toMatchObject({
        action: 'createIndex',
        collection: 'users',
        name: 'test_idx',
        key: { col1: 1 },
        options: { unique: true, name: 'test_idx' },
      });
    });
  });

  describe('Definition-based generation', () => {
    it('should generate createTable from definition, with its indexes', () => {
      const def: TableDefinition = {
        name: 'posts',
        columns: [],
        foreignKeys: [],
        indexes: [{ name: 'posts_slug_idx', entries: [{ column: 'slug' }], unique: true }],
      };
      const statements = generator.generateCreateTableFromDefinition(def).map((sql) => JSON.parse(sql));

      expect(statements[0]).toMatchObject({ action: 'createCollection', name: 'posts' });
      expect(statements[1]).toMatchObject({
        action: 'createIndex',
        collection: 'posts',
        key: { slug: 1 },
        options: { unique: true, name: 'posts_slug_idx' },
      });
    });

    it('should generate the table-level commands by name', () => {
      expect(JSON.parse(generator.generateRenameTableSql('old', 'new'))).toMatchObject({
        action: 'renameCollection',
        from: 'old',
        to: 'new',
      });

      const idx: IndexSchema = { name: 'idx', entries: [{ column: 'c' }], unique: true };
      expect(JSON.parse(generator.generateCreateIndex('users', idx))).toMatchObject({
        action: 'createIndex',
        collection: 'users',
        name: 'idx',
      });

      expect(JSON.parse(generator.generateDropIndex('users', 'idx'))).toMatchObject({
        action: 'dropIndex',
        collection: 'users',
        name: 'idx',
      });
    });
  });
});
