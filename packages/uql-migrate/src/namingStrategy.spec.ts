import { describe, expect, it } from '@jest/globals';
import { Entity, Field, Id } from 'uql/entity';
import { SnakeCaseNamingStrategy } from '../../core/src/namingStrategy/index.js';
import { PostgresSchemaGenerator } from './generator/postgresSchemaGenerator.js';

@Entity()
class UserProfile {
  @Id() id?: number;
  @Field() firstName?: string;
  @Field() lastName?: string;
}

describe('Schema Generator with Naming Strategy', () => {
  it('should generate CREATE TABLE with translated names', () => {
    const generator = new PostgresSchemaGenerator(new SnakeCaseNamingStrategy());
    const sql = generator.generateCreateTable(UserProfile);

    expect(sql).toContain('CREATE TABLE "user_profile"');
    expect(sql).toContain('"first_name"');
    expect(sql).toContain('"last_name"');
  });
});
