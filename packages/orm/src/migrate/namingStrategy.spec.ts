import { describe, expect, it } from 'vitest';
import { defineEntity, Entity, f, Field } from '../entity/index.js';
import { SnakeCaseNamingStrategy } from '../index.js';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import { SqlSchemaGenerator } from './schemaGenerator.js';

@Entity()
class UserProfileMigrate {
  @Field(f.number().id()) id?: number;
  @Field(f.string().nullable()) firstName?: string | null;
  @Field(f.string().nullable()) lastName?: string | null;
}

/** Named after itself: what the author wrote is the table, however much it looks like a default. */
@Entity({ name: 'UserProfileNamed' })
class UserProfileNamed {
  @Field(f.number().id()) id?: number;
}

describe('Schema Generator with Naming Strategy', () => {
  it('should generate CREATE TABLE with translated names', () => {
    const generator = new SqlSchemaGenerator(new PostgresDialect({ namingStrategy: new SnakeCaseNamingStrategy() }));
    const sql = generator.generateCreateSchema([UserProfileMigrate]).join('\n');

    expect(sql).toContain('CREATE TABLE "user_profile_migrate"');
    expect(sql).toContain('"first_name"');
    expect(sql).toContain('"last_name"');
  });

  it('should leave a table the entity named alone, whatever it is called', () => {
    const generator = new SqlSchemaGenerator(new PostgresDialect({ namingStrategy: new SnakeCaseNamingStrategy() }));

    // Both of these state their table; a strategy derives a name, it does not rewrite one.
    expect(generator.generateCreateSchema([UserProfileNamed]).join('\n')).toContain('CREATE TABLE "UserProfileNamed"');
    // A schema stating its table: the strategy leaves it alone.
    const minted = defineEntity({ name: 'BlogPost', table: 'blogPost', fields: { id: f.number().id() } });
    expect(generator.generateCreateSchema([minted]).join('\n')).toContain('CREATE TABLE "blogPost"');
  });

  it("should derive a schema's table from its name, as a decorated class's", () => {
    const generator = new SqlSchemaGenerator(new PostgresDialect({ namingStrategy: new SnakeCaseNamingStrategy() }));
    const derived = defineEntity({ name: 'DerivedPost', fields: { id: f.number().id() } });
    expect(generator.generateCreateSchema([derived]).join('\n')).toContain('CREATE TABLE "derived_post"');
  });
});
