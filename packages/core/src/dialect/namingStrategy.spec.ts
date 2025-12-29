import { MySqlDialect } from '../../../mysql/src/mysqlDialect.js';
import { PostgresDialect } from '../../../postgres/src/postgresDialect.js';
import { SqliteDialect } from '../../../sqlite/src/sqliteDialect.js';
import { Entity, Field, Id } from '../entity/index.js';
import { SnakeCaseNamingStrategy } from '../namingStrategy/index.js';

@Entity()
class UserProfile {
  @Id() id?: number;
  @Field() firstName?: string;
  @Field() lastName?: string;
  @Field({ name: 'explicit_name' }) explicitField?: string;
}

describe('Naming Strategy SQL Generation', () => {
  describe('Postgres with SnakeCaseNamingStrategy', () => {
    const dialect = new PostgresDialect(new SnakeCaseNamingStrategy());

    it('should translate table and column names', () => {
      const ctx = dialect.createContext();
      dialect.insert(ctx, UserProfile, { firstName: 'John', lastName: 'Doe' });
      expect(ctx.sql).toContain('INSERT INTO "user_profile" ("first_name", "last_name")');
    });

    it('should respect explicit names', () => {
      const ctx = dialect.createContext();
      dialect.insert(ctx, UserProfile, { explicitField: 'value' });
      expect(ctx.sql).toContain('"explicit_name"');
    });
  });

  describe('MySQL with SnakeCaseNamingStrategy', () => {
    const dialect = new MySqlDialect(new SnakeCaseNamingStrategy());

    it('should translate table and column names', () => {
      const ctx = dialect.createContext();
      dialect.insert(ctx, UserProfile, { firstName: 'John', lastName: 'Doe' });
      expect(ctx.sql).toContain('INSERT INTO `user_profile` (`first_name`, `last_name`)');
    });
  });

  describe('SQLite with SnakeCaseNamingStrategy', () => {
    const dialect = new SqliteDialect(new SnakeCaseNamingStrategy());

    it('should translate table and column names', () => {
      const ctx = dialect.createContext();
      dialect.insert(ctx, UserProfile, { firstName: 'John', lastName: 'Doe' });
      expect(ctx.sql).toContain('INSERT INTO `user_profile` (`first_name`, `last_name`)');
    });
  });
});
