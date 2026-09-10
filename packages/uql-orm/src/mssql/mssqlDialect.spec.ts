import { expect } from 'vitest';
import { AbstractSqlDialectSpec, type JsonUpdateCaseName } from '../dialect/abstractSqlDialect-spec.js';
import { Company, createSpec, Invoice, Item, TaxCategory, TypedRow, User } from '../test/index.js';
import type { QueryLockWait } from '../type/index.js';
import { MsSqlDialect } from './mssqlDialect.js';

/**
 * SQL Server's share of the shared dialect spec. What it overrides is what T-SQL genuinely spells
 * differently - the lock, the returning clause, the upsert and the JSON operators - which is the
 * same shape `PgFamilySpec` has for the Postgres family.
 */
class MsSqlDialectSpec extends AbstractSqlDialectSpec {
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
      sql: 'UPDATE "Company" SET "kind" = CASE WHEN JSON_QUERY("kind", \'$.tags\') IS NULL THEN "kind" ELSE JSON_MODIFY("kind", \'$.tags\', JSON_QUERY(COALESCE((SELECT \'[\' + STRING_AGG(CASE _uql_elem_1."type" WHEN 0 THEN \'null\' WHEN 1 THEN \'"\' + STRING_ESCAPE(_uql_elem_1."value", \'json\') + \'"\' ELSE _uql_elem_1."value" END, \',\') + \']\' FROM OPENJSON("kind", \'$.tags\') _uql_elem_1 WHERE _uql_elem_1."value" IS NULL OR _uql_elem_1."value" <> @p1), \'[]\'))) END, "updatedAt" = @p2 WHERE "id" = @p3',
      values: ['a', 123, '1'],
    },
    pullPushSameKey: {
      sql: 'UPDATE "Company" SET "kind" = JSON_MODIFY(COALESCE(CASE WHEN JSON_QUERY("kind", \'$.tags\') IS NULL THEN "kind" ELSE JSON_MODIFY("kind", \'$.tags\', JSON_QUERY(COALESCE((SELECT \'[\' + STRING_AGG(CASE _uql_elem_1."type" WHEN 0 THEN \'null\' WHEN 1 THEN \'"\' + STRING_ESCAPE(_uql_elem_1."value", \'json\') + \'"\' ELSE _uql_elem_1."value" END, \',\') + \']\' FROM OPENJSON("kind", \'$.tags\') _uql_elem_1 WHERE _uql_elem_1."value" IS NULL OR _uql_elem_1."value" <> @p1), \'[]\'))) END, \'{}\'), \'append $.tags\', @p2), "updatedAt" = @p3 WHERE "id" = @p4',
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

  /**
   * A lock is a hint on the table rather than a clause after the page. `of` is unused: the hint
   * already binds to the table it follows, which is the narrowing `FOR UPDATE OF` spells out.
   */
  protected override lockClause(wait: QueryLockWait = 'block', _of?: string): string | undefined {
    const extra = wait === 'skip' ? ', READPAST' : wait === 'nowait' ? ', NOWAIT' : '';
    return ` WITH (UPDLOCK, ROWLOCK${extra})`;
  }

  override shouldBeValidEscapeCharacter() {
    expect(this.dialect.escapeIdChar).toBe('"');
  }

  override shouldBeginTransaction() {
    expect(this.dialect.beginTransactionCommand).toBe('BEGIN TRANSACTION');
    expect(this.dialect.commitTransactionCommand).toBe('COMMIT TRANSACTION');
    expect(this.dialect.rollbackTransactionCommand).toBe('ROLLBACK TRANSACTION');
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

  /**
   * `JSON_MODIFY` deletes a key it is handed NULL, so a `$set` of null cannot be expressed. The
   * types already refuse one; `/http` casts client JSON straight to a payload, so it gets here.
   */
  shouldRefuseAJsonSetOfNull() {
    expect(() =>
      this.exec((ctx) =>
        this.dialect.update(ctx, Company, { $where: { id: '1' } }, { kind: { $set: { private: null } } } as never),
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
        ' WHERE "key" = N\'private\') AS FLOAT) = @p1',
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
      `SELECT "id" FROM "Company" WHERE (SELECT COUNT(*) FROM OPENJSON((SELECT "value" FROM OPENJSON("kind", '$') WHERE "key" = N'tags')) _uql_elem_1) = @p1`,
    );
    expect(values).toEqual([2]);
  }

  /** Containment is one `EXISTS` per value, since an exploded element compares as text here. */
  shouldMatchEveryValueOfAJsonArray() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, Company, { $select: { id: true }, $where: { 'kind.tags': { $all: ['a', 'b'] } } }),
    );
    expect(sql).toContain(
      `EXISTS (SELECT 1 FROM OPENJSON((SELECT "value" FROM OPENJSON("kind", '$') WHERE "key" = N'tags')) _uql_elem_1 WHERE _uql_elem_1."value" = @p1)`,
    );
    expect(sql).toContain(' AND EXISTS');
    expect(values).toEqual(['a', 'b']);
  }

  shouldMatchAJsonArrayElementByItsFields() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $where: { 'kind.items': { $elemMatch: { name: 'a' } } },
      }),
    );
    expect(sql).toBe(
      'SELECT "id" FROM "Company" WHERE EXISTS (SELECT 1 FROM' +
        ` OPENJSON((SELECT "value" FROM OPENJSON("kind", '$') WHERE "key" = N'items')) _uql_elem_1` +
        ` WHERE JSON_VALUE(_uql_elem_1."value", '$.name') = @p1)`,
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
}

createSpec(new MsSqlDialectSpec());
