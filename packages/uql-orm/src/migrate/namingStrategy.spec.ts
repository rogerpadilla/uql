import { describe, expect, it } from 'vitest';
import { defineEntity, Entity, Field, Id } from '../entity/index.js';
import { SnakeCaseNamingStrategy } from '../index.js';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import { SqlSchemaGenerator } from './schemaGenerator.js';

@Entity()
class UserProfileMigrate {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) firstName?: string;
  @Field({ type: String }) lastName?: string;
}

/** Named after itself: what the author wrote is the table, however much it looks like a default. */
@Entity({ name: 'UserProfileNamed' })
class UserProfileNamed {
  @Id({ type: Number }) id?: number;
}

describe('Schema Generator with Naming Strategy', () => {
  it('should generate CREATE TABLE with translated names', () => {
    const generator = new SqlSchemaGenerator(new PostgresDialect({ namingStrategy: new SnakeCaseNamingStrategy() }));
    const sql = generator.generateCreateSchema([UserProfileMigrate]).join('\n');

    expect(sql).toContain('CREATE TABLE "user_profile_migrate"');
    expect(sql).toContain('"first_name"');
    expect(sql).toContain('"last_name"');
  });

  it('keeps deriving a name a later registration says nothing about', () => {
    const generator = new SqlSchemaGenerator(new PostgresDialect({ namingStrategy: new SnakeCaseNamingStrategy() }));

    class ComposedRow {
      id?: number;
      title?: string;
    }
    defineEntity(ComposedRow, { fields: { id: { type: Number, isId: true } } });
    // Composing adds fields; it does not turn the class name it derived into a name the author wrote.
    defineEntity(ComposedRow, { fields: { title: { type: String } } });

    expect(generator.generateCreateSchema([ComposedRow]).join('\n')).toContain('CREATE TABLE "composed_row"');
  });

  it('leaves a table the entity named alone, whatever it is called', () => {
    const generator = new SqlSchemaGenerator(new PostgresDialect({ namingStrategy: new SnakeCaseNamingStrategy() }));

    // Both of these state their table; a strategy derives a name, it does not rewrite one.
    expect(generator.generateCreateSchema([UserProfileNamed]).join('\n')).toContain('CREATE TABLE "UserProfileNamed"');
    // A class minted at runtime, named after the table it states: the strategy leaves both alone.
    const minted = { blogPost: class {} }.blogPost;
    defineEntity(minted, { name: 'blogPost', fields: { id: { type: Number, isId: true } } });
    expect(generator.generateCreateSchema([minted]).join('\n')).toContain('CREATE TABLE "blogPost"');
  });
});
