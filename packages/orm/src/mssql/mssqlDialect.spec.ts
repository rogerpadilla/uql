import { expect } from 'vitest';
import { AbstractSqlDialectSpec, type JsonUpdateCaseName } from '../dialect/abstractSqlDialect-spec.js';
import { Entity, Field, Id } from '../entity/index.js';
import { Company, createSpec, Invoice, Item, MeasureUnitCategory, TaxCategory, TypedRow, User } from '../test/index.js';
import { idKey, type QueryLockWait } from '../type/index.js';
import { raw } from '../util/index.js';
import { MsSqlDialect } from './mssqlDialect.js';

/**
 * SQL Server's share of the shared dialect spec. What it overrides is what T-SQL genuinely spells
 * differently - the lock, the returning clause, the upsert and the JSON operators - which is the
 * same shape `PgFamilySpec` has for the Postgres family.
 */
const MSSQL_LOCK_WAITS: Readonly<Record<QueryLockWait, string>> = { block: '', skip: ', READPAST', nowait: ', NOWAIT' };

class MsSqlDialectSpec extends AbstractSqlDialectSpec {
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
    setUnsetCombined: {
      sql: 'UPDATE "Company" SET "kind" = JSON_MODIFY(JSON_MODIFY(COALESCE("kind", \'{}\'), \'$.private\', @p1), \'$.public\', NULL), "updatedAt" = @p2 WHERE "id" = @p3',
      values: [1, 123, '1'],
    },
    push: {
      sql: 'UPDATE "Company" SET "kind" = JSON_MODIFY(COALESCE("kind", \'{}\'), \'append $.tags\', @p1), "updatedAt" = @p2 WHERE "id" = @p3',
      values: ['new-tag', 123, '1'],
    },
    pull: {
      sql: 'UPDATE "Company" SET "kind" = CASE WHEN LEFT(JSON_QUERY("kind", \'$.tags\'), 1) = \'[\' THEN JSON_MODIFY("kind", \'$.tags\', JSON_QUERY(COALESCE((SELECT \'[\' + STRING_AGG(CASE _uql_pull."type" WHEN 0 THEN \'null\' WHEN 1 THEN \'"\' + STRING_ESCAPE(_uql_pull."value", \'json\') + \'"\' ELSE _uql_pull."value" END, \',\') + \']\' FROM OPENJSON(CASE WHEN LEFT(JSON_QUERY("kind", \'$.tags\'), 1) = \'[\' THEN "kind" END, \'$.tags\') _uql_pull WHERE _uql_pull."value" IS NULL OR _uql_pull."value" <> @p1), \'[]\'))) ELSE "kind" END, "updatedAt" = @p2 WHERE "id" = @p3',
      values: ['a', 123, '1'],
    },
    pullPushSameKey: {
      sql: "UPDATE \"Company\" SET \"kind\" = JSON_MODIFY(COALESCE(CASE WHEN LEFT(JSON_QUERY(\"kind\", '$.tags'), 1) = '[' THEN JSON_MODIFY(\"kind\", '$.tags', JSON_QUERY(COALESCE((SELECT '[' + STRING_AGG(CASE _uql_pull.\"type\" WHEN 0 THEN 'null' WHEN 1 THEN '\"' + STRING_ESCAPE(_uql_pull.\"value\", 'json') + '\"' ELSE _uql_pull.\"value\" END, ',') + ']' FROM OPENJSON(CASE WHEN LEFT(JSON_QUERY(\"kind\", '$.tags'), 1) = '[' THEN \"kind\" END, '$.tags') _uql_pull WHERE _uql_pull.\"value\" IS NULL OR _uql_pull.\"value\" <> @p1), '[]'))) ELSE \"kind\" END, '{}'), 'append $.tags', @p2), \"updatedAt\" = @p3 WHERE \"id\" = @p4",
      values: ['a', 'b', 123, '1'],
    },
    setPushCombined: {
      sql: 'UPDATE "Company" SET "kind" = JSON_MODIFY(COALESCE(JSON_MODIFY(COALESCE("kind", \'{}\'), \'$.private\', @p1), \'{}\'), \'append $.tags\', @p2), "updatedAt" = @p3 WHERE "id" = @p4',
      values: [1, 'new-tag', 123, '1'],
    },
    setPushSameKey: {
      sql: 'UPDATE "Company" SET "kind" = JSON_MODIFY(COALESCE(JSON_MODIFY(COALESCE("kind", \'{}\'), \'$.tags\', JSON_QUERY(@p1)), \'{}\'), \'append $.tags\', @p2), "updatedAt" = @p3 WHERE "id" = @p4',
      values: ['["a"]', 'b', 123, '1'],
    },
    pushUnsetCombined: {
      sql: 'UPDATE "Company" SET "kind" = JSON_MODIFY(JSON_MODIFY(COALESCE("kind", \'{}\'), \'append $.tags\', @p1), \'$.public\', NULL), "updatedAt" = @p2 WHERE "id" = @p3',
      values: ['new-tag', 123, '1'],
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
    expect(this.dialect.getBeginTransactionStatements('serializable')).toEqual([
      'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE',
      'BEGIN TRANSACTION',
    ]);
  }

  override shouldEstimatedCount() {
    const { sql, values } = this.exec((ctx) => this.dialect.estimatedCount(ctx, User));
    expect(sql).toContain('FROM sys.partitions p');
    expect(sql).toContain('p.index_id IN (0, 1)');
    expect(values).toEqual(['User', 'dbo']);
  }

  /** The hint precedes the page rather than following it, so the base ordering assertion inverts. */
  override shouldPlaceLockAfterLimitAndOffset() {
    const { sql } = this.exec((ctx) =>
      this.dialect.find(ctx, User, { $select: { id: true }, $limit: 10, $lock: true }),
    );
    expect(sql.indexOf('UPDLOCK')).toBeLessThan(sql.indexOf('FETCH NEXT'));
  }

  override shouldInsertOne() {
    const { sql } = this.exec((ctx) =>
      this.dialect.insert(ctx, User, { name: 'Some Name', email: 'someemail@example.com', id: '123' }),
    );
    expect(sql).toBe(
      'INSERT INTO "User" ("name", "email", "id", "createdAt") OUTPUT INSERTED."id" "id"' +
        ' VALUES (@p1, @p2, @p3, @p4)',
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
      'INSERT INTO "User" ("name", "email", "id", "createdAt") OUTPUT INSERTED."id" "id"' +
        ' VALUES (@p1, @p2, @p3, @p4), (@p5, @p6, @p7, @p8), (@p9, @p10, @p11, @p12)',
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
      'INSERT INTO "User" ("id", "name", "createdAt", "email") OUTPUT INSERTED."id" "id"' +
        ' VALUES (@p1, @p2, @p3, DEFAULT), (@p4, @p5, @p6, @p7)',
    );
  }

  /** The key column is named by the entity, so `OUTPUT` aliases whatever it is back to `id`. */
  override shouldInsertWithOnInsertId() {
    const { sql } = this.exec((ctx) => this.dialect.insert(ctx, TaxCategory, { name: 'a' }));
    expect(sql).toBe(
      'INSERT INTO "TaxCategory" ("name", "createdAt", "pk") OUTPUT INSERTED."pk" "id" VALUES (@p1, @p2, @p3)',
    );
  }

  override shouldInsertManyWithSpecifiedIdsAndOnInsertIdAsDefault() {
    const { sql } = this.exec((ctx) =>
      this.dialect.insert(ctx, TaxCategory, [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }]),
    );
    expect(sql).toBe(
      'INSERT INTO "TaxCategory" ("name", "createdAt", "pk") OUTPUT INSERTED."pk" "id"' +
        ' VALUES (@p1, @p2, @p3), (@p4, @p5, @p6), (@p7, @p8, @p9), (@p10, @p11, @p12)',
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
      this.dialect.upsert(ctx, User, { email: true }, { name: 'a', email: 'a@b.c', id: '1' }),
    );
    expect(sql).toBe(
      'MERGE INTO "User" WITH (HOLDLOCK) USING (VALUES (@p2, @p3, @p4, @p5)) AS "_uql_src"' +
        ' ("name", "email", "id", "createdAt") ON "User"."email" = "_uql_src"."email"' +
        ' WHEN MATCHED THEN UPDATE SET "name" = "_uql_src"."name", "id" = "_uql_src"."id",' +
        ' "updatedAt" = @p1' +
        ' WHEN NOT MATCHED THEN INSERT ("name", "email", "id", "createdAt")' +
        ' VALUES ("_uql_src"."name", "_uql_src"."email", "_uql_src"."id", "_uql_src"."createdAt")' +
        ' OUTPUT INSERTED."id" "id";',
    );
    expect(values.length).toBe(5);
  }

  override shouldUpsertMany() {
    const { sql } = this.exec((ctx) =>
      this.dialect.upsert(ctx, User, { email: true }, [
        { name: 'a', email: 'a@b.c', id: '1' },
        { name: 'b', email: 'b@b.c', id: '2' },
      ]),
    );
    expect(sql).toContain('USING (VALUES (@p2, @p3, @p4, @p5), (@p6, @p7, @p8, @p9))');
    expect(sql.endsWith(' OUTPUT INSERTED."id" "id";')).toBe(true);
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
    expect(sql).toContain('OUTPUT INSERTED."id" "id" VALUES');
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
    expect(sql.startsWith('SET IDENTITY_INSERT "Invoice" ON; INSERT INTO "Invoice"')).toBe(true);
    expect(sql.endsWith('; SET IDENTITY_INSERT "Invoice" OFF')).toBe(true);
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

  /** `OUTPUT` names one id column, so a composite key merges with nothing to report. */
  shouldMergeACompositeKeyWithNoOutputClause() {
    const ctx = this.dialect.createContext();
    this.dialect.upsert(ctx, Enrolment, { studentId: true, courseId: true }, { studentId: 1, courseId: 2, grade: 'A' });
    expect(ctx.sql).not.toContain('OUTPUT');
    expect(ctx.sql).toMatch(/;$/);
  }

  /** Outside the types, which give a JSON key no `raw()`: rendered in place rather than bound as an object. */
  shouldSetAJsonKeyToARawExpression() {
    const res = this.exec((ctx) =>
      this.dialect.update(
        ctx,
        Company,
        { $where: { id: '1' } },
        {
          // @ts-expect-error: a JSON key takes no `raw`
          kind: { $set: { private: raw`1 + ${1}` } },
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
  @Id({ type: Number }) studentId?: number;
  @Id({ type: Number }) courseId?: number;
  @Field({ type: String }) grade?: string | null;
}

createSpec(new MsSqlDialectSpec());
