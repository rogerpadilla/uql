import { expect } from 'vitest';
import { AbstractSqlDialectSpec, type JsonUpdateCaseName } from '../dialect/abstractSqlDialect-spec.js';
import { Computed, Entity, f, Field } from '../entity/index.js';
import {
  Company,
  createSpec,
  Invoice,
  Item,
  MeasureUnitCategory,
  Reading,
  TaxCategory,
  TypedRow,
  User,
  Tax,
} from '../test/index.js';
import { idKey, type QueryLockWait } from '../type/index.js';
import { sql } from '../util/index.js';
import { MsSqlDialect } from './mssqlDialect.js';

/** A composite key, which hands no single id back. */
@Entity()
class StockLevel {
  [idKey]?: 'warehouseId' | 'productId';
  @Field(f.number().id()) warehouseId?: number;
  @Field(f.number().id()) productId?: number;
  @Field(f.number().nullable()) quantity?: number | null;
}

/** An inlined field, whose SQL reads the row's other columns. */
@Entity()
class Shout {
  @Field(f.number().id()) id?: number;
  @Field(f.string()) first!: string;
  @Field(f.number().nullable()) age?: number | null;
  @Computed((row) => f.string().as(sql`${row.first} + '!'`)) readonly shout?: string;
}

/**
 * SQL Server's share of the shared dialect spec. What it overrides is what T-SQL genuinely spells
 * differently - the lock, the returning clause, the upsert and the JSON operators - which is the
 * same shape `PgFamilySpec` has for the Postgres family.
 */
const MSSQL_LOCK_WAITS: Readonly<Record<QueryLockWait, string>> = { block: '', skip: ', READPAST', nowait: ', NOWAIT' };

class MsSqlDialectSpec extends AbstractSqlDialectSpec {
  /** SQL Server has neither `NULLS FIRST` nor an orderable boolean, so the placement is a `CASE`. */
  protected override expectedNullsOrdering(column: string): string {
    return `CASE WHEN ${column} IS NULL THEN 0 ELSE 1 END, ${column} DESC`;
  }

  /** `N'...'` quoting, and a `BIT` written as an integer. */
  protected override inlineLiterals() {
    return { quoted: "N'it''s'", truth: '1' };
  }

  constructor() {
    super(new MsSqlDialect({}));
  }

  protected override readonly jsonUpdateCases: Record<JsonUpdateCaseName, { sql: string; values: unknown[] }> = {
    set: {
      sql: 'UPDATE "Company" SET "kind" = JSON_MODIFY(COALESCE("kind", \'{}\'), \'$.private\', @p1), "updatedAt" = @p2 WHERE "id" = @p3',
      values: [1, 123, '1'],
    },
    unsetOnly: {
      sql: 'UPDATE "Company" SET "kind" = JSON_MODIFY(JSON_MODIFY("kind", \'$.public\', NULL), \'$.private\', NULL), "updatedAt" = @p1 WHERE "id" = @p2',
      values: [123, '1'],
    },
    push: {
      sql: `UPDATE "Company" SET "kind" = JSON_MODIFY(COALESCE("kind", '{}'), CASE WHEN CASE WHEN (SELECT "value" FROM OPENJSON("kind", '$') WHERE "key" = N'tags') IS NULL OR LEFT(JSON_QUERY("kind", '$.tags'), 1) = '[' THEN JSON_MODIFY(CASE WHEN (SELECT "value" FROM OPENJSON("kind", '$') WHERE "key" = N'tags') IS NULL THEN '[]' ELSE (SELECT "value" FROM OPENJSON("kind", '$') WHERE "key" = N'tags') END, 'append $', @p1) END IS NULL THEN '$._uql_skip' ELSE '$.tags' END, JSON_QUERY(CASE WHEN (SELECT "value" FROM OPENJSON("kind", '$') WHERE "key" = N'tags') IS NULL OR LEFT(JSON_QUERY("kind", '$.tags'), 1) = '[' THEN JSON_MODIFY(CASE WHEN (SELECT "value" FROM OPENJSON("kind", '$') WHERE "key" = N'tags') IS NULL THEN '[]' ELSE (SELECT "value" FROM OPENJSON("kind", '$') WHERE "key" = N'tags') END, 'append $', @p1) END)), "updatedAt" = @p2 WHERE "id" = @p3`,
      values: ['new-tag', 123, '1'],
    },
    pull: {
      sql: `UPDATE "Company" SET "kind" = JSON_MODIFY("kind", CASE WHEN CASE WHEN LEFT(JSON_QUERY("kind", '$.tags'), 1) = '[' THEN COALESCE((SELECT '[' + STRING_AGG(CASE _uql_pull."type" WHEN 0 THEN 'null' WHEN 1 THEN '"' + STRING_ESCAPE(_uql_pull."value", 'json') + '"' ELSE _uql_pull."value" END, ',') + ']' FROM OPENJSON(CASE WHEN LEFT(JSON_QUERY("kind", '$.tags'), 1) = '[' THEN "kind" END, '$.tags') _uql_pull WHERE NOT (_uql_pull."value" = @p1 AND _uql_pull."type" = 1)), '[]') END IS NULL THEN '$._uql_skip' ELSE '$.tags' END, JSON_QUERY(CASE WHEN LEFT(JSON_QUERY("kind", '$.tags'), 1) = '[' THEN COALESCE((SELECT '[' + STRING_AGG(CASE _uql_pull."type" WHEN 0 THEN 'null' WHEN 1 THEN '"' + STRING_ESCAPE(_uql_pull."value", 'json') + '"' ELSE _uql_pull."value" END, ',') + ']' FROM OPENJSON(CASE WHEN LEFT(JSON_QUERY("kind", '$.tags'), 1) = '[' THEN "kind" END, '$.tags') _uql_pull WHERE NOT (_uql_pull."value" = @p1 AND _uql_pull."type" = 1)), '[]') END)), "updatedAt" = @p2 WHERE "id" = @p3`,
      values: ['a', 123, '1'],
    },
    addToSet: {
      sql: `UPDATE "Company" SET "kind" = JSON_MODIFY(COALESCE("kind", '{}'), CASE WHEN CASE WHEN (SELECT "value" FROM OPENJSON("kind", '$') WHERE "key" = N'tags') IS NULL OR LEFT(JSON_QUERY("kind", '$.tags'), 1) = '[' THEN JSON_MODIFY(CASE WHEN (SELECT "value" FROM OPENJSON("kind", '$') WHERE "key" = N'tags') IS NULL THEN '[]' ELSE (SELECT "value" FROM OPENJSON("kind", '$') WHERE "key" = N'tags') END, CASE WHEN EXISTS (SELECT 1 FROM OPENJSON(CASE WHEN LEFT(JSON_QUERY("kind", '$.tags'), 1) = '[' THEN "kind" END, '$.tags') _uql_elem WHERE _uql_elem."value" = @p1 AND _uql_elem."type" = 1) THEN '$._uql_skip' ELSE 'append $' END, @p2) END IS NULL THEN '$._uql_skip' ELSE '$.tags' END, JSON_QUERY(CASE WHEN (SELECT "value" FROM OPENJSON("kind", '$') WHERE "key" = N'tags') IS NULL OR LEFT(JSON_QUERY("kind", '$.tags'), 1) = '[' THEN JSON_MODIFY(CASE WHEN (SELECT "value" FROM OPENJSON("kind", '$') WHERE "key" = N'tags') IS NULL THEN '[]' ELSE (SELECT "value" FROM OPENJSON("kind", '$') WHERE "key" = N'tags') END, CASE WHEN EXISTS (SELECT 1 FROM OPENJSON(CASE WHEN LEFT(JSON_QUERY("kind", '$.tags'), 1) = '[' THEN "kind" END, '$.tags') _uql_elem WHERE _uql_elem."value" = @p1 AND _uql_elem."type" = 1) THEN '$._uql_skip' ELSE 'append $' END, @p2) END)), "updatedAt" = @p3 WHERE "id" = @p4`,
      values: ['x', 'x', 123, '1'],
    },
  };

  /** A table hint rather than a clause after the page, already bound to the table it follows, so no target. */
  protected override lockClause(wait: QueryLockWait = 'block'): string {
    return ` WITH (UPDLOCK, ROWLOCK${MSSQL_LOCK_WAITS[wait]})`;
  }

  override shouldBeValidEscapeCharacter() {
    expect(this.dialect.escapeIdChar).toBe('"');
  }

  override shouldBeginTransaction() {
    expect(this.dialect.beginTransactionCommand).toBe('BEGIN TRANSACTION');
    expect(this.dialect.commitTransactionCommand).toBe('COMMIT TRANSACTION');
    expect(this.dialect.rollbackTransactionCommand).toBe('ROLLBACK TRANSACTION');
    expect(this.dialect.getBeginTransactionStatements({ isolationLevel: 'serializable' })).toEqual([
      'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE',
      'BEGIN TRANSACTION',
    ]);
    expect(this.dialect.getBeginTransactionStatements({ readOnly: true })).toEqual(['BEGIN TRANSACTION']);
  }
  override shouldEstimatedCount() {
    const { sql, values } = this.exec((ctx) => this.dialect.estimatedCount(ctx, User));
    expect(sql).toContain('FROM sys.partitions p');
    expect(sql).toContain('p.index_id IN (0, 1)');
    // The connection's own default schema, which need not be `dbo`, where the entity names none.
    expect(sql).toContain('AND s.name = SCHEMA_NAME()');
    expect(values).toEqual(['User']);
  }

  /** An entity's own schema, bound, where it names one. */
  shouldEstimateTheCountOfATableInItsOwnSchema() {
    @Entity({ schema: 'sales' })
    class Order {
      @Field(f.number().id()) id?: number;
    }
    const { sql, values } = this.exec((ctx) => this.dialect.estimatedCount(ctx, Order));
    expect(sql).toContain(` AND s.name = ${this.ph(2)}`);
    expect(values).toEqual(['Order', 'sales']);
  }

  /** The hint precedes the page rather than following it, so the base ordering assertion inverts. */
  override shouldPlaceLockAfterLimitAndOffset() {
    const { sql } = this.exec((ctx) =>
      this.dialect.find(ctx, User, { $select: { id: true }, $limit: 10, $lock: true }),
    );
    expect(sql.indexOf('UPDLOCK')).toBeLessThan(sql.indexOf('FETCH NEXT'));
  }

  protected override emptyRowInsert(): string {
    return (
      'DECLARE @_uql_output TABLE ("id" BIGINT); INSERT INTO "InvoiceLine" OUTPUT INSERTED."id" "id" INTO @_uql_output' +
      ' DEFAULT VALUES; SET NOCOUNT ON; SELECT "id" FROM @_uql_output; SET NOCOUNT OFF;'
    );
  }

  override shouldInsertOne() {
    const { sql } = this.exec((ctx) =>
      this.dialect.insert(ctx, User, { name: 'Some Name', email: 'someemail@example.com', id: '123' }),
    );
    expect(sql).toBe(
      'DECLARE @_uql_output TABLE ("id" NVARCHAR(255)); ' +
        'INSERT INTO "User" ("name", "email", "id", "createdAt") OUTPUT INSERTED."id" "id" INTO @_uql_output' +
        ' VALUES (@p1, @p2, @p3, @p4); SET NOCOUNT ON; SELECT "id" FROM @_uql_output; SET NOCOUNT OFF;',
    );
  }

  override shouldInsertMany() {
    const { sql } = this.exec((ctx) =>
      this.dialect.insert(ctx, User, [
        { name: 'a', email: 'a@b.c', id: '1' },
        { name: 'b', email: 'b@b.c', id: '2' },
        { name: 'c', email: 'c@b.c', id: '3' },
      ]),
    );
    expect(sql).toBe(
      'DECLARE @_uql_output TABLE ("id" NVARCHAR(255)); ' +
        'INSERT INTO "User" ("name", "email", "id", "createdAt") OUTPUT INSERTED."id" "id" INTO @_uql_output' +
        ' VALUES (@p1, @p2, @p3, @p4), (@p5, @p6, @p7, @p8), (@p9, @p10, @p11, @p12); SET NOCOUNT ON; SELECT "id" FROM @_uql_output; SET NOCOUNT OFF;',
    );
  }

  /** A column absent from one record still binds `DEFAULT` in its slot. */
  override shouldInsertManyWithHeterogeneousColumns() {
    const { sql } = this.exec((ctx) =>
      this.dialect.insert(ctx, User, [
        { id: '1', name: 'a' },
        { id: '2', name: 'b', email: 'b@b.c' },
      ]),
    );
    expect(sql).toBe(
      'DECLARE @_uql_output TABLE ("id" NVARCHAR(255)); ' +
        'INSERT INTO "User" ("id", "name", "createdAt", "email") OUTPUT INSERTED."id" "id" INTO @_uql_output' +
        ' VALUES (@p1, @p2, @p3, DEFAULT), (@p4, @p5, @p6, @p7); SET NOCOUNT ON; SELECT "id" FROM @_uql_output; SET NOCOUNT OFF;',
    );
  }

  /** The key column is named by the entity, so `OUTPUT` aliases whatever it is back to `id`. */
  override shouldInsertWithOnInsertId() {
    const { sql } = this.exec((ctx) => this.dialect.insert(ctx, TaxCategory, { name: 'a' }));
    expect(sql).toContain(
      'INSERT INTO "TaxCategory" ("name", "createdAt", "pk") OUTPUT INSERTED."pk" "id" INTO @_uql_output VALUES (@p1, @p2, @p3);',
    );
  }

  override shouldInsertManyWithSpecifiedIdsAndOnInsertIdAsDefault() {
    const { sql } = this.exec((ctx) =>
      this.dialect.insert(ctx, TaxCategory, [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }]),
    );
    expect(sql).toContain(
      'INSERT INTO "TaxCategory" ("name", "createdAt", "pk") OUTPUT INSERTED."pk" "id" INTO @_uql_output' +
        ' VALUES (@p1, @p2, @p3), (@p4, @p5, @p6), (@p7, @p8, @p9), (@p10, @p11, @p12);',
    );
  }

  /**
   * `MERGE`, held under `HOLDLOCK` and terminated. `id` is assigned because this payload states one;
   * `createdAt` is not, being an `onInsert` field the row source fills rather than something the
   * caller asked to write. The update's own bind precedes the row source's in the text, which is
   * harmless here: the parameters are named, so the driver matches them by name and not by position.
   */
  override shouldUpsert() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.upsert(ctx, User, { $conflict: { email: true } }, { name: 'a', email: 'a@b.c', id: '1' }),
    );
    expect(sql).toBe(
      'MERGE INTO "User" WITH (HOLDLOCK) USING (VALUES (@p2, @p3, @p4, @p5)) AS "_uql_src"' +
        ' ("name", "email", "id", "createdAt") ON "User"."email" = "_uql_src"."email"' +
        ' WHEN MATCHED THEN UPDATE SET "name" = "_uql_src"."name", "updatedAt" = @p1' +
        ' WHEN NOT MATCHED THEN INSERT ("name", "email", "id", "createdAt")' +
        ' VALUES ("_uql_src"."name", "_uql_src"."email", "_uql_src"."id", "_uql_src"."createdAt");',
    );
    expect(values.length).toBe(5);
  }

  /** `OUTPUT` sits after the `SET` list, `INTO` a table its fields are then read off, whatever triggers the table has. */
  shouldReportAnUpdateThroughATableVariable() {
    const { sql } = this.exec((ctx) =>
      this.dialect.update(ctx, StockLevel, { $where: { warehouseId: 1 } }, { quantity: 2 }, undefined, ['quantity']),
    );
    expect(sql).toBe(
      'DECLARE @_uql_output TABLE ("quantity" BIGINT);' +
        ' UPDATE "StockLevel" SET "quantity" = @p1' +
        ' OUTPUT INSERTED."quantity" INTO @_uql_output ("quantity") WHERE "warehouseId" = @p2;' +
        ' SELECT "_uql_output"."quantity" FROM @_uql_output "_uql_output"',
    );
  }

  /** A JSON path in a MERGE's `$where` reads the target's column, which the source names too where the rows write it. */
  shouldQualifyAJsonPathOfAnUpsertWhere() {
    const { sql: statement } = this.exec((ctx) =>
      this.dialect.upsert(
        ctx,
        Reading,
        { $conflict: { id: true }, $where: { 'doc.name': 'a' } },
        { id: 'r', name: 'x', doc: { name: 'b' } },
      ),
    );
    expect(statement).toContain('OPENJSON("Reading"."doc", ');
  }

  /** A delete reports the rows as they were, off `DELETED`. */
  shouldReportADeleteOffTheDeletedRows() {
    const { sql } = this.exec((ctx) =>
      this.dialect.delete(ctx, StockLevel, { $where: { warehouseId: 1 } }, {}, ['productId']),
    );
    expect(sql).toBe(
      'DECLARE @_uql_output TABLE ("productId" BIGINT);' +
        ' DELETE FROM "StockLevel"' +
        ' OUTPUT DELETED."productId" INTO @_uql_output ("productId") WHERE "warehouseId" = @p1;' +
        ' SELECT "_uql_output"."productId" FROM @_uql_output "_uql_output"',
    );
  }

  /** The `MERGE`'s own terminator ends it before the read of what it reported, and none is doubled. */
  shouldReportAnUpsertThroughATableVariable() {
    const { sql } = this.exec((ctx) =>
      this.dialect.upsert(
        ctx,
        StockLevel,
        { $conflict: { warehouseId: true, productId: true } },
        { warehouseId: 1, productId: 2, quantity: 3 },
        ['quantity'],
      ),
    );
    expect(sql).toBe(
      'DECLARE @_uql_output TABLE ("quantity" BIGINT);' +
        ' MERGE INTO "StockLevel" WITH (HOLDLOCK) USING (VALUES (@p1, @p2, @p3)) AS "_uql_src" ("warehouseId", "productId", "quantity")' +
        ' ON "StockLevel"."warehouseId" = "_uql_src"."warehouseId" AND "StockLevel"."productId" = "_uql_src"."productId"' +
        ' WHEN MATCHED THEN UPDATE SET "quantity" = "_uql_src"."quantity"' +
        ' WHEN NOT MATCHED THEN INSERT ("warehouseId", "productId", "quantity") VALUES ("_uql_src"."warehouseId", "_uql_src"."productId", "_uql_src"."quantity")' +
        ' OUTPUT INSERTED."quantity" INTO @_uql_output ("quantity");' +
        ' SELECT "_uql_output"."quantity" FROM @_uql_output "_uql_output"',
    );
  }

  /** An inlined field reads its SQL off the table variable, so every stored column goes into it. */
  shouldReportAnInlinedFieldOffEveryStoredColumn() {
    const { sql } = this.exec((ctx) => this.dialect.delete(ctx, Shout, { $where: { id: 1 } }, {}, ['shout']));
    expect(sql).toContain(
      'OUTPUT DELETED."id", DELETED."first", DELETED."age" INTO @_uql_output ("id", "first", "age")',
    );
  }

  /** `MERGE` matches a found row only where `$where` holds of it too. */
  shouldUpsertOnlyWhereTheFoundRowMatches() {
    const { sql } = this.exec((ctx) =>
      this.dialect.upsert(
        ctx,
        Tax,
        { $conflict: { id: true }, $where: { percentage: { $lt: 20 } } },
        { id: 'a', name: 'x', percentage: 1 },
      ),
    );
    expect(sql).toContain(
      'ON "Tax"."id" = "_uql_src"."id" WHEN MATCHED AND "Tax"."percentage" < @p2 THEN UPDATE SET "name" = "_uql_src"."name", ' +
        '"percentage" = "_uql_src"."percentage", "updatedAt" = @p1 WHEN NOT MATCHED THEN INSERT',
    );
  }

  override shouldUpsertMany() {
    const { sql } = this.exec((ctx) =>
      this.dialect.upsert(ctx, User, { $conflict: { email: true } }, [
        { name: 'a', email: 'a@b.c', id: '1' },
        { name: 'b', email: 'b@b.c', id: '2' },
      ]),
    );
    expect(sql).toContain('USING (VALUES (@p2, @p3, @p4, @p5), (@p6, @p7, @p8, @p9))');
    expect(
      sql.endsWith('VALUES ("_uql_src"."name", "_uql_src"."email", "_uql_src"."id", "_uql_src"."createdAt");'),
    ).toBe(true);
  }

  /** A function, not an operator - and 2025 at compatibility level 170, which the server enforces. */
  override shouldFind$regex() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, User, { $select: { id: true }, $where: { name: { $regex: '^a' } } }),
    );
    expect(sql).toBe('SELECT "id" FROM "User" WHERE REGEXP_LIKE("name", @p1)');
    expect(values).toEqual(['^a']);
  }

  /** Full-text needs a catalogue this does not create, so `$text` is refused the way SQLite's is. */
  override shouldFind$text() {
    expect(() => this.exec((ctx) => this.dialect.find(ctx, Item, { $where: { $text: { $value: 'a' } } }))).toThrow(
      'does not support $text',
    );
  }

  /** Only the search-less case reaches the sort: a `$text` anywhere is refused first, as above. */
  override shouldRefuseToSortBy$textWithoutARootSearch() {
    expect(() => this.exec((ctx) => this.dialect.find(ctx, Item, { $sort: { $text: 'desc' } }))).toThrow(
      '$sort by $text ranks by the $text at the root of $where, which this query has none of',
    );
  }

  override shouldQualify$textColumnsUnderAJoin() {
    this.shouldFind$text();
  }

  override shouldProject$textRelevance() {
    expect(() =>
      this.exec((ctx) =>
        this.dialect.find(ctx, Item, {
          $where: { $text: { $fields: { name: true }, $value: 'a' } },
          $sort: { $text: { $project: 'score' } },
        }),
      ),
    ).toThrow('does not support $text');
  }

  override shouldRefuseToProject$textRelevanceOverAField() {
    this.shouldProject$textRelevance();
  }

  override shouldSortBy$textRelevance() {
    expect(() =>
      this.exec((ctx) =>
        this.dialect.find(ctx, Item, { $where: { $text: { $value: 'a' } }, $sort: { $text: 'desc' } }),
      ),
    ).toThrow('does not support $text');
  }

  /**
   * `JSON_MODIFY` deletes a key it is handed NULL, so a `$set` of null cannot be expressed. The
   * types already refuse one; `/http` casts client JSON straight to a payload, so it gets here.
   */
  shouldRefuseAJsonSetOfNull() {
    expect(() =>
      this.exec((ctx) =>
        // @ts-expect-error: a JSON key takes no `null`
        this.dialect.update(ctx, Company, { $where: { id: '1' } }, { kind: { $set: { private: null } } }),
      ),
    ).toThrow('cannot $set');
  }

  /** The insert reports its generated id through `OUTPUT`, which the base case has no clause for. */
  override shouldBeSecure() {
    const { sql } = this.exec((ctx) => this.dialect.insert(ctx, User, { name: 'a', id: '1' }));
    expect(sql).toContain('OUTPUT INSERTED."id" "id" INTO @_uql_output VALUES');
  }

  // A table carrying a trigger refuses an `OUTPUT` straight to the client, so the id always goes through a table.
  shouldReadTheIdBackThroughATableVariableTypedAsTheKey() {
    const { sql } = this.exec((ctx) => this.dialect.insert(ctx, Invoice, { description: 'a' }));
    expect(sql.startsWith('DECLARE @_uql_output TABLE ("id" BIGINT); INSERT INTO "Invoice"')).toBe(true);
    expect(sql.endsWith('; SET NOCOUNT ON; SELECT "id" FROM @_uql_output; SET NOCOUNT OFF;')).toBe(true);
  }

  shouldReadNoIdBackOnACompositeKey() {
    const { sql } = this.exec((ctx) =>
      this.dialect.insert(ctx, StockLevel, { warehouseId: 1, productId: 2, quantity: 3 }),
    );
    expect(sql).not.toContain('OUTPUT');
    expect(sql).not.toContain('DECLARE');
  }

  /**
   * A scalar path is read through `OPENJSON`, not `JSON_VALUE`: that returns `NVARCHAR(4000)` and in
   * lax mode - the default - answers NULL rather than erroring for anything longer.
   */
  shouldReadAJsonPathThroughOpenJson() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, Company, { $select: { id: true }, $where: { 'kind.private': 1 } }),
    );
    // A numeric operand reads the path as a number, which is what `TRY_CAST` is doing here.
    expect(sql).toBe(
      'SELECT "id" FROM "Company" WHERE TRY_CAST((SELECT "value" FROM OPENJSON("kind", \'$\')' +
        ' WHERE "key" = N\'private\') AS FLOAT) = TRY_CAST(@p1 AS FLOAT)',
    );
    expect(values).toEqual([1]);
  }

  /** Zero rows is `TOP (0)` here: `FETCH NEXT 0 ROWS ONLY` is rejected outright. */
  override shouldFind$limitZero() {
    const { sql } = this.exec((ctx) => this.dialect.find(ctx, User, { $select: { id: true }, $limit: 0 }));
    expect(sql).toBe('SELECT TOP (0) "id" FROM "User"');
  }

  /** A JSON array is exploded with `OPENJSON`, which is also what counts it. */
  shouldCountJsonArrayElements() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, Company, { $select: { id: true }, $where: { 'kind.tags': { $size: 2 } } }),
    );
    expect(sql).toBe(
      `SELECT "id" FROM "Company" WHERE (SELECT COUNT(*) FROM OPENJSON(CASE WHEN LEFT(JSON_QUERY("kind", '$.tags'), 1) = '[' THEN "kind" END, '$.tags')) = @p1`,
    );
    expect(values).toEqual([2]);
  }

  /** Containment is one `EXISTS` per value, an exploded element reading as text and its `type` telling `'5'` from `5`. */
  shouldMatchEveryValueOfAJsonArray() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, Company, { $select: { id: true }, $where: { 'kind.tags': { $all: ['a', 'b'] } } }),
    );
    expect(sql).toContain(
      `EXISTS (SELECT 1 FROM OPENJSON(CASE WHEN LEFT(JSON_QUERY("kind", '$.tags'), 1) = '[' THEN "kind" END, '$.tags') _uql_elem WHERE _uql_elem."value" = @p1 AND _uql_elem."type" = 1)`,
    );
    expect(sql).toContain(' AND EXISTS');
    expect(values).toEqual(['a', 'b']);
  }

  /** A field of an element is read as any path is, through `OPENJSON`, which has no 4000-character bound. */
  shouldMatchAJsonArrayElementByItsFields() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $where: { 'kind.items': { $elemMatch: { name: 'a' } } },
      }),
    );
    expect(sql).toBe(
      'SELECT "id" FROM "Company" WHERE EXISTS (SELECT 1 FROM' +
        ` OPENJSON(CASE WHEN LEFT(JSON_QUERY("kind", '$.items'), 1) = '[' THEN "kind" END, '$.items') _uql_elem` +
        ` WHERE (SELECT "value" FROM OPENJSON(_uql_elem."value", '$') WHERE "key" = N'name') = @p1)`,
    );
    expect(values).toEqual(['a']);
  }

  /** Writing a key the engine would have generated is refused unless the session allows it. */
  shouldToggleIdentityInsertForAnExplicitKey() {
    const { sql } = this.exec((ctx) => this.dialect.insert(ctx, Invoice, { id: 5, description: 'a' }));
    expect(sql).toContain('SET IDENTITY_INSERT "Invoice" ON; INSERT INTO "Invoice"');
    expect(sql).toContain('; SET IDENTITY_INSERT "Invoice" OFF;');
  }

  // A `MERGE` naming an identity key inserts it too, where the engine refuses it just the same.
  shouldToggleIdentityInsertForAnUpsertNamingAKey() {
    const { sql } = this.exec((ctx) =>
      this.dialect.upsert(ctx, Invoice, { $conflict: { id: true } }, { id: 5, description: 'a' }),
    );
    expect(sql).toContain('SET IDENTITY_INSERT "Invoice" ON; MERGE INTO "Invoice"');
    expect(sql).toContain('; SET IDENTITY_INSERT "Invoice" OFF;');
  }

  shouldNotToggleIdentityInsertWhenTheEngineFillsTheKey() {
    const { sql } = this.exec((ctx) => this.dialect.insert(ctx, Invoice, { description: 'a' }));
    expect(sql).not.toContain('IDENTITY_INSERT');
  }

  /** A key the application fills is not an identity column, so nothing has to be toggled for it. */
  shouldNotToggleIdentityInsertForAnApplicationFilledKey() {
    const { sql } = this.exec((ctx) => this.dialect.insert(ctx, User, { id: '1', name: 'a' }));
    expect(sql).not.toContain('IDENTITY_INSERT');
  }

  /** `tedious` decodes DECIMAL to a JS number, so an exact one has to cross the wire as text. */
  shouldReadAStringDeclaredDecimalAsText() {
    const { sql } = this.exec((ctx) => this.dialect.find(ctx, TypedRow, { $select: { exact: true } }));
    expect(sql).toContain('CONVERT(NVARCHAR(41), "exact")');
  }

  shouldEscapeAStringLiteralAsUnicode() {
    expect(this.dialect.escape('añ')).toBe("N'añ'");
    expect(this.dialect.escape("it's")).toBe("N'it''s'");
  }

  /** Binary has no quoted form here; `0x...` is the literal the engine reads back as `VARBINARY`. */
  shouldEscapeBinaryAsAHexLiteral() {
    expect(this.dialect.escape(new Uint8Array([0, 15, 255]))).toBe('0x000fff');
    expect(this.dialect.escape(42)).toBe('42');
  }

  /** The schema statement is a catalogue check, since there is no `CREATE SCHEMA IF NOT EXISTS`. */
  shouldCreateASchemaOnlyWhenAbsent() {
    expect(this.dialect.createSchemaSql('crm')).toBe(`IF SCHEMA_ID(N'crm') IS NULL EXEC(N'CREATE SCHEMA "crm"')`);
  }

  /** Given no trigger rows to read, a refusal and an upsert stand alone rather than guard on or read from them. */
  shouldWriteATriggerBodyWithNoRowsToRead() {
    const refusal = this.dialect.createContext();
    this.dialect.triggerWrite(refusal, { kind: 'refuse', message: 'closed' });
    expect(refusal.sql).toBe("THROW 50000, N'closed', 1;");

    const upsert = this.dialect.createContext();
    this.dialect.triggerWrite(upsert, {
      kind: 'upsert',
      entity: Enrolment,
      q: { $conflict: { studentId: true, courseId: true } },
      row: { studentId: 1, courseId: 2, grade: 'A' },
    });
    expect(upsert.sql).toBe(
      'MERGE INTO "Enrolment" WITH (HOLDLOCK) USING (SELECT @p1, @p2, @p3) AS "_uql_src" ("studentId", "courseId", "grade")' +
        ' ON "Enrolment"."studentId" = "_uql_src"."studentId" AND "Enrolment"."courseId" = "_uql_src"."courseId"' +
        ' WHEN MATCHED THEN UPDATE SET "grade" = "_uql_src"."grade"' +
        ' WHEN NOT MATCHED THEN INSERT ("studentId", "courseId", "grade") VALUES ("_uql_src"."studentId", "_uql_src"."courseId", "_uql_src"."grade");',
    );
  }

  /** `OUTPUT` names one id column, so a composite key merges with nothing to report. */
  shouldMergeACompositeKeyWithNoOutputClause() {
    const ctx = this.dialect.createContext();
    this.dialect.upsert(
      ctx,
      Enrolment,
      { $conflict: { studentId: true, courseId: true } },
      { studentId: 1, courseId: 2, grade: 'A' },
    );
    expect(ctx.sql).not.toContain('OUTPUT');
    expect(ctx.sql).toMatch(/;$/);
  }

  /** Outside the types, which give a JSON key no `sql()`: rendered in place rather than bound as an object. */
  shouldSetAJsonKeyToARawExpression() {
    const res = this.exec((ctx) =>
      this.dialect.update(
        ctx,
        Company,
        { $where: { id: '1' } },
        {
          // @ts-expect-error: a JSON key takes no `sql`
          kind: { $set: { private: sql`1 + ${1}` } },
        },
      ),
    );
    expect(res.sql).toContain("'$.private', 1 + @p1)");
    expect(res.values).toEqual([1, expect.any(Number), '1']);
  }

  /**
   * The rows read as they are, `FOR JSON PATH` making the array: a number crosses as its exact text,
   * and the page is the engine's own `OFFSET ... FETCH`. A row with no joined column keeps its nulls.
   */
  shouldReadAToManyForJson() {
    const { sql } = this.exec((ctx) =>
      this.dialect.find(ctx, MeasureUnitCategory, {
        $select: { name: true },
        $populate: { measureUnits: { $select: { name: true, createdAt: true }, $sort: { name: 1 }, $limit: 5 } },
      }),
    );

    expect(sql).toBe(
      'SELECT "MeasureUnitCategory"."name", JSON_QUERY(COALESCE((SELECT "measureUnits"."name",' +
        ' CONVERT(VARCHAR(40), "measureUnits"."createdAt", 3) "createdAt" FROM "MeasureUnit" "measureUnits"' +
        ' WHERE "measureUnits"."categoryId" = "MeasureUnitCategory"."id" AND "measureUnits"."deletedAt" IS NULL' +
        ` ORDER BY "measureUnits"."name" OFFSET 0 ROWS FETCH NEXT 5 ROWS ONLY FOR JSON PATH, INCLUDE_NULL_VALUES), '[]')) "measureUnits"` +
        ' FROM "MeasureUnitCategory" WHERE "MeasureUnitCategory"."deletedAt" IS NULL',
    );
  }

  /**
   * `FOR JSON PATH` nests a joined row under its path and leaves its nulls out, which is what
   * unflattening a row with a joined column does - so such a row leaves every null out.
   */
  shouldLeaveNullsOutWhereARowNestsAJoin() {
    const { sql } = this.exec((ctx) =>
      this.dialect.find(ctx, MeasureUnitCategory, {
        $select: { name: true },
        $populate: { measureUnits: { $select: { name: true }, $populate: { category: { $select: { name: true } } } } },
      }),
    );

    expect(sql).toBe(
      'SELECT "MeasureUnitCategory"."name", JSON_QUERY(COALESCE((SELECT "measureUnits"."name", "category"."id" "category.id",' +
        ' "category"."name" "category.name" FROM "MeasureUnit" "measureUnits" LEFT JOIN "MeasureUnitCategory" "category"' +
        ' ON "category"."id" = "measureUnits"."categoryId" AND "category"."deletedAt" IS NULL' +
        ' WHERE "measureUnits"."categoryId" = "MeasureUnitCategory"."id" AND "measureUnits"."deletedAt" IS NULL' +
        ` FOR JSON PATH), '[]')) "measureUnits" FROM "MeasureUnitCategory" WHERE "MeasureUnitCategory"."deletedAt" IS NULL`,
    );
  }
}

@Entity()
class Enrolment {
  [idKey]?: 'studentId' | 'courseId';
  @Field(f.number().id()) studentId?: number;
  @Field(f.number().id()) courseId?: number;
  @Field(f.string().nullable()) grade?: string | null;
}

createSpec(new MsSqlDialectSpec());
