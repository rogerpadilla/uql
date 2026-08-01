import { describe, expect, it } from 'vitest';
import { Entity, Field, Id } from '../entity/index.js';
import { MySqlDialect } from '../mysql/mysqlDialect.js';
import { SnakeCaseNamingStrategy } from '../namingStrategy/index.js';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import { SqliteDialect } from '../sqlite/sqliteDialect.js';

@Entity()
class UserProfileDialect {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) firstName?: string;
  @Field({ type: String }) lastName?: string;
  @Field({ type: String, name: 'explicit_name' }) explicitField?: string;
}

describe('Naming Strategy SQL Generation', () => {
  describe('Postgres with SnakeCaseNamingStrategy', () => {
    const dialect = new PostgresDialect({ namingStrategy: new SnakeCaseNamingStrategy() });

    it('should translate table and column names', () => {
      const ctx = dialect.createContext();
      dialect.insert(ctx, UserProfileDialect, { firstName: 'John', lastName: 'Doe' });
      expect(ctx.sql).toContain('INSERT INTO "user_profile_dialect" ("first_name", "last_name")');
    });

    it('should respect explicit names', () => {
      const ctx = dialect.createContext();
      dialect.insert(ctx, UserProfileDialect, { explicitField: 'value' });
      expect(ctx.sql).toContain('"explicit_name"');
    });
  });

  describe('MySQL with SnakeCaseNamingStrategy', () => {
    const dialect = new MySqlDialect({ namingStrategy: new SnakeCaseNamingStrategy() });

    it('should translate table and column names', () => {
      const ctx = dialect.createContext();
      dialect.insert(ctx, UserProfileDialect, { firstName: 'John', lastName: 'Doe' });
      expect(ctx.sql).toContain('INSERT INTO `user_profile_dialect` (`first_name`, `last_name`)');
    });
  });

  describe('SQLite with SnakeCaseNamingStrategy', () => {
    const dialect = new SqliteDialect({ namingStrategy: new SnakeCaseNamingStrategy() });

    it('should translate table and column names', () => {
      const ctx = dialect.createContext();
      dialect.insert(ctx, UserProfileDialect, { firstName: 'John', lastName: 'Doe' });
      expect(ctx.sql).toContain('INSERT INTO `user_profile_dialect` (`first_name`, `last_name`)');
    });
  });

  // Escaped column names are memoized per dialect instance. Entity metadata is shared between
  // dialects, so a cache leaking across them would quote or rename columns wrongly.
  describe('escaped columns are memoized per dialect, not per field', () => {
    it('quotes the same entity differently for each dialect', () => {
      const pg = new PostgresDialect();
      const mysql = new MySqlDialect();
      const pgCtx = pg.createContext();
      const mysqlCtx = mysql.createContext();
      pg.insert(pgCtx, UserProfileDialect, { firstName: 'John' });
      mysql.insert(mysqlCtx, UserProfileDialect, { firstName: 'John' });
      expect(pgCtx.sql).toContain('("firstName")');
      expect(mysqlCtx.sql).toContain('(`firstName`)');
    });

    it('applies each dialect’s own naming strategy to the same entity', () => {
      const plain = new PostgresDialect();
      const snake = new PostgresDialect({ namingStrategy: new SnakeCaseNamingStrategy() });
      const plainCtx = plain.createContext();
      const snakeCtx = snake.createContext();
      plain.insert(plainCtx, UserProfileDialect, { firstName: 'John' });
      snake.insert(snakeCtx, UserProfileDialect, { firstName: 'John' });
      expect(plainCtx.sql).toContain('"UserProfileDialect" ("firstName")');
      expect(snakeCtx.sql).toContain('"user_profile_dialect" ("first_name")');
    });

    it('returns the same column on repeated use (cache hit path)', () => {
      const dialect = new PostgresDialect({ namingStrategy: new SnakeCaseNamingStrategy() });
      const first = dialect.createContext();
      const second = dialect.createContext();
      dialect.insert(first, UserProfileDialect, { firstName: 'a' });
      dialect.insert(second, UserProfileDialect, { firstName: 'b' });
      expect(second.sql).toBe(first.sql);
    });
  });
});
