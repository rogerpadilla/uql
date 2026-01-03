import { describe, expect, it } from 'vitest';
import { Entity, Field, Id } from '../entity/index.js';
import { SnakeCaseNamingStrategy } from '../index.js';
import { PostgresSchemaGenerator } from './generator/postgresSchemaGenerator.js';

@Entity()
class UserProfileMigrate {
  @Id() id?: number;
  @Field() firstName?: string;
  @Field() lastName?: string;
}

describe('Schema Generator with Naming Strategy', () => {
  it('should generate CREATE TABLE with translated names', () => {
    const generator = new PostgresSchemaGenerator(new SnakeCaseNamingStrategy());
    const sql = generator.generateCreateTable(UserProfileMigrate);

    expect(sql).toContain('CREATE TABLE "user_profile_migrate"');
    expect(sql).toContain('"first_name"');
    expect(sql).toContain('"last_name"');
  });
});
