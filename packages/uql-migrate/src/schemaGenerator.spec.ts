import { describe, expect, it } from '@jest/globals';
import { Entity, Field, Id, ManyToOne } from '@uql/core/entity';
import { MysqlSchemaGenerator } from './generator/mysqlSchemaGenerator.js';
import { PostgresSchemaGenerator } from './generator/postgresSchemaGenerator.js';
import { SqliteSchemaGenerator } from './generator/sqliteSchemaGenerator.js';

// Test entities
@Entity()
class TestUser {
  @Id()
  id?: number;

  @Field({ length: 100 })
  name?: string;

  @Field({ unique: true })
  email?: string;

  @Field({ nullable: false })
  password?: string;

  @Field({ onInsert: Date.now })
  createdAt?: number;
}

@Entity({ name: 'blog_posts' })
class TestPost {
  @Id({ onInsert: () => crypto.randomUUID(), length: 36 })
  id?: string;

  @Field()
  title?: string;

  @Field({ columnType: 'text' })
  content?: string;

  @Field({ type: 'jsonb' })
  metadata?: Record<string, unknown>;

  @Field({ reference: () => TestUser })
  authorId?: number;

  @ManyToOne()
  author?: TestUser;
}

describe('PostgresSchemaGenerator', () => {
  const generator = new PostgresSchemaGenerator();

  it('should generate CREATE TABLE for simple entity', () => {
    const sql = generator.generateCreateTable(TestUser);

    expect(sql).toContain('CREATE TABLE "TestUser"');
    expect(sql).toContain('"id" SERIAL PRIMARY KEY');
    expect(sql).toContain('"name" VARCHAR(100)');
    expect(sql).toContain('"email" VARCHAR(255) UNIQUE');
    expect(sql).toContain('"password" VARCHAR(255) NOT NULL');
    expect(sql).toContain('"createdAt"');
  });

  it('should generate CREATE TABLE with UUID primary key', () => {
    const sql = generator.generateCreateTable(TestPost);

    expect(sql).toContain('CREATE TABLE "blog_posts"');
    expect(sql).toContain('"id" VARCHAR(36) PRIMARY KEY');
    expect(sql).toContain('"title" VARCHAR(255)');
    expect(sql).toContain('"content" TEXT');
    expect(sql).toContain('"metadata" JSONB');
    expect(sql).toContain('"authorId"');
  });

  it('should generate DROP TABLE statement', () => {
    const sql = generator.generateDropTable(TestUser);

    expect(sql).toBe('DROP TABLE IF EXISTS "TestUser";');
  });

  it('should generate CREATE INDEX statement', () => {
    const sql = generator.generateCreateIndex('users', {
      name: 'idx_users_email',
      columns: ['email'],
      unique: true,
    });

    expect(sql).toBe('CREATE UNIQUE INDEX "idx_users_email" ON "users" ("email");');
  });

  it('should generate CREATE TABLE with IF NOT EXISTS', () => {
    const sql = generator.generateCreateTable(TestUser, { ifNotExists: true });
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "TestUser"');
  });

  it('should handle embedded quotes in table names', () => {
    @Entity({ name: 'my"table' })
    class TestEntity {
      @Id()
      id?: number;
    }
    const sql = generator.generateCreateTable(TestEntity);
    expect(sql).toContain('CREATE TABLE "my""table"');
  });

  it('should handle already-typed column schemas', () => {
    const sql = generator.generateAlterTable({
      tableName: 'users',
      type: 'alter',
      columnsToAdd: [
        {
          name: 'profile_data',
          type: 'JSONB',
          nullable: true,
          isPrimaryKey: false,
          isAutoIncrement: false,
          isUnique: false,
        },
      ],
    });
    // Should NOT be JSONB(JSONB)
    expect(sql[0]).toContain('ADD COLUMN "profile_data" JSONB');
    expect(sql[0]).not.toContain('JSONB(');
  });

  it('should generate ALTER TABLE DOWN statements', () => {
    const sql = generator.generateAlterTableDown({
      tableName: 'users',
      type: 'alter',
      columnsToAdd: [
        {
          name: 'profile_data',
          type: 'JSONB',
          nullable: true,
          isPrimaryKey: false,
          isAutoIncrement: false,
          isUnique: false,
        },
      ],
    });
    expect(sql[0]).toBe('ALTER TABLE "users" DROP COLUMN "profile_data";');
  });
});

describe('MysqlSchemaGenerator', () => {
  const generator = new MysqlSchemaGenerator();

  it('should generate CREATE TABLE for simple entity', () => {
    const sql = generator.generateCreateTable(TestUser);

    expect(sql).toContain('CREATE TABLE `TestUser`');
    expect(sql).toContain('`id` INT AUTO_INCREMENT PRIMARY KEY');
    expect(sql).toContain('`name` VARCHAR(100)');
    expect(sql).toContain('`email` VARCHAR(255) UNIQUE');
    expect(sql).toContain('ENGINE=InnoDB');
  });

  it('should generate boolean as TINYINT(1)', () => {
    const boolType = generator.getSqlType({ type: Boolean }, Boolean);
    expect(boolType).toBe('TINYINT(1)');
  });

  it('should generate DROP INDEX with ON table', () => {
    const sql = generator.generateDropIndex('users', 'idx_email');
    expect(sql).toBe('DROP INDEX `idx_email` ON `users`;');
  });
});

describe('SqliteSchemaGenerator', () => {
  const generator = new SqliteSchemaGenerator();

  it('should generate CREATE TABLE for simple entity', () => {
    const sql = generator.generateCreateTable(TestUser);

    expect(sql).toContain('CREATE TABLE `TestUser`');
    expect(sql).toContain('`id` INTEGER PRIMARY KEY AUTOINCREMENT');
    // SQLite uses VARCHAR when length is specified, which is fine as SQLite has dynamic typing
    expect(sql).toContain('`name` VARCHAR(100)');
    expect(sql).toContain('`email` VARCHAR(255) UNIQUE');
  });

  it('should use TEXT for most types (SQLite dynamic typing)', () => {
    expect(generator.getSqlType({ columnType: 'varchar' }, String)).toBe('TEXT');
    expect(generator.getSqlType({ columnType: 'json' }, undefined)).toBe('TEXT');
    expect(generator.getSqlType({ columnType: 'uuid' }, undefined)).toBe('TEXT');
  });

  it('should use INTEGER for numeric types', () => {
    expect(generator.getSqlType({ columnType: 'int' }, undefined)).toBe('INTEGER');
    expect(generator.getSqlType({ columnType: 'bigint' }, undefined)).toBe('INTEGER');
    expect(generator.getSqlType({ type: Boolean }, Boolean)).toBe('INTEGER');
  });
});
