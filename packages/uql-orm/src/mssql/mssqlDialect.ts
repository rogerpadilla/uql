import { COUNT_ALIAS, JSON_ELEM_ALIAS_PREFIX } from '../dialect/aliases.js';
import { jsonPath } from '../dialect/jsonSql.js';
import { MergeSqlDialect } from '../dialect/mergeSqlDialect.js';
import { getMeta } from '../entity/index.js';
import { fieldOptionsToCanonical } from '../schema/canonicalType.js';
import { QueryRaw } from '../type/index.js';
import type {
  DialectFeatures,
  EntityMeta,
  FieldOptions,
  InsertIdSource,
  Query,
  QueryContext,
  QueryOptions,
  QueryPager,
  QuerySizeComparisonOps,
  Type,
  VectorDistance,
  VectorMetric,
} from '../type/index.js';
import { parseQueryLock } from '../type/index.js';
import { isAutoIncrement } from '../util/field.util.js';
import { assertNonNegativeInteger } from '../util/index.js';
import { escapeSingleQuotes } from '../util/sqlLiteral.js';

/**
 * Microsoft SQL Server 2017 and up - the floor `STRING_AGG` sets, every other construct here being
 * 2016 or older.
 *
 * Identifiers are `"`-quoted rather than bracketed: `escapeIdChar` is one character that doubles to
 * escape itself, `"` is the ANSI spelling, and `tedious` enables `QUOTED_IDENTIFIER` by default.
 * Brackets would buy nothing and cost the shared dialect spec, which reads that one character.
 */
export class MsSqlDialect extends MergeSqlDialect {
  protected override readonly featureDefaults: DialectFeatures = {
    explicitJsonCast: false,
    nativeArrays: false,
    supportsJsonb: false,
    // Neither object takes an `IF NOT EXISTS`; both need a `sys` catalogue lookup around them, which
    // the generator does not emit.
    ifNotExists: false,
    indexIfNotExists: false,
    schemas: true,
    dropTableCascade: false,
    foreignKeyAlter: true,
    primaryKeyAlter: true,
    generatedColumnAdd: true,
    // Extended properties are out-of-band metadata with their own procedures, not comments.
    commentSyntax: 'none',
    vectorIndexRequiresNotNull: false,
    vectorSupportsLength: true,
    supportsTimestamptz: false,
    stringSizing: 'varchar',
    supportsUnsigned: false,
    serverSideCursors: false,
  };

  override readonly dialectName = 'mssql';

  /** `OPENJSON`'s own output columns, which every JSON operator below reads through. */
  readonly #elem = {
    value: this.escapeId('value'),
    key: this.escapeId('key'),
    type: this.escapeId('type'),
  };

  override readonly autoIncrementSuffix = 'IDENTITY(1,1)';

  override readonly tableOptions = '';

  override readonly beginTransactionCommand = 'BEGIN TRANSACTION';

  override readonly commitTransactionCommand = 'COMMIT TRANSACTION';

  override readonly rollbackTransactionCommand = 'ROLLBACK TRANSACTION';

  /**
   * The level rides the `BEGIN` rather than preceding it as its own statement: a `SET TRANSACTION
   * ISOLATION LEVEL` sent on its own would go to whichever pooled connection served it, not the one
   * the transaction opens on, and would then stick to that connection for unrelated later queries.
   * `MsSqlQuerier` reads the level back off this command and hands it to the driver.
   */
  override readonly isolationLevelStrategy = 'inline';

  override readonly dropIndexSyntax = 'on-table';

  override readonly booleanLiteral = 'integer';

  /** [The hard server limit](https://github.com/yiisoft/yii2/issues/10371), not a driver preference. */
  override readonly maxBindValues = 2100;

  /** `OUTPUT` has no trailing form: it sits between the column list and `VALUES`. */
  override readonly returningPosition = 'after-target';

  override readonly insertIdSource: InsertIdSource = 'returning';

  /** Holds the update key lock across the insert; without it two concurrent upserts of one key race. */
  protected override readonly mergeTargetHint = ' WITH (HOLDLOCK)';

  protected override readonly statementTerminator = ';';

  /**
   * `TOP (0)`, the only way this engine says "no rows": `FETCH NEXT 0 ROWS ONLY` is rejected
   * outright ("the number of rows provided for a FETCH clause must be greater then zero").
   */
  protected override selectModifier<E>(q: Query<E>): string {
    return q.$limit === 0 ? 'TOP (0) ' : '';
  }

  /**
   * `TOP (0)` is the whole page when nothing is wanted: the engine refuses `TOP` alongside an
   * `OFFSET`, and a skip into an empty result changes nothing, so no clause follows it.
   */
  override pager(ctx: QueryContext, opts: QueryPager & { $distinct?: boolean }, sorted = false): void {
    if (opts.$limit === 0) {
      assertNonNegativeInteger(opts.$skip ?? 0, '$skip');
      return;
    }
    super.pager(ctx, opts, sorted);
  }

  /**
   * `SET IDENTITY_INSERT` around the insert, where the payload states a key the engine would
   * otherwise generate: writing one is refused outright ("cannot insert explicit value for identity
   * column ... when IDENTITY_INSERT is set to OFF") rather than ignored.
   *
   * Emitted only for that case, because the setting is per-session and only one table may hold it at
   * a time, so it is turned back off in the same batch it was turned on.
   */
  override insert<E>(ctx: QueryContext, entity: Type<E>, payload: E | E[], opts?: QueryOptions): void {
    const table = this.identityInsertTarget(entity, payload);
    if (table) {
      ctx.append(`SET IDENTITY_INSERT ${table} ON; `);
    }
    super.insert(ctx, entity, payload, opts);
    if (table) {
      ctx.append(`; SET IDENTITY_INSERT ${table} OFF`);
    }
  }

  /** The table to toggle, or nothing when no record writes a key the engine would have generated. */
  private identityInsertTarget<E>(entity: Type<E>, payload: E | E[]): string | undefined {
    const meta = getMeta(entity);
    const [idKey] = meta.ids;
    const field = meta.ids.length === 1 ? meta.fields[idKey] : undefined;
    if (!field || !isAutoIncrement(field, true)) {
      return undefined;
    }
    const records = Array.isArray(payload) ? payload : [payload];
    const stated = records.some((record) => (record as Record<string, unknown>)[idKey as string] !== undefined);
    return stated ? this.escapedTableName(meta) : undefined;
  }

  /**
   * A `DECIMAL` read back as the exact text it was written as, where the entity declared the field a
   * `String`. `tedious` decodes the type to a JS number before anything here can see it, so the
   * digits past 2^53 are gone at the wire unless the column is converted before it crosses - the same
   * reason MariaDB reads a vector column through `VEC_ToText`. 41 characters covers `DECIMAL(38, s)`
   * with room for the sign and the point.
   */
  protected override selectFieldExpr(escapedColumn: string, field: FieldOptions): string {
    const exactDecimal = field.type === String && fieldOptionsToCanonical(field).category === 'decimal';
    return exactDecimal ? `CONVERT(NVARCHAR(41), ${escapedColumn})` : escapedColumn;
  }

  /** Named parameters, which `tedious` binds by name rather than by position. */
  override placeholder(index: number): string {
    return `@p${index}`;
  }

  /** `OUTPUT` reads the written row out of the `INSERTED` pseudo-table rather than `RETURNING` it. */
  override returningId<E>(meta: EntityMeta<E>): string {
    const expression = this.returningIdExpression(meta);
    return expression ? `OUTPUT ${expression}` : '';
  }

  protected override returningIdExpression<E>(meta: EntityMeta<E>): string {
    const [idKey] = meta.ids;
    return meta.ids.length === 1 ? `INSERTED.${this.escapeId(this.columnOf(meta, idKey))} ${this.escapeId('id')}` : '';
  }

  protected override mergeReturning(expression: string): string {
    return `OUTPUT ${expression}`;
  }

  /**
   * A row lock is a hint on the table here, not a clause at the end of the statement, so
   * {@link lockHint} emits it and this only keeps the guard - see the base declaration.
   */
  protected override appendLock<E>(_ctx: QueryContext, entity: Type<E>, q: Query<E>): void {
    this.assertLockSupported(entity, q);
  }

  protected override lockHint<E>(q: Query<E>): string {
    const wait = parseQueryLock(q.$lock);
    if (!wait) {
      return '';
    }
    // `READPAST` skips locked rows and `NOWAIT` raises instead of waiting - what `SKIP LOCKED` and
    // `NOWAIT` mean elsewhere. `ROWLOCK` asks the engine not to escalate to a page or the table.
    const extra = wait === 'skip' ? ', READPAST' : wait === 'nowait' ? ', NOWAIT' : '';
    return ` WITH (UPDLOCK, ROWLOCK${extra})`;
  }

  /**
   * `N'...'`, always. A bare literal is `VARCHAR`, whose codepage silently destroys anything outside
   * it, and every string column this dialect creates is `NVARCHAR`. Bound parameters need nothing -
   * `tedious` binds a JS string as `NVarChar` already - so this reaches only inlined literals.
   */
  override escape(value: unknown): string {
    if (typeof value === 'string') {
      return `N'${escapeSingleQuotes(value)}'`;
    }
    if (value instanceof Uint8Array) {
      return `0x${Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
    }
    return super.escape(value);
  }

  /**
   * `REGEXP_LIKE` is SQL Server 2025 at database compatibility level 170; a server below that rejects
   * it itself, neither the version nor the compatibility level being knowable here - the same terms
   * `uuidv7()` is emitted on. It is a predicate rather than a value, so it stands alone.
   */
  protected override regexCondition(operand: string, placeholder: string): string {
    return `REGEXP_LIKE(${operand}, ${placeholder})`;
  }

  /**
   * `VECTOR_DISTANCE('cosine', a, b)`, one function taking the metric by name; `dot` is the negated
   * inner product, pgvector's `<#>` convention. Exact search, as on sqlite-vec: 2025's DiskANN index
   * is a preview feature, and only `VECTOR_SEARCH` reads it, never an `ORDER BY VECTOR_DISTANCE`.
   */
  override readonly vectorMetrics: ReadonlyMap<VectorDistance, VectorMetric> = new Map([
    ['cosine', { fn: 'VECTOR_DISTANCE', metricArg: 'cosine' }],
    ['l2', { fn: 'VECTOR_DISTANCE', metricArg: 'euclidean' }],
    ['inner', { fn: 'VECTOR_DISTANCE', metricArg: 'dot' }],
  ]);

  /**
   * `VECTOR_DISTANCE` refuses the `nvarchar` a vector binds as, so it is cast - to the value's own
   * length, which is its dimension. A write would convert implicitly, and shares the cast anyway.
   */
  protected override appendVectorValue(ctx: QueryContext, value: readonly unknown[]): void {
    ctx.append('CAST(');
    super.appendVectorValue(ctx, value);
    ctx.append(` AS VECTOR(${value.length}))`);
  }

  /** There is no `CREATE SCHEMA IF NOT EXISTS`, and `CREATE SCHEMA` has to be alone in its batch. */
  override createSchemaSql(schema: string): string {
    const literal = escapeSingleQuotes(schema);
    const quoted = escapeSingleQuotes(this.escapeId(schema, true));
    return `IF SCHEMA_ID(N'${literal}') IS NULL EXEC(N'CREATE SCHEMA ${quoted}')`;
  }

  /** The estimate the engine already keeps per partition, live without a stats refresh. */
  override estimatedCount<E>(ctx: QueryContext, entity: Type<E>): void {
    const meta = getMeta(entity);
    ctx.append(
      `SELECT SUM(p.rows) ${this.escapeId(COUNT_ALIAS, true)} FROM sys.partitions p` +
        ` JOIN sys.objects o ON o.object_id = p.object_id` +
        ` JOIN sys.schemas s ON s.schema_id = o.schema_id` +
        ` WHERE p.index_id IN (0, 1) AND o.name = `,
    );
    ctx.addValue(this.resolveTableAlias(meta));
    ctx.append(' AND s.name = ');
    ctx.addValue(this.resolveSchema(meta) ?? 'dbo');
  }

  protected override numericCast(expr: string): string {
    return `TRY_CAST(${expr} AS FLOAT)`;
  }

  /**
   * `JSON_VALUE` returns `NVARCHAR(4000)` and, in the lax mode that is the default, answers NULL
   * rather than erroring for anything longer - so a long string read through it disappears without a
   * word. `OPENJSON` has no such bound, so the path is split and its last segment matched as a key.
   */
  protected override getJsonPathScalarExpr(escapedColumn: string, jsonPathStr: string): string {
    const dot = jsonPathStr.lastIndexOf('.');
    const parent = dot === -1 ? '$' : `$.${jsonPathStr.slice(0, dot).split('.').map(escapeSingleQuotes).join('.')}`;
    const leaf = escapeSingleQuotes(jsonPathStr.slice(dot + 1));
    return `(SELECT ${this.#elem.value} FROM OPENJSON(${escapedColumn}, '${parent}') WHERE ${this.#elem.key} = N'${leaf}')`;
  }

  /**
   * The same read as the scalar one. `JSON_QUERY` answers NULL for anything that is not an object or
   * an array, so it cannot serve the JSON access mode a boolean or a number operand asks for -
   * `OPENJSON` returns both as text, and {@link jsonScalarParam} binds the operand as the matching
   * text. An array or object comes back as its own JSON text, which is what `OPENJSON` takes next.
   */
  protected override getJsonPathJsonbExpr(escapedColumn: string, jsonPathStr: string): string {
    return this.getJsonPathScalarExpr(escapedColumn, jsonPathStr);
  }

  /**
   * A value being *compared* against a JSON path, which reads back as the text `JSON_VALUE` yields:
   * `'true'` for a boolean, `'12'` for a number. So only a boolean needs re-spelling; a number or a
   * string already binds as the text it will be compared with.
   *
   * There is no "parse this text as JSON" cast to bind through the way `CAST(? AS JSON)` and
   * `json(?)` serve the other families - `JSON_QUERY` marks text as JSON but answers NULL for a
   * scalar - which is why reading and writing need the two different binders here.
   */
  protected override jsonScalarParam(ctx: QueryContext, value: unknown): string {
    return (
      this.#jsonCompound(ctx, value) ??
      this.addValue(ctx.values, typeof value === 'boolean' ? JSON.stringify(value) : value)
    );
  }

  /**
   * A value being *written* to a JSON path, which takes the type the driver sent: a `BIT` becomes a
   * JSON boolean, a number a JSON number, a string a JSON string. `normalizeValue` has already
   * flattened a boolean to 1/0 for this engine's columns, so the cast is what restores it.
   */
  protected jsonWriteParam(ctx: QueryContext, value: unknown): string {
    const compound = this.#jsonCompound(ctx, value);
    if (compound) {
      return compound;
    }
    const placeholder = this.addValue(ctx.values, value);
    return typeof value === 'boolean' ? `CAST(${placeholder} AS BIT)` : placeholder;
  }

  /**
   * An object or array bound as JSON, which is the half both binders spell the same way, or
   * `undefined` for a scalar - where they diverge.
   */
  #jsonCompound(ctx: QueryContext, value: unknown): string | undefined {
    if (value === null || typeof value !== 'object' || value instanceof QueryRaw) {
      return undefined;
    }
    ctx.pushValue(JSON.stringify(value));
    return `JSON_QUERY(${this.placeholder(ctx.values.length)})`;
  }

  /** An exploded element compares as text here, so `$elemMatch` always expands per field. */
  protected override readonly jsonContainmentIsPartial = false;

  protected override jsonElemFrom(jsonField: string, _fields: readonly string[], alias: string): string {
    return `OPENJSON(${jsonField}) ${alias}`;
  }

  /** `JSON_VALUE`'s 4000-character bound applies to an element's field, unlike a whole column. */
  protected override jsonElemRef(alias: string, field?: string): string {
    return field === undefined
      ? `${alias}.${this.#elem.value}`
      : `JSON_VALUE(${alias}.${this.#elem.value}, ${jsonPath(field)})`;
  }

  protected override jsonAll(ctx: QueryContext, jsonField: string, value: unknown): string {
    const alias = ctx.nextAlias(JSON_ELEM_ALIAS_PREFIX);
    const conditions = (value as unknown[]).map(
      (val) =>
        `EXISTS (SELECT 1 FROM OPENJSON(${jsonField}) ${alias} WHERE ${alias}.${this.#elem.value} = ${this.jsonScalarParam(ctx, val)})`,
    );
    return `(${conditions.join(' AND ')})`;
  }

  protected override jsonSize(ctx: QueryContext, jsonField: string, value: number | QuerySizeComparisonOps): string {
    const alias = ctx.nextAlias(JSON_ELEM_ALIAS_PREFIX);
    return this.buildFragment(ctx, (fragmentCtx) =>
      this.buildSizeComparison(
        fragmentCtx,
        () => fragmentCtx.append(`(SELECT COUNT(*) FROM OPENJSON(${jsonField}) ${alias})`),
        value,
      ),
    );
  }

  /** `JSON_MODIFY` takes one path per call, so several keys chain into one expression. */
  protected override jsonSet(
    ctx: QueryContext,
    expr: string,
    set: Record<string, unknown>,
    _field?: FieldOptions,
  ): string {
    for (const [key, value] of Object.entries(set)) {
      if (value === null) {
        throw new TypeError(
          `mssql cannot $set '${key}' to null: JSON_MODIFY deletes the key instead. Use $unset, or store a JSON null through a whole-column write.`,
        );
      }
    }
    return Object.entries(set).reduce(
      (acc, [key, value]) => `JSON_MODIFY(${acc}, ${jsonPath(key)}, ${this.jsonWriteParam(ctx, value)})`,
      `COALESCE(${expr}, '{}')`,
    );
  }

  /** `'append '` prefixing the path extends the array there, creating it where there is none. */
  protected override jsonPush(ctx: QueryContext, expr: string, push: Record<string, unknown>): string {
    return Object.entries(push).reduce(
      (acc, [key, value]) =>
        `JSON_MODIFY(${acc}, 'append ${jsonPath(key).slice(1, -1)}', ${this.jsonWriteParam(ctx, value)})`,
      `COALESCE(${expr}, '{}')`,
    );
  }

  /** Assigning NULL to a path deletes it in lax mode, which is the default. */
  protected override jsonUnset(_ctx: QueryContext, expr: string, unset: readonly string[]): string {
    return unset.reduce((acc, key) => `JSON_MODIFY(${acc}, ${jsonPath(key)}, NULL)`, expr);
  }

  /**
   * The surviving elements are re-aggregated into an array and written back whole - there is no
   * remove-by-value. `JSON_QUERY` is what marks the rebuilt text as JSON rather than a string.
   */
  protected override jsonPullKey(
    ctx: QueryContext,
    expr: string,
    escapedCol: string,
    key: string,
    value: unknown,
  ): string {
    const alias = ctx.nextAlias(JSON_ELEM_ALIAS_PREFIX);
    const val = `${alias}.${this.#elem.value}`;
    // `OPENJSON` hands back a string element unquoted and a null one as SQL NULL, so each survivor is
    // re-encoded from its reported `type` before the array is put back together - concatenated raw,
    // the result is text the engine then refuses to parse as JSON.
    const encoded =
      `CASE ${alias}.${this.#elem.type}` +
      ` WHEN 0 THEN 'null'` +
      ` WHEN 1 THEN '"' + STRING_ESCAPE(${val}, 'json') + '"'` +
      ` ELSE ${val} END`;
    // `IS NULL OR` because a JSON null element reads back as SQL NULL, and `<>` against one is
    // unknown rather than true - which silently dropped every null from the array it rebuilt.
    const kept =
      `SELECT '[' + STRING_AGG(${encoded}, ',') + ']' FROM OPENJSON(${escapedCol}, ${jsonPath(key)}) ${alias}` +
      ` WHERE ${val} IS NULL OR ${val} <> ${this.jsonScalarParam(ctx, value)}`;
    // `JSON_MODIFY` creates a path it does not find, so a `$pull` against an absent key would add an
    // empty array where the other engines leave the document alone.
    const path = jsonPath(key);
    return `CASE WHEN JSON_QUERY(${escapedCol}, ${path}) IS NULL THEN ${expr} ELSE JSON_MODIFY(${expr}, ${path}, JSON_QUERY(COALESCE((${kept}), '[]'))) END`;
  }
}
