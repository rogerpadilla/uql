import { expect } from 'vitest';
import { JSON_UPDATE_PAYLOADS } from '../dialect/abstractSqlDialect-spec.js';
import { PgFamilySpec } from '../dialect/pgFamilyDialect-spec.js';
import { Entity, Field, Id } from '../entity/index.js';
import { Company, createSpec, InventoryAdjustment, Item, ItemAdjustment, User } from '../test/index.js';
import { raw } from '../util/index.js';
import { PostgresDialect } from './postgresDialect.js';

/** What is Postgres' alone: pgvector's narrower vector types, its wire drivers, `pg_class` stats. */
class PostgresDialectSpec extends PgFamilySpec {
  /** A wire driver's binding, as `uql-orm/bunSql` gives it: arrays as literals, JSON re-cast through text. */
  readonly wirePostgresDialect = new PostgresDialect({
    driverCapabilities: { nativeArrays: false, explicitJsonCast: true },
  });

  constructor() {
    super(new PostgresDialect({}));
  }

  /** The family's native array, then the wire clients' array literal (`toPgArray`). */
  override shouldFind$nin() {
    super.shouldFind$nin();
    const values = ['1', '2'];
    const res = this.exec(
      (ctx) => this.wirePostgresDialect.find(ctx, User, { $select: { id: true }, $where: { id: { $nin: values } } }),
      this.wirePostgresDialect,
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
  shouldNormalizeBooleanArrayToUnquotedPostgresLiterals() {
    const d = new PostgresDialect({ driverCapabilities: { nativeArrays: false } });
    expect(d.normalizeValue([true, false])).toBe('{true,false}');
  }

  /** `String(bytes)` would stringify a `bytea` element as comma-separated bytes; it needs hex. */
  shouldNormalizeBinaryArrayElementsToHexEscapes() {
    const d = new PostgresDialect({ driverCapabilities: { nativeArrays: false } });
    expect(d.normalizeValue([new Uint8Array([0x00, 0x0f, 0xff])])).toBe('{"\\\\x000fff"}');
  }

  /**
   * Bun SQL's `explicitJsonCast` wraps every bound JSON parameter in an extra `(::text)::jsonb`
   * cast - a driver-capability difference orthogonal to which operators are combined, so `$push`
   * alone (the simplest case) is enough to pin it without repeating the check per combination.
   */
  shouldUpdateWithJsonPushViaBunSql() {
    const { sql, values } = this.exec(
      (ctx) =>
        this.wirePostgresDialect.update(
          ctx,
          Company,
          { $where: { id: '1' } },
          { kind: JSON_UPDATE_PAYLOADS.push, updatedAt: 123 },
        ),
      this.wirePostgresDialect,
    );
    expect(sql).toBe(
      'UPDATE "Company" SET "kind" = JSONB_SET("kind", \'{tags}\', COALESCE(("kind")->\'tags\', \'[]\'::jsonb) || JSONB_BUILD_ARRAY(($1::text)::jsonb)), "updatedAt" = $2 WHERE "id" = $3',
    );
    expect(values).toEqual(['"new-tag"', 123, '1']);
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

  shouldFindWithARawExistsSubquery() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, Item, {
        $select: { id: true, name: true },
        $where: {
          $exists: raw(({ ctx, dialect, escapedPrefix }) => {
            dialect.find(
              ctx,
              User,
              { $select: { id: true }, $where: { companyId: raw((o) => o.ctx.append(`${escapedPrefix}"companyId"`)) } },
              { autoPrefix: true },
            );
          }),
        },
      }),
    );

    expect(sql).toBe(
      'SELECT "id", "name" FROM "Item" WHERE EXISTS (SELECT "User"."id" FROM "User" WHERE "User"."companyId" = "Item"."companyId")',
    );
    expect(values).toEqual([]);
  }

  shouldFindWithARawNotExistsSubquery() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, Item, {
        $select: { id: true },
        $where: {
          $nexists: raw(({ ctx, dialect, escapedPrefix }) => {
            dialect.find(
              ctx,
              User,
              { $select: { id: true }, $where: { companyId: raw((o) => o.ctx.append(`${escapedPrefix}"companyId"`)) } },
              { autoPrefix: true },
            );
          }),
        },
      }),
    );

    expect(sql).toBe(
      'SELECT "id" FROM "Item" WHERE NOT EXISTS (SELECT "User"."id" FROM "User" WHERE "User"."companyId" = "Item"."companyId")',
    );
    expect(values).toEqual([]);
  }

  /** Beside a filter of its own, whose value binds first. */
  shouldFindWithARawExistsSubqueryAndAFilter() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, InventoryAdjustment, {
        $select: { id: true, description: true },
        $where: {
          createdAt: { $gte: 1000 },
          $exists: raw(({ ctx, dialect, escapedPrefix }) => {
            dialect.find(
              ctx,
              ItemAdjustment,
              {
                $select: { id: true },
                $where: {
                  inventoryAdjustmentId: raw((o) => o.ctx.append(`${escapedPrefix}"id"`)),
                  buyPrice: { $gte: 100 },
                },
              },
              { autoPrefix: true },
            );
          }),
        },
      }),
    );

    expect(sql).toBe(
      'SELECT "id", "description" FROM "InventoryAdjustment" ' +
        'WHERE "createdAt" >= $1 AND EXISTS (SELECT "ItemAdjustment"."id" FROM "ItemAdjustment" ' +
        'WHERE "ItemAdjustment"."inventoryAdjustmentId" = "InventoryAdjustment"."id" AND "ItemAdjustment"."buyPrice" >= $2)',
    );
    expect(values).toEqual([1000, 100]);
  }

  /** The children are read inside the statement, so their filter binds before the parent's own. */
  shouldFilterAPopulatedOneToManyInsideTheStatement() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, InventoryAdjustment, {
        $select: { id: true, description: true },
        $populate: {
          itemAdjustments: { $select: { buyPrice: true, number: true }, $where: { buyPrice: { $gte: 100 } } },
        },
        $where: { createdAt: { $gte: 1000 } },
      }),
    );

    expect(sql).toBe(
      `SELECT "InventoryAdjustment"."id", "InventoryAdjustment"."description", (SELECT COALESCE(JSON_AGG("_uql_row"), '[]'::json)` +
        ' FROM (SELECT "itemAdjustments"."buyPrice"::text "buyPrice", "itemAdjustments"."number"::text "number"' +
        ' FROM "ItemAdjustment" "itemAdjustments" WHERE "itemAdjustments"."buyPrice" >= $1' +
        ' AND "itemAdjustments"."inventoryAdjustmentId" = "InventoryAdjustment"."id") "itemAdjustments"' +
        ' CROSS JOIN LATERAL (SELECT "itemAdjustments"."buyPrice", "itemAdjustments"."number") "_uql_row") "itemAdjustments"' +
        ' FROM "InventoryAdjustment" WHERE "InventoryAdjustment"."createdAt" >= $2',
    );
    expect(values).toEqual([100, 1000]);
  }

  /** A to-one is joined, so its filter joins with it, binding before the parent's own. */
  shouldFilterAPopulatedManyToOneInItsJoin() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, Item, {
        $select: { id: true, name: true },
        $populate: { tax: { $select: { name: true, percentage: true }, $where: { percentage: { $gte: 10 } } } },
        $where: { salePrice: { $gte: 50 } },
      }),
    );

    expect(sql).toBe(
      'SELECT "Item"."id", "Item"."name", "tax"."id" "tax.id", "tax"."name" "tax.name", "tax"."percentage" "tax.percentage" ' +
        'FROM "Item" LEFT JOIN "Tax" "tax" ON "tax"."id" = "Item"."taxId" AND "tax"."percentage" >= $1 ' +
        'WHERE "Item"."salePrice" >= $2',
    );
    expect(values).toEqual([10, 50]);
  }
}

createSpec(new PostgresDialectSpec());
