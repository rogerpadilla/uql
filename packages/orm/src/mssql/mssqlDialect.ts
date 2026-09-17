import { type CarriedFields, type RelationRows, relationTermKey } from '../dialect/abstractSqlDialect.js';
import { COUNT_ALIAS, JSON_PULL_ALIAS } from '../dialect/aliases.js';
import { BYTES_PREFIX } from '../dialect/hydrateColumn.js';
import { type JsonAccessMode, jsonArraySlotArgs, jsonPath, type JsonSlot, jsonSlotArgs } from '../dialect/jsonSql.js';
import { MergeSqlDialect } from '../dialect/mergeSqlDialect.js';
import { getMeta } from '../entity/index.js';
import { fieldOptionsToCanonical } from '../schema/canonicalType.js';
import { QueryRaw } from '../type/index.js';
import type {
  EntityMeta,
  FieldOptions,
  InsertIdSource,
  Query,
  QueryContext,
  QueryOptions,
  QueryPager,
  SqlDialectFeatures,
  Type,
  VectorDistance,
  VectorMetric,
} from '../type/index.js';
import { parseQueryLock } from '../type/index.js';
import { isAutoIncrement } from '../util/field.util.js';
import { assertNonNegativeInteger } from '../util/index.js';
import { escapeSingleQuotes } from '../util/sqlLiteral.js';

/** What SQL Server has. */
const MSSQL_FEATURES: SqlDialectFeatures = {
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
  rowLocks: true,
  rowLockWithWindow: true,
  rowLockOf: true,
  orderedUpsertReturning: false,
  orderedJsonAggregates: true,
  narrowVectorTypes: false,
  vectorTuningNeedsTransaction: false,
  serialDeclaresPrimaryKey: false,
};

/** The `type` `OPENJSON` reports for the JSON scalar an element is compared with; anything else binds as a string. */
function openJsonType(value: unknown): number {
  if (typeof value === 'number') {
    return 2;
  }
  return typeof value === 'boolean' ? 3 : 1;
}

/** Microsoft SQL Server 2017 and up. Identifiers are `"`-quoted, the ANSI spelling `tedious` enables. */
export class MsSqlDialect extends MergeSqlDialect {
  override readonly features: SqlDialectFeatures = MSSQL_FEATURES;

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
   * T-SQL has no inline form, so the level is set before the `BEGIN`. What a driver that sends these
   * as statements would run; `MsSqlQuerier` opens its transactions through the driver instead.
   */
  override readonly isolationLevelStrategy = 'set-before';

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
   * `SET IDENTITY_INSERT` around an insert that states a key the engine would generate, which it otherwise
   * refuses; turned off in the same batch, since one table per session may hold it.
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

  /** A `DECIMAL` declared `String`, converted before it crosses the wire, where `tedious` would round it. */
  protected override selectFieldExpr(escapedColumn: string, field: FieldOptions): string {
    const exactDecimal = field.type === String && fieldOptionsToCanonical(field).category === 'decimal';
    return exactDecimal ? `CONVERT(NVARCHAR(41), ${escapedColumn})` : escapedColumn;
  }

  /**
   * The rows read as they are, `FOR JSON PATH` making the array. It nests a dotted key and leaves a
   * null out, which is what unflattening a row with a joined column does, so a row with none keeps its
   * nulls. `JSON_QUERY` keeps the array JSON inside a parent's own `FOR JSON`.
   */
  protected override appendRelationArray(ctx: QueryContext, rows: RelationRows): void {
    const rowsCtx = ctx.createFragment();
    const { terms } = this.read(rowsCtx, rows.entity, rows.query, { alias: rows.alias, json: true }, rows.joins);
    const nulls = terms.some((term) => relationTermKey(term).includes('.')) ? '' : ', INCLUDE_NULL_VALUES';
    ctx.append(`JSON_QUERY(COALESCE((${rowsCtx.sql} FOR JSON PATH${nulls}), '[]'))`);
  }

  /**
   * What JSON would round or misread crosses it as text: a number exactly, style 3 keeping a float's
   * 17 digits, bytes as hex, and a date in UTC with its offset, which is how `tedious` reads one.
   */
  protected override readonly carriedFields = {
    numeric: (expr) => `CONVERT(VARCHAR(40), ${expr}, 3)`,
    blob: (expr) => `${this.escape(BYTES_PREFIX)} + CONVERT(VARCHAR(MAX), ${expr}, 2)`,
    date: (expr) => `CONVERT(VARCHAR(33), CAST(${expr} AS DATETIMEOFFSET), 127)`,
  } satisfies CarriedFields;

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
   * `OPENJSON` at the path's parent, matching its last segment as a key, in either reading: `JSON_VALUE`
   * answers NULL for text past 4000 characters, and `JSON_QUERY` for a scalar. A value reads back as
   * text, which {@link jsonScalarParam} binds its operand as, and an array or object as its own JSON.
   */
  protected override jsonPathReading(escapedColumn: string, path: string): string {
    if (!path) {
      return escapedColumn;
    }
    const dot = path.lastIndexOf('.');
    const parent = dot === -1 ? '$' : `$.${path.slice(0, dot).split('.').map(escapeSingleQuotes).join('.')}`;
    const leaf = escapeSingleQuotes(path.slice(dot + 1));
    return `(SELECT ${this.#elem.value} FROM OPENJSON(${escapedColumn}, '${parent}') WHERE ${this.#elem.key} = N'${leaf}')`;
  }

  /**
   * A value compared against a JSON path, which reads back as text, so only a boolean needs spelling as
   * `'true'`; SQL Server has no cast that parses text as JSON.
   */
  protected override jsonScalarParam(ctx: QueryContext, value: unknown): string {
    return (
      this.#jsonCompound(ctx, value) ?? this.addValue(ctx, typeof value === 'boolean' ? JSON.stringify(value) : value)
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
    const placeholder = this.addValue(ctx, value);
    return typeof value === 'boolean' ? `CAST(${placeholder} AS BIT)` : placeholder;
  }

  /**
   * An object or array bound as JSON, or a `raw()` rendered in place, which is the half both binders
   * spell the same way; `undefined` for a scalar - where they diverge.
   */
  #jsonCompound(ctx: QueryContext, value: unknown): string | undefined {
    if (value instanceof QueryRaw) {
      return this.rawFragment(ctx, value);
    }
    if (value === null || typeof value !== 'object') {
      return undefined;
    }
    return `JSON_QUERY(${this.addValue(ctx, JSON.stringify(value))})`;
  }

  protected override jsonElemFrom(slot: JsonSlot, alias: string): string {
    return `OPENJSON(${jsonArraySlotArgs(slot, this.jsonIsArray(slot))}) ${alias}`;
  }

  /** `JSON_QUERY` answers an array or an object as written, and a scalar as NULL. */
  protected override jsonIsArray(slot: JsonSlot): string {
    return `LEFT(JSON_QUERY(${jsonSlotArgs(slot)}), 1) = '['`;
  }

  /** An object element's `value` is its JSON text, which its fields are paths into. */
  protected override jsonElemDoc(alias: string): string {
    return `${alias}.${this.#elem.value}`;
  }

  /**
   * An element of the value's own JSON type: `OPENJSON` reads a string and a number back as the same text,
   * so the `type` it reports is what tells `'5'` from `5`. A number compares by value, cast on both sides:
   * text against a numeric parameter converts implicitly, which throws on an element that is no number.
   */
  protected override jsonElemEquals(ctx: QueryContext, _slot: JsonSlot, alias: string, value: unknown): string {
    const type = `${alias}.${this.#elem.type}`;
    if (value === null) {
      return `${type} = 0`;
    }
    const elem = this.jsonElemDoc(alias);
    const param = this.jsonScalarParam(ctx, value);
    const equal =
      typeof value === 'number' ? `${this.numericCast(elem)} = ${this.numericCast(param)}` : `${elem} = ${param}`;
    return `${equal} AND ${type} = ${openJsonType(value)}`;
  }

  protected override jsonLength(slot: JsonSlot): string {
    return `(SELECT COUNT(*) FROM OPENJSON(${jsonArraySlotArgs(slot, this.jsonIsArray(slot))}))`;
  }

  /** SQL Server orders JSON as the text `OPENJSON` reads, so a number sorts by its value first. */
  protected override readonly jsonSortModes: readonly JsonAccessMode[] = ['numeric', 'text'];

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
   * remove-by-value. `JSON_QUERY` is what marks the rebuilt text as JSON rather than a string. Only an
   * array is rewritten: `JSON_MODIFY` would create an absent key, and any other value stays as it is.
   */
  protected override jsonPullKey(
    ctx: QueryContext,
    expr: string,
    escapedCol: string,
    key: string,
    value: unknown,
  ): string {
    const slot = { base: escapedCol, path: key };
    const val = this.jsonElemDoc(JSON_PULL_ALIAS);
    // `OPENJSON` hands back a string element unquoted and a null one as SQL NULL, so each survivor is
    // re-encoded from its reported `type` before the array is put back together - concatenated raw,
    // the result is text the engine then refuses to parse as JSON.
    const encoded =
      `CASE ${JSON_PULL_ALIAS}.${this.#elem.type}` +
      ` WHEN 0 THEN 'null'` +
      ` WHEN 1 THEN '"' + STRING_ESCAPE(${val}, 'json') + '"'` +
      ` ELSE ${val} END`;
    // `IS NULL OR` because a JSON null element reads back as SQL NULL, and `<>` against one is
    // unknown rather than true - which silently dropped every null from the array it rebuilt.
    const kept =
      `SELECT '[' + STRING_AGG(${encoded}, ',') + ']' FROM ${this.jsonElemFrom(slot, JSON_PULL_ALIAS)}` +
      ` WHERE ${val} IS NULL OR ${val} <> ${this.jsonScalarParam(ctx, value)}`;
    const pulled = `JSON_MODIFY(${expr}, ${jsonPath(key)}, JSON_QUERY(COALESCE((${kept}), '[]')))`;
    return `CASE WHEN ${this.jsonIsArray(slot)} THEN ${pulled} ELSE ${expr} END`;
  }
}
