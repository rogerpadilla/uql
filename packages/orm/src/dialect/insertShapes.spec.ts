import { describe, expect, it } from 'vitest';
import { Entity, Field, Id } from '../entity/index.js';
import { PostgresDialect } from '../postgres/postgresDialect.js';

@Entity()
class Shaped {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) name?: string;
  @Field({ type: String }) email?: string;
  @Field({ type: 'json' }) settings?: object;
  @Field({ type: 'vector' }) embedding?: number[];
}

/**
 * The value formatter dispatches once (json/vector are dialect hooks), and the column list is the
 * union across records with `DEFAULT` filling the gaps. Both were reworked for speed, so these pin
 * the emitted SQL for every shape rather than only the homogeneous one.
 */
describe('insert shapes', () => {
  const dialect = new PostgresDialect();

  const sqlFor = (payload: Shaped | Shaped[]) => {
    const ctx = dialect.createContext();
    dialect.insert(ctx, Shaped, payload);
    return { sql: ctx.sql, values: ctx.values };
  };

  it('should bind one placeholder per column for a single row', () => {
    expect(sqlFor({ name: 'solo' })).toEqual({
      sql: 'INSERT INTO "Shaped" ("name") VALUES ($1) RETURNING "id" "id"',
      values: ['solo'],
    });
  });

  it('should reuse one column list for a homogeneous batch', () => {
    expect(
      sqlFor([
        { name: 'a', email: 'a@x' },
        { name: 'b', email: 'b@x' },
      ]),
    ).toEqual({
      sql: 'INSERT INTO "Shaped" ("name", "email") VALUES ($1, $2), ($3, $4) RETURNING "id" "id"',
      values: ['a', 'a@x', 'b', 'b@x'],
    });
  });

  it("should union a ragged batch's columns in first-seen order and fill the gaps with DEFAULT", () => {
    expect(sqlFor([{ name: 'a' }, { email: 'b@x' }, { name: 'c', email: 'c@x' }])).toEqual({
      sql:
        'INSERT INTO "Shaped" ("name", "email") VALUES ($1, DEFAULT), (DEFAULT, $2), ($3, $4) ' + 'RETURNING "id" "id"',
      values: ['a', 'b@x', 'c', 'c@x'],
    });
  });

  it('should treat an explicit undefined as absent', () => {
    expect(sqlFor({ name: 'a', email: undefined })).toEqual({
      sql: 'INSERT INTO "Shaped" ("name") VALUES ($1) RETURNING "id" "id"',
      values: ['a'],
    });
  });

  it("should send json columns through the dialect's json hook", () => {
    expect(sqlFor({ name: 'a', settings: { dark: true } })).toEqual({
      sql: 'INSERT INTO "Shaped" ("name", "settings") VALUES ($1, $2::json) RETURNING "id" "id"',
      values: ['a', '{"dark":true}'],
    });
  });

  it("should send vector columns through the dialect's vector hook", () => {
    expect(sqlFor({ name: 'a', embedding: [0.1, 0.2] })).toEqual({
      sql: 'INSERT INTO "Shaped" ("name", "embedding") VALUES ($1, $2::vector) RETURNING "id" "id"',
      values: ['a', '[0.1,0.2]'],
    });
  });
});
