import { describe, expect, it } from 'vitest';
import { Entity, Field, Id } from '../../entity/index.js';
import type { IndexSchema, TableSchema } from '../../type/index.js';
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
    } as IndexSchema);
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
    const currentSchema: TableSchema = {
      name: 'MongoUser',
      columns: [],
      indexes: [{ name: 'idx_MongoUser_username', columns: ['username'], unique: false }],
    };

    const diff = generator.diffSchema(MongoUser, currentSchema);
    expect(diff).toMatchObject({
      tableName: 'MongoUser',
      type: 'alter',
    });
    expect(diff?.indexesToAdd).toHaveLength(1);
    expect(diff?.indexesToAdd?.[0].name).toBe('idx_email');
  });

  it('diffSchema should return undefined if in sync', () => {
    const currentSchema: import('../../type/index.js').TableSchema = {
      name: 'MongoUser',
      columns: [],
      indexes: [
        { name: 'idx_MongoUser_username', columns: ['username'], unique: false },
        { name: 'idx_email', columns: ['email'], unique: true },
      ],
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
    expect(generator.getSqlType()).toBe('');
  });
});
