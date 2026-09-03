import { expect } from 'vitest';
import { BunSqlPostgresDialect } from '../bunSql/bunSqlPostgresDialect.js';
import { JSON_UPDATE_PAYLOADS } from '../dialect/abstractSqlDialect-spec.js';
import { PgFamilySpec } from '../dialect/pgFamilyDialect-spec.js';
import { Entity, Field, Id } from '../entity/index.js';
import { Company, createSpec, User } from '../test/index.js';
import type { UpdatePayload } from '../type/index.js';
import { PgDialect } from './pgDialect.js';
import { PostgresDialect } from './postgresDialect.js';
import { POSTGRES_WIRE_DRIVER_CAPABILITIES } from './postgresWireDriverCapabilities.js';

/** What is Postgres' alone: pgvector's narrower vector types, its wire drivers, `pg_class` stats. */
class PostgresDialectSpec extends PgFamilySpec {
  readonly pgDialect = new PgDialect();

  readonly wireArrayPostgresDialect = new PostgresDialect({
    driverCapabilities: { ...POSTGRES_WIRE_DRIVER_CAPABILITIES },
  });

  readonly bunSqlPostgresDialect = new BunSqlPostgresDialect();

  constructor() {
    super(new PostgresDialect({}));
  }

  /** The family's `$1::jsonb`, then the node-pg driver's, which binds it the same way. */
  override shouldUpdateWithJsonbField() {
    super.shouldUpdateWithJsonbField();
    const payload: UpdatePayload<Company>['kind'] = { private: 1 };
    const res = this.exec(
      (ctx) => this.pgDialect.update(ctx, Company, { $where: { id: 1 } }, { kind: payload, updatedAt: 123 }),
      this.pgDialect,
    );
    expect(res.sql).toBe('UPDATE "Company" SET "kind" = $1::jsonb, "updatedAt" = $2 WHERE "id" = $3');
    expect(res.values).toEqual(['{"private":1}', 123, 1]);
  }

  /** The family's binding, then each wire driver's: node-pg a native array, the wire clients a literal. */
  override shouldFind$nin() {
    super.shouldFind$nin();
    const values = [1, 2];
    let res = this.exec(
      (ctx) => this.pgDialect.find(ctx, User, { $select: { id: true }, $where: { id: { $nin: values } } }),
      this.pgDialect,
    );
    expect(res.sql).toBe('SELECT "id" FROM "User" WHERE "id" <> ALL($1)');
    expect(res.values).toEqual([values]);

    // Bun SQL / wire clients: array literal strings (`toPgArray`)
    res = this.exec(
      (ctx) =>
        this.wireArrayPostgresDialect.find(ctx, User, { $select: { id: true }, $where: { id: { $nin: values } } }),
      this.wireArrayPostgresDialect,
    );
    expect(res.sql).toBe('SELECT "id" FROM "User" WHERE "id" <> ALL($1)');
    expect(res.values).toEqual(['{"1","2"}']);
  }

  shouldCastHalfvecSort() {
    @Entity({ name: 'HalfvecItem' })
    class HalfvecItem {
      @Id({ type: Number }) id?: number;
      @Field({ type: 'halfvec' }) vec!: number[];
    }
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, HalfvecItem, {
        $select: { id: true },
        $sort: { vec: { $vector: [1, 2, 3] } },
        $limit: 5,
      }),
    );
    expect(sql).toBe('SELECT "id" FROM "HalfvecItem" ORDER BY "vec" <=> $1::halfvec LIMIT 5');
    expect(values).toEqual(['[1,2,3]']);
  }

  /**
   * `sparsevec` takes pgvector's sparse literal, `{index:value,...}/dimensions` with the zeros left
   * out. Binding the dense `[0,0,1]` every other vector type takes fails with "invalid input syntax
   * for type sparsevec", so the dense array an entity declares is converted on the way out.
   */

  /**
   * `sparsevec` takes pgvector's sparse literal, `{index:value,...}/dimensions` with the zeros left
   * out. Binding the dense `[0,0,1]` every other vector type takes fails with "invalid input syntax
   * for type sparsevec", so the dense array an entity declares is converted on the way out.
   */
  shouldBindSparsevecAsASparseLiteral() {
    @Entity({ name: 'SparsevecItem' })
    class SparsevecItem {
      @Id({ type: Number }) id?: number;
      @Field({ type: 'sparsevec' }) vec!: number[];
    }
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, SparsevecItem, {
        $select: { id: true },
        $sort: { vec: { $vector: [0, 0, 1], $distance: 'l2' } },
        $limit: 5,
      }),
    );
    expect(sql).toBe('SELECT "id" FROM "SparsevecItem" ORDER BY "vec" <-> $1::sparsevec LIMIT 5');
    expect(values).toEqual(['{3:1}/3']);
  }

  shouldInsertSparsevecAsASparseLiteral() {
    @Entity({ name: 'SparsevecItem2' })
    class SparsevecItem2 {
      @Id({ type: Number }) id?: number;
      @Field({ type: 'sparsevec' }) vec!: number[];
    }
    const { sql, values } = this.exec((ctx) => this.dialect.insert(ctx, SparsevecItem2, { vec: [1, 0, 2] }));
    expect(sql).toBe('INSERT INTO "SparsevecItem2" ("vec") VALUES ($1::sparsevec) RETURNING "id" "id"');
    expect(values).toEqual(['{1:1,3:2}/3']);
  }

  /** Array text format (`{...}`) is distinct from scalar SQL string literals; see `toPgArray` JSDoc. */
  shouldNormalizeArrayToPostgresArrayTextFormatWhenNativeArraysFalse() {
    const d = new PostgresDialect({ driverCapabilities: { nativeArrays: false } });
    const tricky = 'b"\\'; // b, double-quote, one backslash
    const escaped = tricky.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    expect(d.normalizeValue(['a', tricky, null])).toBe(`{"a","${escaped}",NULL}`);
    expect(d.normalizeValue([[1, 2], 3])).toBe('{{"1","2"},"3"}');
  }

  /** Booleans go in unquoted: `{"true"}` would bind the *string* "true" to a `boolean[]`. */

  /** Booleans go in unquoted: `{"true"}` would bind the *string* "true" to a `boolean[]`. */
  shouldNormalizeBooleanArrayToUnquotedPostgresLiterals() {
    const d = new PostgresDialect({ driverCapabilities: { nativeArrays: false } });
    expect(d.normalizeValue([true, false])).toBe('{true,false}');
  }

  /** `String(bytes)` would stringify a `bytea` element as comma-separated bytes; it needs hex. */

  /** `String(bytes)` would stringify a `bytea` element as comma-separated bytes; it needs hex. */
  shouldNormalizeBinaryArrayElementsToHexEscapes() {
    const d = new PostgresDialect({ driverCapabilities: { nativeArrays: false } });
    expect(d.normalizeValue([new Uint8Array([0x00, 0x0f, 0xff])])).toBe('{"\\\\x000fff"}');
  }

  // JSONB operator tests

  /**
   * Bun SQL's `explicitJsonCast` wraps every bound JSON parameter in an extra `(::text)::jsonb`
   * cast - a driver-capability difference orthogonal to which operators are combined, so `$push`
   * alone (the simplest case) is enough to pin it without repeating the check per combination.
   */
  shouldUpdateWithJsonPushViaBunSql() {
    const { sql, values } = this.exec(
      (ctx) =>
        this.bunSqlPostgresDialect.update(
          ctx,
          Company,
          { $where: { id: 1 } },
          { kind: JSON_UPDATE_PAYLOADS.push, updatedAt: 123 },
        ),
      this.bunSqlPostgresDialect,
    );
    expect(sql).toBe(
      'UPDATE "Company" SET "kind" = jsonb_set("kind", \'{tags}\', COALESCE(("kind")->\'tags\', \'[]\'::jsonb) || jsonb_build_array(($1::text)::jsonb)), "updatedAt" = $2 WHERE "id" = $3',
    );
    expect(values).toEqual(['"new-tag"', 123, 1]);
  }

  /**
   * `GREATEST` guards the `-1` Postgres carries for a table nothing has analyzed yet (its "no
   * statistic", verified live on PG 18), which raw would read as a negative row count.
   */
  override shouldEstimatedCount() {
    const { sql, values } = this.exec((ctx) => this.dialect.estimatedCount(ctx, User));
    expect(sql).toBe('SELECT GREATEST(reltuples, 0)::bigint "_uql_count" FROM pg_class WHERE oid = to_regclass($1)');
    expect(values).toEqual(['"User"']);
  }
}

createSpec(new PostgresDialectSpec());
