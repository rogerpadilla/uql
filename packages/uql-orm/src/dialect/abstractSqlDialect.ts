import { getMeta } from '../entity/index.js';
import { resolveVectorCast, type VectorCast } from '../schema/canonicalType.js';
import {
  type EntityMeta,
  type FieldKey,
  type FieldOptions,
  type IdKey,
  type IsolationLevel,
  type JsonUpdateOp,
  type Key,
  type Query,
  type QueryAggregate,
  type QueryComparisonOptions,
  type QueryConflictPaths,
  type QueryContext,
  type QueryDialect,
  type QueryHavingMap,
  type QueryOptions,
  type QueryPager,
  QueryRaw,
  type QueryRawFnOptions,
  type QuerySearch,
  type QuerySelect,
  type QuerySelectOptions,
  type QuerySizeComparisonOps,
  type QuerySortDirection,
  type QuerySortMap,
  type QueryTextSearchOptions,
  type QueryVectorSearch,
  type QueryWhere,
  type QueryWhereArray,
  type QueryWhereFieldOperatorMap,
  type QueryWhereMap,
  type QueryWhereOptions,
  RAW_ALIAS,
  RAW_VALUE,
  type RelationOptions,
  type SqlDialect,
  type SqlQueryDialect,
  type Type,
  type UpdatePayload,
  type VectorDistance,
} from '../type/index.js';

import {
  buildQueryWhereAsMap,
  buildSortMap,
  type CallbackKey,
  escapeSqlId,
  fillOnFields,
  filterFieldKeys,
  filterRelationKeys,
  flatObject,
  getFieldCallbackValue,
  getFieldKeys,
  getKeys,
  hasKeys,
  isJsonType,
  isSelectingRelations,
  isVectorSearch,
  parseGroupMap,
  raw,
} from '../util/index.js';

import { AbstractDialect } from './abstractDialect.js';
import { SqlQueryContext } from './queryContext.js';

export abstract class AbstractSqlDialect extends AbstractDialect implements QueryDialect, SqlQueryDialect {
  // Narrow dialect type from Dialect to SqlDialect
  declare readonly dialect: SqlDialect;

  get escapeIdChar() {
    return this.config.quoteChar;
  }

  get beginTransactionCommand() {
    return this.config.beginTransactionCommand;
  }

  getBeginTransactionStatements(isolationLevel?: IsolationLevel): string[] {
    const level = isolationLevel?.toUpperCase();
    const strategy = this.config.isolationLevelStrategy;
    if (!level || strategy === 'none') {
      return [this.config.beginTransactionCommand];
    }
    if (strategy === 'inline') {
      return [`${this.config.beginTransactionCommand} ISOLATION LEVEL ${level}`];
    }
    // 'set-before' — MySQL/MariaDB pattern
    return [`SET TRANSACTION ISOLATION LEVEL ${level}`, this.config.beginTransactionCommand];
  }

  get commitTransactionCommand() {
    return this.config.commitTransactionCommand;
  }

  get rollbackTransactionCommand() {
    return this.config.rollbackTransactionCommand;
  }

  createContext(): QueryContext {
    return new SqlQueryContext(this);
  }

  addValue(values: unknown[], value: unknown): string {
    values.push(this.normalizeValue(value));
    return this.placeholder(values.length);
  }

  /**
   * Normalizes a parameter value for the database driver.
   * Handles bigint, boolean, and serializes plain objects/arrays to JSON strings.
   * Date values are preserved so SQL drivers can apply native date/time binding.
   * Postgres overrides to pass objects through to its native JSONB driver.
   */
  normalizeValue(value: unknown): unknown {
    if (typeof value === 'bigint') return Number(value);
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (value instanceof Date) return value;
    if (value !== null && typeof value === 'object' && !(value instanceof Uint8Array) && !(value instanceof QueryRaw)) {
      return JSON.stringify(value);
    }
    return value;
  }

  /**
   * Normalizes a list of parameter values.
   */
  normalizeValues(values: unknown[] | undefined): unknown[] | undefined {
    return values?.map((v) => this.normalizeValue(v));
  }

  placeholder(_index: number): string {
    return '?';
  }

  returningId<E>(entity: Type<E>): string {
    const meta = getMeta(entity);
    const idKey = (meta.id ?? 'id') as IdKey<E>;
    const idName = this.resolveColumnName(idKey, meta.fields[idKey]);
    return `RETURNING ${this.escapeId(idName)} ${this.escapeId('id')}`;
  }

  search<E>(ctx: QueryContext, entity: Type<E>, q: Query<E> = {}, opts: QueryOptions = {}): void {
    const meta = getMeta(entity);
    const tableName = this.resolveTableName(entity, meta);
    const prefix = (opts.prefix ?? (opts.autoPrefix || isSelectingRelations(meta, q.$select))) ? tableName : undefined;
    opts = { ...opts, prefix };
    this.where<E>(ctx, entity, q.$where, opts);
    this.sort<E>(ctx, entity, q.$sort, opts);
    this.pager(ctx, q);
  }

  selectFields<E>(
    ctx: QueryContext,
    entity: Type<E>,
    select: QuerySelect<E> | QueryRaw[] | undefined,
    opts: QuerySelectOptions = {},
  ): void {
    const meta = getMeta(entity);
    const prefix = opts.prefix ? opts.prefix + '.' : '';
    const escapedPrefix = this.escapeId(opts.prefix as string, true, true);

    let selectArr: (FieldKey<E> | QueryRaw)[];

    if (select) {
      if (Array.isArray(select)) {
        // Internal-only path: raw SQL expressions passed as QueryRaw[]
        selectArr = select;
      } else {
        const positiveFields: FieldKey<E>[] = [];
        const negativeFields: FieldKey<E>[] = [];

        for (const prop in select) {
          if (!(prop in meta.fields)) {
            continue;
          }
          const val = select[prop as FieldKey<E>];
          if (val) {
            positiveFields.push(prop as FieldKey<E>);
          } else {
            negativeFields.push(prop as FieldKey<E>);
          }
        }

        selectArr = positiveFields.length
          ? positiveFields
          : (getFieldKeys(meta.fields).filter((it) => !negativeFields.includes(it)) as FieldKey<E>[]);
      }

      const id = meta.id;
      if (id && opts.prefix && !selectArr.includes(id)) {
        selectArr = [id, ...selectArr];
      }
    } else {
      selectArr = getFieldKeys(meta.fields) as FieldKey<E>[];
    }

    if (!selectArr.length) {
      ctx.append(escapedPrefix + '*');
      return;
    }

    selectArr.forEach((key, index) => {
      if (index > 0) ctx.append(', ');
      if (key instanceof QueryRaw) {
        this.getRawValue(ctx, {
          value: key,
          prefix: opts.prefix,
          escapedPrefix,
          autoPrefixAlias: opts.autoPrefixAlias,
        });
      } else {
        const field = meta.fields[key];
        if (!field) return;
        const columnName = this.resolveColumnName(key, field);
        if (field.virtual) {
          this.getRawValue(ctx, {
            value: raw(field.virtual[RAW_VALUE], key),
            prefix: opts.prefix,
            escapedPrefix,
            autoPrefixAlias: opts.autoPrefixAlias,
          });
        } else {
          ctx.append(escapedPrefix + this.escapeId(columnName));
        }
        if (!field.virtual && (columnName !== key || opts.autoPrefixAlias)) {
          const aliasStr = prefix + key;
          ctx.append(' ' + this.escapeId(aliasStr, true));
        }
      }
    });
  }

  select<E>(
    ctx: QueryContext,
    entity: Type<E>,
    select: QuerySelect<E> | QueryRaw[] | undefined,
    opts: QueryOptions = {},
    distinct?: boolean,
    sort?: QuerySortMap<E>,
  ): void {
    const meta = getMeta(entity);
    const tableName = this.resolveTableName(entity, meta);
    const mapSelect = Array.isArray(select) ? undefined : select;
    const prefix = (opts.prefix ?? (opts.autoPrefix || isSelectingRelations(meta, mapSelect))) ? tableName : undefined;

    ctx.append(distinct ? 'SELECT DISTINCT ' : 'SELECT ');
    this.selectFields(ctx, entity, select, { prefix });
    // Add related fields BEFORE FROM clause
    this.selectRelationFields(ctx, entity, mapSelect, { prefix });
    // Inject vector distance projections when $project is set
    if (sort) {
      const sortMap = buildSortMap(sort);
      for (const [key, val] of Object.entries(sortMap)) {
        if (isVectorSearch(val) && val.$project) {
          ctx.append(', ');
          this.appendVectorProjection(ctx, meta, key, val);
        }
      }
    }
    ctx.append(` FROM ${this.escapeId(tableName)}`);
    // Add JOINs AFTER FROM clause
    this.selectRelationJoins(ctx, entity, mapSelect, { prefix });
  }

  protected selectRelationFields<E>(
    ctx: QueryContext,
    entity: Type<E>,
    select: QuerySelect<E> | undefined,
    opts: { prefix?: string } = {},
  ): void {
    this.forEachJoinableRelation(entity, select, opts, (relEntity, relQuery, joinRelAlias) => {
      ctx.append(', ');
      this.selectFields(ctx, relEntity, relQuery.$select, { prefix: joinRelAlias, autoPrefixAlias: true });
      this.selectRelationFields(ctx, relEntity, relQuery.$select, { prefix: joinRelAlias });
    });
  }

  protected selectRelationJoins<E>(
    ctx: QueryContext,
    entity: Type<E>,
    select: QuerySelect<E> | undefined,
    opts: { prefix?: string } = {},
  ): void {
    this.forEachJoinableRelation(
      entity,
      select,
      opts,
      (relEntity, relQuery, joinRelAlias, relOpts, meta, tableName, required) => {
        const relMeta = getMeta(relEntity);
        const relTableName = this.resolveTableName(relEntity, relMeta);
        const relEntityName = this.escapeId(relTableName);
        const relPath = opts.prefix ? this.escapeId(opts.prefix, true) : this.escapeId(tableName);
        const joinType = required ? 'INNER' : 'LEFT';
        const joinAlias = this.escapeId(joinRelAlias, true);

        ctx.append(` ${joinType} JOIN ${relEntityName} ${joinAlias} ON `);
        let refAppended = false;
        for (const it of relOpts.references ?? []) {
          if (refAppended) ctx.append(' AND ');
          const relField = relMeta.fields[it.foreign];
          const field = meta.fields[it.local];
          const foreignColumnName = this.resolveColumnName(it.foreign, relField);
          const localColumnName = this.resolveColumnName(it.local, field);
          ctx.append(`${joinAlias}.${this.escapeId(foreignColumnName)} = ${relPath}.${this.escapeId(localColumnName)}`);
          refAppended = true;
        }

        if (relQuery.$where) {
          ctx.append(' AND ');
          this.where(ctx, relEntity, relQuery.$where, { prefix: joinRelAlias, clause: false });
        }

        this.selectRelationJoins(ctx, relEntity, relQuery.$select, { prefix: joinRelAlias });
      },
    );
  }

  /**
   * Iterates over joinable (11/m1) relations for a given select, resolving shared metadata.
   * Used by both `selectRelationFields` and `selectRelationJoins` to avoid duplicated iteration logic.
   */
  private forEachJoinableRelation<E>(
    entity: Type<E>,
    select: QuerySelect<E> | undefined,
    opts: { prefix?: string },
    callback: (
      relEntity: Type<unknown>,
      relQuery: Query<unknown>,
      joinRelAlias: string,
      relOpts: RelationOptions,
      meta: EntityMeta<E>,
      tableName: string,
      required: boolean,
    ) => void,
  ): void {
    if (!select) return;
    const meta = getMeta(entity);
    const tableName = this.resolveTableName(entity, meta);
    const relKeys = filterRelationKeys(meta, select);
    const prefix = opts.prefix;

    for (const relKey of relKeys) {
      const relOpts = meta.relations[relKey];
      if (!relOpts || relOpts.cardinality === '1m' || relOpts.cardinality === 'mm' || !relOpts.entity) continue;

      const isFirstLevel = prefix === tableName;
      const joinRelAlias = isFirstLevel ? relKey : prefix ? `${prefix}.${relKey}` : relKey;
      const relEntity = relOpts.entity();
      const relSelect = select?.[relKey];

      let relQuery: Query<unknown>;
      let required = false;

      if (isRelationSelectQuery(relSelect)) {
        relQuery = relSelect;
        required = relSelect.$required === true;
      } else if (Array.isArray(relSelect)) {
        relQuery = { $select: relSelect };
      } else {
        relQuery = {};
      }

      callback(relEntity, relQuery, joinRelAlias, relOpts, meta, tableName, required);
    }
  }

  where<E>(ctx: QueryContext, entity: Type<E>, where: QueryWhere<E> = {}, opts: QueryWhereOptions = {}): void {
    const meta = getMeta(entity);
    const { usePrecedence, clause = 'WHERE', softDelete } = opts;

    where = buildQueryWhereAsMap(meta, where);

    if (
      meta.softDelete &&
      (softDelete || softDelete === undefined) &&
      !(where as Record<string, unknown>)[meta.softDelete]
    ) {
      (where as Record<string, unknown>)[meta.softDelete] = null;
    }

    const entries = Object.entries(where);

    if (!entries.length) {
      return;
    }

    if (clause) {
      ctx.append(` ${clause} `);
    }

    if (usePrecedence) {
      ctx.append('(');
    }

    const whereKeys = getKeys(where) as (keyof QueryWhereMap<E>)[];
    const hasMultipleKeys = whereKeys.length > 1;
    let appended = false;
    whereKeys.forEach((key) => {
      const val = (where as Record<string, unknown>)[key];
      if (val === undefined) return;
      if (appended) {
        ctx.append(' AND ');
      }
      this.compare(ctx, entity, key, val as QueryWhereMap<E>[keyof QueryWhereMap<E>], {
        ...opts,
        usePrecedence: hasMultipleKeys,
      });
      appended = true;
    });

    if (usePrecedence) {
      ctx.append(')');
    }
  }

  compare<E>(ctx: QueryContext, entity: Type<E>, key: string, val: unknown, opts: QueryComparisonOptions = {}): void {
    const meta = getMeta(entity);

    if (val instanceof QueryRaw) {
      if (key === '$exists' || key === '$nexists') {
        ctx.append(key === '$exists' ? 'EXISTS (' : 'NOT EXISTS (');
        const tableName = this.resolveTableName(entity, meta);
        this.getRawValue(ctx, {
          value: val,
          prefix: tableName,
          escapedPrefix: this.escapeId(tableName, false, true),
        });
        ctx.append(')');
        return;
      }
      this.getComparisonKey(ctx, entity, key as FieldKey<E>, opts);
      ctx.append(' = ');
      this.getRawValue(ctx, { value: val });
      return;
    }

    if (key === '$text') {
      const search = val as QueryTextSearchOptions<E>;
      const searchFields = search.$fields ?? (getFieldKeys(meta.fields) as FieldKey<E>[]);
      const fields = searchFields.map((fKey) => {
        const field = meta.fields[fKey];
        const columnName = this.resolveColumnName(fKey, field);
        return this.escapeId(columnName);
      });
      ctx.append(`MATCH(${fields.join(', ')}) AGAINST(`);
      ctx.addValue(search.$value);
      ctx.append(')');
      return;
    }

    if (key === '$and' || key === '$or' || key === '$not' || key === '$nor') {
      this.compareLogicalOperator(
        ctx,
        entity,
        key as '$and' | '$or' | '$not' | '$nor',
        val as QueryWhereArray<E>,
        opts,
      );
      return;
    }

    // Detect JSONB dot-notation: 'column.path' where column is a registered JSON/JSONB field
    const keyStr = key as string;
    const jsonDot = this.resolveJsonDotPath(meta, keyStr, opts.prefix);
    if (jsonDot) {
      this.compareJsonPath(ctx, jsonDot, val);
      return;
    }

    // Detect relation filtering
    const rel = meta.relations[keyStr];
    if (rel) {
      // Check if this is a $size query on a relation (count filtering)
      const valObj = val as Record<string, unknown> | undefined;
      if (valObj && typeof valObj === 'object' && '$size' in valObj && Object.keys(valObj).length === 1) {
        this.compareRelationSize(ctx, entity, keyStr, valObj['$size'] as number | QuerySizeComparisonOps, rel, opts);
        return;
      }
      this.compareRelation(ctx, entity, keyStr, val as QueryWhereMap<unknown>, rel, opts);
      return;
    }

    const value = this.normalizeWhereValue(val);
    const operators = getKeys(value) as (keyof QueryWhereFieldOperatorMap<E>)[];

    if (operators.length > 1) {
      ctx.append('(');
    }

    operators.forEach((op, index) => {
      if (index > 0) {
        ctx.append(' AND ');
      }
      this.compareFieldOperator(
        ctx,
        entity,
        key as FieldKey<E>,
        op,
        (value as QueryWhereFieldOperatorMap<E>)[op],
        opts,
      );
    });

    if (operators.length > 1) {
      ctx.append(')');
    }
  }

  protected compareLogicalOperator<E>(
    ctx: QueryContext,
    entity: Type<E>,
    key: '$and' | '$or' | '$not' | '$nor',
    val: QueryWhereArray<E>,
    opts: QueryComparisonOptions,
  ): void {
    const op = (AbstractSqlDialect.NEGATE_OP_MAP as Record<string, '$and' | '$or'>)[key] ?? (key as '$and' | '$or');
    const negate = key in AbstractSqlDialect.NEGATE_OP_MAP ? 'NOT' : '';

    const valArr = val ?? [];
    const hasManyItems = valArr.length > 1;

    if ((opts.usePrecedence || negate) && hasManyItems) {
      ctx.append((negate ? negate + ' ' : '') + '(');
    } else if (negate) {
      ctx.append(negate + ' ');
    }

    valArr.forEach((whereEntry, index) => {
      if (index > 0) {
        ctx.append(op === '$or' ? ' OR ' : ' AND ');
      }
      if (whereEntry instanceof QueryRaw) {
        this.getRawValue(ctx, {
          value: whereEntry,
        });
      } else if (whereEntry) {
        this.where(ctx, entity, whereEntry, {
          prefix: opts.prefix,
          usePrecedence: hasManyItems && !Array.isArray(whereEntry) && Object.keys(whereEntry as object).length > 1,
          clause: false,
        });
      }
    });

    if ((opts.usePrecedence || negate) && hasManyItems) {
      ctx.append(')');
    }
  }

  /** Simple comparison operators: `getComparisonKey → op → addValue`. */
  private static readonly NEGATE_OP_MAP = { $not: '$and', $nor: '$or' } as const;

  private static readonly COMPARE_OP_MAP: Record<string, string> = {
    $gt: ' > ',
    $gte: ' >= ',
    $lt: ' < ',
    $lte: ' <= ',
  };

  private static readonly LIKE_OP_MAP: Record<string, (v: string) => string> = {
    $startsWith: (v) => `${v}%`,
    $istartsWith: (v) => `${v.toLowerCase()}%`,
    $endsWith: (v) => `%${v}`,
    $iendsWith: (v) => `%${v.toLowerCase()}`,
    $includes: (v) => `%${v}%`,
    $iincludes: (v) => `%${v.toLowerCase()}%`,
    $like: (v) => v,
    $ilike: (v) => v.toLowerCase(),
  };

  protected resolveColumnWithPrefix(entity: Type<any>, key: string, { prefix }: QueryOptions = {}): string {
    const meta = getMeta(entity);
    const field = meta.fields[key as string];
    const columnName = this.resolveColumnName(key, field);
    const escapedPrefix = this.escapeId(prefix as string, true, true);
    return escapedPrefix + this.escapeId(columnName);
  }

  /**
   * Resolves the SQL operand for a field comparison.
   * For QueryRaw virtuals, appends the raw expression to ctx and returns undefined.
   */
  private resolveOperandField(
    ctx: QueryContext,
    entity: Type<any>,
    key: string,
    opts: QueryOptions,
  ): string | undefined {
    const col = getMeta(entity).fields[key];
    if (col?.virtual) {
      if (col.virtual instanceof QueryRaw) {
        this.getComparisonKey(ctx, entity, key as FieldKey<any>, opts);
        return undefined;
      }
      return `(${col.virtual})`;
    }
    return this.resolveColumnWithPrefix(entity, key, opts);
  }

  private appendFieldSql(ctx: QueryContext, field: string | undefined, sql: string): void {
    ctx.append(field ? `${field}${sql}` : sql);
  }

  compareFieldOperator<E, K extends keyof QueryWhereFieldOperatorMap<E>>(
    ctx: QueryContext,
    entity: Type<E>,
    key: FieldKey<E>,
    op: K,
    val: QueryWhereFieldOperatorMap<E>[K],
    opts: QueryOptions = {},
  ): void {
    const field = this.resolveOperandField(ctx, entity, key as string, opts);

    const simpleOp = AbstractSqlDialect.COMPARE_OP_MAP[op as string];
    if (simpleOp) {
      this.appendFieldSql(ctx, field, `${simpleOp}${this.addValue(ctx.values, val)}`);
      return;
    }

    const likeWrap = AbstractSqlDialect.LIKE_OP_MAP[op as string];
    if (likeWrap) {
      this.appendLikeOp(ctx, field, op as string, likeWrap(val as string));
      return;
    }

    switch (op) {
      case '$eq':
      case '$ne':
        this.appendEqNe(ctx, field, op as string, val);
        break;
      case '$regex':
        this.appendFieldSql(ctx, field, ` ${this.regexpOp} ${this.addValue(ctx.values, val)}`);
        break;
      case '$not':
        ctx.append('NOT (');
        this.compare(ctx, entity, key as keyof QueryWhereMap<E>, val as QueryWhereMap<E>[keyof QueryWhereMap<E>], opts);
        ctx.append(')');
        break;
      case '$in':
      case '$nin':
        this.appendInNin(ctx, field, op as string, val);
        break;
      case '$between': {
        const col = this.resolveColumnWithPrefix(entity, key, opts);
        const [min, max] = val as [unknown, unknown];
        ctx.append(`${col} BETWEEN ${this.addValue(ctx.values, min)} AND ${this.addValue(ctx.values, max)}`);
        break;
      }
      case '$isNull':
        this.appendFieldSql(ctx, field, val ? ' IS NULL' : ' IS NOT NULL');
        break;
      case '$isNotNull':
        this.appendFieldSql(ctx, field, val ? ' IS NOT NULL' : ' IS NULL');
        break;
      case '$all':
      case '$size':
      case '$elemMatch':
        throw TypeError(`${op} is not supported in the base SQL dialect - override in dialect subclass`);
      default:
        throw TypeError(`unknown operator: ${op}`);
    }
  }

  private appendLikeOp(ctx: QueryContext, field: string | undefined, op: string, wrappedVal: string): void {
    const isIlike = op.startsWith('$i') || op === '$ilike';
    const ph = this.addValue(ctx.values, wrappedVal);
    if (isIlike && field) {
      ctx.append(this.ilikeExpr(field, ph));
    } else {
      this.appendFieldSql(ctx, field, ` ${this.likeFn} ${ph}`);
    }
  }

  private appendEqNe(ctx: QueryContext, field: string | undefined, op: string, val: unknown): void {
    if (val === null) {
      this.appendFieldSql(ctx, field, op === '$eq' ? ' IS NULL' : ' IS NOT NULL');
      return;
    }
    const ph = this.addValue(ctx.values, val);
    this.appendFieldSql(ctx, field, op === '$eq' ? ` = ${ph}` : ` <> ${ph}`);
  }

  private appendInNin(ctx: QueryContext, field: string | undefined, op: string, val: unknown): void {
    this.appendFieldSql(ctx, field, this.formatIn(ctx, Array.isArray(val) ? val : [], op === '$nin'));
  }

  protected addValues(ctx: QueryContext, vals: unknown[]): void {
    vals.forEach((val, index) => {
      if (index > 0) {
        ctx.append(', ');
      }
      ctx.addValue(val);
    });
  }

  /**
   * Build a comparison condition for a JSON field.
   * Used by both `$elemMatch` and dot-notation paths.
   * All dialect-specific behavior comes from overridable methods on `this`.
   */
  protected buildJsonFieldCondition(
    ctx: QueryContext,
    fieldAccessor: (f: string) => string,
    jsonPath: string,
    op: string,
    value: unknown,
  ): string {
    const jsonField = fieldAccessor(jsonPath);
    switch (op) {
      case '$eq':
        return value === null ? `${jsonField} IS NULL` : `${jsonField} = ${this.addValue(ctx.values, value)}`;
      case '$ne':
        if (value === null) return `${jsonField} IS NOT NULL`;
        return `${jsonField} <> ${this.addValue(ctx.values, value)}`;
      case '$gt':
        return `${this.numericCast(jsonField)} > ${this.addValue(ctx.values, value)}`;
      case '$gte':
        return `${this.numericCast(jsonField)} >= ${this.addValue(ctx.values, value)}`;
      case '$lt':
        return `${this.numericCast(jsonField)} < ${this.addValue(ctx.values, value)}`;
      case '$lte':
        return `${this.numericCast(jsonField)} <= ${this.addValue(ctx.values, value)}`;
      case '$like':
        return `${jsonField} ${this.likeFn} ${this.addValue(ctx.values, value)}`;
      case '$ilike':
        return this.ilikeExpr(jsonField, this.addValue(ctx.values, (value as string).toLowerCase()));
      case '$startsWith':
        return `${jsonField} ${this.likeFn} ${this.addValue(ctx.values, `${value}%`)}`;
      case '$istartsWith':
        return this.ilikeExpr(jsonField, this.addValue(ctx.values, `${(value as string).toLowerCase()}%`));
      case '$endsWith':
        return `${jsonField} ${this.likeFn} ${this.addValue(ctx.values, `%${value}`)}`;
      case '$iendsWith':
        return this.ilikeExpr(jsonField, this.addValue(ctx.values, `%${(value as string).toLowerCase()}`));
      case '$includes':
        return `${jsonField} ${this.likeFn} ${this.addValue(ctx.values, `%${value}%`)}`;
      case '$iincludes':
        return this.ilikeExpr(jsonField, this.addValue(ctx.values, `%${(value as string).toLowerCase()}%`));
      case '$regex':
        return `${jsonField} ${this.regexpOp} ${this.addValue(ctx.values, value)}`;
      case '$in':
      case '$nin':
        return this.jsonInNin(ctx, jsonField, op, value);
      default:
        throw TypeError(`JSON field condition does not support operator: ${op}`);
    }
  }

  private jsonInNin(ctx: QueryContext, jsonField: string, op: string, value: unknown): string {
    return `${jsonField}${this.formatIn(ctx, Array.isArray(value) ? value : [], op === '$nin')}`;
  }

  getComparisonKey<E>(ctx: QueryContext, entity: Type<E>, key: FieldKey<E>, { prefix }: QueryOptions = {}): void {
    const meta = getMeta(entity);
    const escapedPrefix = this.escapeId(prefix as string, true, true);
    const field = meta.fields[key];

    if (field?.virtual) {
      this.getRawValue(ctx, {
        value: field.virtual,
        prefix,
        escapedPrefix,
      });
      return;
    }

    const columnName = this.resolveColumnName(key, field);
    ctx.append(escapedPrefix + this.escapeId(columnName));
  }

  sort<E>(ctx: QueryContext, entity: Type<E>, sort: QuerySortMap<E> | undefined, { prefix }: QueryOptions): void {
    const sortMap = buildSortMap(sort);
    if (!hasKeys(sortMap)) {
      return;
    }
    const meta = getMeta(entity);

    // Separate vector search entries from direction entries before flattening,
    // because flatObject recursively destructures objects — it would break QueryVectorSearch.
    const vectorEntries: [string, QueryVectorSearch][] = [];
    const directionEntries: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(sortMap)) {
      if (isVectorSearch(val)) {
        vectorEntries.push([key, val]);
      } else {
        directionEntries[key] = val;
      }
    }

    const flattenedSort = flatObject(directionEntries, prefix);

    // Merge: vector entries first (primary ordering), then flattened direction entries.
    const allEntries: [string, unknown][] = [...vectorEntries, ...Object.entries(flattenedSort)];

    if (!allEntries.length) return;

    ctx.append(' ORDER BY ');

    allEntries.forEach(([key, sort], index) => {
      if (index > 0) {
        ctx.append(', ');
      }

      if (isVectorSearch(sort)) {
        if (sort.$project) {
          // Distance already projected in SELECT — reference the alias to avoid recomputation
          ctx.append(this.escapeId(sort.$project));
        } else {
          this.appendVectorSort(ctx, meta, key, sort);
        }
        return;
      }

      const direction = AbstractSqlDialect.SORT_DIRECTION_MAP[sort as QuerySortDirection];

      // Detect JSONB dot-notation: 'column.path'
      const jsonDot = this.resolveJsonDotPath(meta, key);
      if (jsonDot) {
        ctx.append(jsonDot.fieldAccessor(jsonDot.jsonPath) + direction);
        return;
      }

      const field = meta.fields[key as Key<E>];
      const name = this.resolveColumnName(key, field);
      ctx.append(this.escapeId(name) + direction);
    });
  }

  /**
   * Resolve common parameters for a vector similarity ORDER BY expression.
   * Shared by all dialect overrides of `appendVectorSort`.
   */
  protected resolveVectorSortParams<E>(
    meta: EntityMeta<E>,
    key: string,
    search: QueryVectorSearch,
  ): { colName: string; distance: VectorDistance; field: FieldOptions | undefined; vectorCast: VectorCast } {
    const field = meta.fields[key as FieldKey<E>];
    const colName = this.resolveColumnName(key, field);
    const distance = search.$distance ?? field?.distance ?? 'cosine';
    const vectorCast = resolveVectorCast(field);
    return { colName, distance, field, vectorCast };
  }

  /**
   * Mapping of UQL vector distance metrics to native SQL functions.
   * Override in dialects that use function-call syntax (e.g. SQLite, MariaDB).
   * Dialects with operator-based syntax (e.g. Postgres) leave this empty and override `appendVectorSort` directly.
   */
  protected readonly vectorDistanceFns: Partial<Record<VectorDistance, string>> = {};

  /**
   * Append a vector similarity function call: `fn(col, ?)`.
   * Used by dialects that express vector distance via SQL functions (SQLite, MariaDB).
   */
  protected appendFunctionVectorSort<E>(
    ctx: QueryContext,
    meta: EntityMeta<E>,
    key: string,
    search: QueryVectorSearch,
    dialectName: string,
  ): void {
    const { colName, distance, vectorCast } = this.resolveVectorSortParams(meta, key, search);
    const fn = this.vectorDistanceFns[distance];

    if (!fn) {
      throw Error(`${dialectName} does not support vector distance metric: ${distance}`);
    }

    ctx.append(`${fn}(${this.escapeId(colName)}, `);
    ctx.addValue(`[${search.$vector.join(',')}]`);
    if (vectorCast && dialectName === 'PostgreSQL') {
      ctx.append(`::${vectorCast}`);
    }
    ctx.append(')');
  }

  /**
   * Append a vector distance projection.
   */
  protected appendVectorProjection<E>(
    ctx: QueryContext,
    meta: EntityMeta<E>,
    key: string,
    search: QueryVectorSearch,
  ): void {
    this.appendVectorSort(ctx, meta, key, search);
    ctx.append(` AS ${this.escapeId(search.$project as string)}`);
  }

  /**
   * Append a vector similarity ORDER BY expression.
   * Default: auto-delegates to `appendFunctionVectorSort` when `vectorDistanceFns` has entries.
   * Override for operator-based syntax (e.g. PostgreSQL `<=>`, `<->` operators).
   */
  protected appendVectorSort<E>(ctx: QueryContext, meta: EntityMeta<E>, key: string, search: QueryVectorSearch): void {
    if (hasKeys(this.vectorDistanceFns)) {
      this.appendFunctionVectorSort(ctx, meta, key, search, this.dialect);
      return;
    }
    throw new TypeError('Vector similarity sort is not supported by this dialect. Use raw() for vector queries.');
  }

  pager(ctx: QueryContext, opts: QueryPager): void {
    if (opts.$limit) {
      ctx.append(` LIMIT ${Number(opts.$limit)}`);
    }
    if (opts.$skip !== undefined) {
      ctx.append(` OFFSET ${Number(opts.$skip)}`);
    }
  }

  count<E>(ctx: QueryContext, entity: Type<E>, q: QuerySearch<E>, opts?: QueryOptions): void {
    const search: Query<E> = { ...q };
    delete search.$sort;
    this.select<E>(ctx, entity, [raw('COUNT(*)', 'count')]);
    this.search(ctx, entity, search, opts);
  }

  aggregate<E>(ctx: QueryContext, entity: Type<E>, q: QueryAggregate<E>, opts: QueryOptions = {}): void {
    const meta = getMeta(entity);
    const tableName = this.resolveTableName(entity, meta);
    const groupKeys: string[] = [];
    const selectParts: string[] = [];
    const aggregateExpressions: Record<string, string> = {};

    for (const entry of parseGroupMap(q.$group)) {
      if (entry.kind === 'key') {
        const field = meta.fields[entry.alias as FieldKey<E>];
        const columnName = this.resolveColumnName(entry.alias, field);
        const escaped = this.escapeId(columnName);
        groupKeys.push(escaped);
        selectParts.push(columnName !== entry.alias ? `${escaped} ${this.escapeId(entry.alias)}` : escaped);
      } else {
        const sqlFn = entry.op.slice(1).toUpperCase();
        const sqlArg =
          entry.fieldRef === '*'
            ? '*'
            : this.escapeId(this.resolveColumnName(entry.fieldRef, meta.fields[entry.fieldRef as FieldKey<E>]));
        const expr = `${sqlFn}(${sqlArg})`;
        aggregateExpressions[entry.alias] = expr;
        selectParts.push(`${expr} ${this.escapeId(entry.alias)}`);
      }
    }

    ctx.append(`SELECT ${selectParts.join(', ')} FROM ${this.escapeId(tableName)}`);
    this.where<E>(ctx, entity, q.$where, opts);

    if (groupKeys.length) {
      ctx.append(` GROUP BY ${groupKeys.join(', ')}`);
    }

    if (q.$having) {
      this.having(ctx, q.$having, aggregateExpressions);
    }

    this.aggregateSort(ctx, q.$sort, aggregateExpressions);
    this.pager(ctx, q);
  }

  /**
   * ORDER BY for aggregate queries — handles both entity-field and alias references.
   */
  private aggregateSort(
    ctx: QueryContext,
    sort: QuerySortMap<object> | undefined,
    aggregateExpressions: Record<string, string>,
  ): void {
    const sortMap = buildSortMap(sort);
    if (!hasKeys(sortMap)) return;

    ctx.append(' ORDER BY ');
    Object.entries(sortMap).forEach(([key, dir], index) => {
      if (index > 0) ctx.append(', ');
      const direction = AbstractSqlDialect.SORT_DIRECTION_MAP[dir as QuerySortDirection];
      const ref = aggregateExpressions[key] ?? this.escapeId(key);
      ctx.append(ref + direction);
    });
  }

  protected having(ctx: QueryContext, having: QueryHavingMap, aggregateExpressions: Record<string, string>): void {
    const entries = Object.entries(having).filter(([, v]) => v !== undefined);
    if (!entries.length) return;

    ctx.append(' HAVING ');
    entries.forEach(([alias, condition], index) => {
      if (index > 0) ctx.append(' AND ');
      const expr = aggregateExpressions[alias] ?? this.escapeId(alias);
      this.havingCondition(ctx, expr, condition!);
    });
  }

  private static readonly SORT_DIRECTION_MAP: Record<string | number, string> = Object.assign(
    { 1: '', asc: '', desc: ' DESC', '-1': ' DESC' },
    { [-1]: ' DESC' },
  );

  private static readonly havingOpMap: Record<string, string> = {
    $eq: '=',
    $ne: '<>',
    $gt: '>',
    $gte: '>=',
    $lt: '<',
    $lte: '<=',
  };

  protected havingCondition(ctx: QueryContext, expr: string, condition: QueryHavingMap[string]): void {
    if (typeof condition !== 'object' || condition === null) {
      ctx.append(`${expr} = `);
      ctx.addValue(condition);
      return;
    }
    const ops = condition as QueryWhereFieldOperatorMap<number>;
    const keys = getKeys(ops);
    keys.forEach((op, i) => {
      if (i > 0) ctx.append(' AND ');
      const val = ops[op];
      if (op === '$between') {
        const [min, max] = val as [number, number];
        ctx.append(`${expr} BETWEEN `);
        ctx.addValue(min);
        ctx.append(' AND ');
        ctx.addValue(max);
      } else if (op === '$in' || op === '$nin') {
        ctx.append(`${expr}${this.formatIn(ctx, Array.isArray(val) ? (val as unknown[]) : [], op === '$nin')}`);
      } else if (op === '$isNull') {
        ctx.append(`${expr}${val ? ' IS NULL' : ' IS NOT NULL'}`);
      } else if (op === '$isNotNull') {
        ctx.append(`${expr}${val ? ' IS NOT NULL' : ' IS NULL'}`);
      } else {
        const sqlOp = AbstractSqlDialect.havingOpMap[op];
        if (!sqlOp) throw TypeError(`unsupported HAVING operator: ${op}`);
        ctx.append(`${expr} ${sqlOp} `);
        ctx.addValue(val);
      }
    });
  }

  find<E>(ctx: QueryContext, entity: Type<E>, q: Query<E> = {}, opts?: QueryOptions): void {
    this.select(ctx, entity, q.$select, opts, q.$distinct, q.$sort);
    this.search(ctx, entity, q, opts);
  }

  insert<E>(ctx: QueryContext, entity: Type<E>, payload: E | E[], opts?: QueryOptions): void {
    const meta = getMeta(entity);
    const payloads = fillOnFields(meta, payload, 'onInsert');
    const keys = filterFieldKeys(meta, payloads[0], 'onInsert');

    const columns = keys.map((key) => {
      const field = meta.fields[key];
      return this.escapeId(this.resolveColumnName(key, field));
    });
    const tableName = this.resolveTableName(entity, meta);
    ctx.append(`INSERT INTO ${this.escapeId(tableName)} (${columns.join(', ')}) VALUES (`);

    payloads.forEach((it, recordIndex) => {
      if (recordIndex > 0) {
        ctx.append('), (');
      }
      keys.forEach((key, keyIndex) => {
        if (keyIndex > 0) {
          ctx.append(', ');
        }
        const field = meta.fields[key];
        this.formatPersistableValue(ctx, field, it[key]);
      });
    });
    ctx.append(')');
  }

  update<E>(
    ctx: QueryContext,
    entity: Type<E>,
    q: QuerySearch<E>,
    payload: UpdatePayload<E>,
    opts?: QueryOptions,
  ): void {
    const meta = getMeta(entity);
    const [filledPayload] = fillOnFields(meta, payload as E, 'onUpdate');
    const keys = filterFieldKeys(meta, filledPayload, 'onUpdate');

    const tableName = this.resolveTableName(entity, meta);
    ctx.append(`UPDATE ${this.escapeId(tableName)} SET `);
    keys.forEach((key, index) => {
      if (index > 0) {
        ctx.append(', ');
      }
      const field = meta.fields[key];
      const columnName = this.resolveColumnName(key, field);
      const escapedCol = this.escapeId(columnName);
      const value = filledPayload[key];

      if (this.isJsonUpdateOp(value)) {
        this.formatJsonUpdate<E>(ctx, escapedCol, value);
      } else {
        ctx.append(`${escapedCol} = `);
        this.formatPersistableValue(ctx, field, value);
      }
    });

    this.search(ctx, entity, q, opts);
  }

  upsert<E>(ctx: QueryContext, entity: Type<E>, conflictPaths: QueryConflictPaths<E>, payload: E | E[]): void {
    const meta = getMeta(entity);
    const updateCtx = this.createContext();
    const update = this.getUpsertUpdateAssignments(
      updateCtx,
      meta,
      conflictPaths,
      payload,
      (name) => `VALUES(${name})`,
    );

    if (update) {
      this.insert(ctx, entity, payload);
      ctx.append(` ON DUPLICATE KEY UPDATE ${update}`);
      ctx.pushValue(...updateCtx.values);
    } else {
      const insertCtx = this.createContext();
      this.insert(insertCtx, entity, payload);
      ctx.append(insertCtx.sql.replace(/^INSERT/, 'INSERT IGNORE'));
      ctx.pushValue(...insertCtx.values);
    }
  }

  protected getUpsertUpdateAssignments<E>(
    ctx: QueryContext,
    meta: EntityMeta<E>,
    conflictPaths: QueryConflictPaths<E>,
    payload: E | E[],
    callback?: (columnName: string) => string,
  ): string {
    const sample = Array.isArray(payload) ? payload[0] : payload;
    const cloned = { ...sample };
    const [filledPayload] = fillOnFields(meta, cloned, 'onUpdate');
    const fields = filterFieldKeys(meta, filledPayload, 'onUpdate');
    return fields
      .filter((col) => !conflictPaths[col])
      .map((col) => {
        const field = meta.fields[col];
        const columnName = this.resolveColumnName(col, field);
        if (callback && Object.hasOwn(sample as object, col)) {
          return `${this.escapeId(columnName)} = ${callback(this.escapeId(columnName))}`;
        }
        const valCtx = this.createContext();
        this.formatPersistableValue(valCtx, field, filledPayload[col]);
        ctx.pushValue(...valCtx.values);
        return `${this.escapeId(columnName)} = ${valCtx.sql}`;
      })
      .join(', ');
  }

  /**
   * Shared ON CONFLICT ... DO UPDATE / DO NOTHING logic for positional-placeholder dialects (SQLite).
   * Uses a deferred context for update params so they follow INSERT params.
   * PG uses its own implementation since `$N` numbered placeholders handle param ordering natively.
   */
  protected onConflictUpsert<E>(
    ctx: QueryContext,
    entity: Type<E>,
    conflictPaths: QueryConflictPaths<E>,
    payload: E | E[],
    insertFn: (ctx: QueryContext, entity: Type<E>, payload: E | E[]) => void,
  ): void {
    const meta = getMeta(entity);
    const updateCtx = this.createContext();
    const update = this.getUpsertUpdateAssignments(
      updateCtx,
      meta,
      conflictPaths,
      payload,
      (name) => `EXCLUDED.${name}`,
    );
    const keysStr = this.getUpsertConflictPathsStr(meta, conflictPaths);
    const onConflict = update ? `DO UPDATE SET ${update}` : 'DO NOTHING';
    insertFn(ctx, entity, payload);
    ctx.append(` ON CONFLICT (${keysStr}) ${onConflict}`);
    ctx.pushValue(...updateCtx.values);
  }

  protected getUpsertConflictPathsStr<E>(meta: EntityMeta<E>, conflictPaths: QueryConflictPaths<E>): string {
    return (getKeys(conflictPaths) as Key<E>[])
      .map((key) => {
        const field = meta.fields[key];
        const columnName = this.resolveColumnName(key, field);
        return this.escapeId(columnName);
      })
      .join(', ');
  }

  delete<E>(ctx: QueryContext, entity: Type<E>, q: QuerySearch<E>, opts: QueryOptions = {}): void {
    const meta = getMeta(entity);
    const tableName = this.resolveTableName(entity, meta);

    if (opts.softDelete || opts.softDelete === undefined) {
      if (meta.softDelete) {
        const field = meta.fields[meta.softDelete];
        if (!field?.onDelete) return;
        const value = getFieldCallbackValue(field.onDelete);
        const columnName = this.resolveColumnName(meta.softDelete, field);
        ctx.append(`UPDATE ${this.escapeId(tableName)} SET ${this.escapeId(columnName)} = `);
        ctx.addValue(value);
        this.search(ctx, entity, q, opts);
        return;
      }
      if (opts.softDelete) {
        throw TypeError(`'${tableName}' has not enabled 'softDelete'`);
      }
    }

    ctx.append(`DELETE FROM ${this.escapeId(tableName)}`);
    this.search(ctx, entity, q, opts);
  }

  escapeId(val: string, forbidQualified?: boolean, addDot?: boolean): string {
    return escapeSqlId(val, this.escapeIdChar, forbidQualified, addDot);
  }

  protected getPersistables<E>(
    ctx: QueryContext,
    meta: EntityMeta<E>,
    payload: E | E[],
    callbackKey: CallbackKey,
  ): Record<string, unknown>[] {
    const payloads = fillOnFields(meta, payload, callbackKey);
    return payloads.map((it) => this.getPersistable(ctx, meta, it, callbackKey));
  }

  protected getPersistable<E>(
    ctx: QueryContext,
    meta: EntityMeta<E>,
    payload: E,
    callbackKey: CallbackKey,
  ): Record<string, unknown> {
    const filledPayload = fillOnFields(meta, payload, callbackKey)[0];
    const keys = filterFieldKeys(meta, filledPayload, callbackKey);
    return keys.reduce(
      (acc, key) => {
        const field = meta.fields[key];
        const valCtx = this.createContext();
        this.formatPersistableValue(valCtx, field, filledPayload[key]);
        ctx.pushValue(...valCtx.values);
        acc[key] = valCtx.sql;
        return acc;
      },
      {} as Record<string, unknown>,
    );
  }

  protected formatPersistableValue<E>(ctx: QueryContext, field: FieldOptions | undefined, value: unknown): void {
    if (value instanceof QueryRaw) {
      this.getRawValue(ctx, { value });
      return;
    }
    if (isJsonType(field?.type)) {
      ctx.addValue(value ? JSON.stringify(value) : null);
      return;
    }
    if (field?.type === 'vector' && Array.isArray(value)) {
      ctx.addValue(`[${value.join(',')}]`);
      return;
    }
    ctx.addValue(value);
  }

  /**
   * Generate SQL for a JSONB merge and/or unset operation.
   * Called from `update()` when a field value has `$merge`, `$unset`, and/or `$push` operators.
   * Generates the full `"col" = <expression>` assignment.
   *
   * Base implementation uses MySQL-compatible syntax with *shallow* merge semantics
   * (RHS top-level keys replace LHS top-level keys, matching PostgreSQL's `jsonb || jsonb`).
   * Override in dialect subclasses when a dialect needs different JSON function semantics.
   */
  protected formatJsonUpdate<E>(ctx: QueryContext, escapedCol: string, value: JsonUpdateOp<E>): void {
    let expr = escapedCol;
    if (hasKeys(value.$merge)) {
      const merge = value.$merge as Record<string, unknown>;
      expr = `JSON_SET(COALESCE(${escapedCol}, '{}')`;
      for (const [key, v] of Object.entries(merge)) {
        expr += `, '$.${this.escapeJsonKey(key)}', CAST(? AS JSON)`;
        ctx.pushValue(JSON.stringify(v));
      }
      expr += ')';
    }
    if (hasKeys(value.$push)) {
      const push = value.$push as Record<string, unknown>;
      expr = `JSON_ARRAY_APPEND(${expr}`;
      for (const [key, v] of Object.entries(push)) {
        expr += `, '$.${this.escapeJsonKey(key)}', CAST(? AS JSON)`;
        ctx.pushValue(JSON.stringify(v));
      }
      expr += ')';
    }
    if (value.$unset?.length) {
      for (const key of value.$unset) {
        expr = `JSON_REMOVE(${expr}, '$.${this.escapeJsonKey(key)}')`;
      }
    }
    ctx.append(`${escapedCol} = ${expr}`);
  }

  protected isJsonUpdateOp(value: unknown): value is JsonUpdateOp {
    return typeof value === 'object' && value !== null && ('$merge' in value || '$unset' in value || '$push' in value);
  }

  /** Escapes a JSON key for safe interpolation into SQL string literals. */
  protected escapeJsonKey(key: string): string {
    return key.replace(/'/g, "''");
  }

  getRawValue(ctx: QueryContext, opts: QueryRawFnOptions & { value: QueryRaw; autoPrefixAlias?: boolean }) {
    const { value, prefix = '', escapedPrefix, autoPrefixAlias } = opts;
    const rawValue = value[RAW_VALUE];
    if (typeof rawValue === 'function') {
      const res = rawValue({
        ...opts,
        ctx,
        dialect: this,
        prefix,
        escapedPrefix: escapedPrefix ?? this.escapeId(prefix, true, true),
      });
      if (typeof res === 'string' || (typeof res === 'number' && !Number.isNaN(res))) {
        ctx.append(String(res));
      }
    } else {
      ctx.append(prefix + String(rawValue));
    }
    const alias = value[RAW_ALIAS];
    if (alias) {
      const fullAlias = autoPrefixAlias && prefix ? `${prefix}.${alias}` : alias;
      ctx.append(' ' + this.escapeId(fullAlias, true));
    }
  }

  /**
   * Resolves a dot-notation key to its JSON field metadata.
   * Shared by `where()` and `sort()` to detect 'column.path' keys where 'column' is a JSON/JSONB field.
   *
   * @returns resolved metadata or `undefined` if the key is not a JSON dot-notation path
   */
  protected resolveJsonDotPath<E>(
    meta: EntityMeta<E>,
    key: string,
    prefix?: string,
  ): { root: string; jsonPath: string; fieldAccessor: (f: string) => string } | undefined {
    const dotIndex = key.indexOf('.');
    if (dotIndex <= 0) {
      return undefined;
    }
    const root = key.slice(0, dotIndex);
    const field = meta.fields[root as FieldKey<E>];
    if (!field || !isJsonType(field.type)) {
      return undefined;
    }
    const jsonPath = key.slice(dotIndex + 1);
    const colName = this.resolveColumnName(root, field);
    const escapedCol = (prefix ? this.escapeId(prefix, true, true) : '') + this.escapeId(colName);
    return { root, jsonPath, fieldAccessor: () => this.getJsonPathScalarExpr(escapedCol, jsonPath) };
  }

  /**
   * Compare a JSONB dot-notation path, e.g. `'settings.isArchived': { $ne: true }`.
   * Receives a pre-resolved `resolveJsonDotPath` result to avoid redundant computation.
   */
  protected compareJsonPath(
    ctx: QueryContext,
    resolved: { jsonPath: string; fieldAccessor: (f: string) => string },
    val: unknown,
  ): void {
    const { jsonPath, fieldAccessor } = resolved;
    const value = this.normalizeWhereValue(val);
    const operators = getKeys(value);

    if (operators.length > 1) {
      ctx.append('(');
    }

    operators.forEach((op, index) => {
      if (index > 0) ctx.append(' AND ');
      ctx.append(this.buildJsonFieldCondition(ctx, fieldAccessor, jsonPath, op, value[op]));
    });

    if (operators.length > 1) {
      ctx.append(')');
    }
  }

  /**
   * Returns SQL that extracts a scalar value from a JSON path.
   * Dialects can override this to customize path access syntax while preserving
   * the shared comparison/operator pipeline.
   */
  protected getJsonPathScalarExpr(escapedColumn: string, jsonPath: string): string {
    const segments = jsonPath.split('.');
    let expr = escapedColumn;
    for (let i = 0; i < segments.length; i++) {
      const op = i === segments.length - 1 ? '->>' : '->';
      expr = `(${expr}${op}'${this.escapeJsonKey(segments[i])}')`;
    }
    return expr;
  }

  /**
   * Normalizes a raw WHERE value into an operator map.
   * Arrays become `$in`, scalars/null become `$eq`, objects pass through.
   */
  private normalizeWhereValue(val: unknown): Record<string, unknown> {
    if (Array.isArray(val)) return { $in: val };
    if (typeof val === 'object' && val !== null) return val as Record<string, unknown>;
    return { $eq: val };
  }

  /**
   * Filter by relation using an EXISTS subquery.
   * Supports all cardinalities: mm (via junction), 1m, m1, and 11.
   */
  protected compareRelation<E>(
    ctx: QueryContext,
    entity: Type<E>,
    key: string,
    val: QueryWhereMap<unknown>,
    rel: RelationOptions,
    opts: QueryComparisonOptions,
  ): void {
    const meta = getMeta(entity);
    const parentTable = this.resolveTableName(entity, meta);
    const parentId = meta.id!;
    const escapedParentId =
      (opts.prefix ? this.escapeId(opts.prefix, true, true) : this.escapeId(parentTable, false, true)) +
      this.escapeId(parentId);

    if (!rel.references?.length) {
      throw new TypeError(`Relation '${key}' on '${parentTable}' has no references defined`);
    }

    const relatedEntity = rel.entity!();
    const relatedMeta = getMeta(relatedEntity);
    const relatedTable = this.resolveTableName(relatedEntity, relatedMeta);

    ctx.append('EXISTS (SELECT 1 FROM ');

    if (rel.cardinality === 'mm' && rel.through) {
      // ManyToMany: EXISTS (SELECT 1 FROM JunctionTable WHERE junction.localFk = parent.id AND junction.foreignFk IN (SELECT related.id FROM Related WHERE ...))
      const throughEntity = rel.through();
      const throughMeta = getMeta(throughEntity);
      const throughTable = this.resolveTableName(throughEntity, throughMeta);
      const localFk = rel.references[0].local;
      const foreignFk = rel.references[1].local;
      const relatedId = relatedMeta.id!;

      ctx.append(this.escapeId(throughTable));
      ctx.append(` WHERE ${this.escapeId(throughTable, false, true)}${this.escapeId(localFk)} = ${escapedParentId}`);
      ctx.append(` AND ${this.escapeId(throughTable, false, true)}${this.escapeId(foreignFk)} IN (`);
      ctx.append(
        `SELECT ${this.escapeId(relatedTable, false, true)}${this.escapeId(relatedId)} FROM ${this.escapeId(relatedTable)}`,
      );
      this.where(ctx, relatedEntity, val as QueryWhere<typeof relatedEntity>, {
        prefix: relatedTable,
        clause: 'WHERE',
        softDelete: false,
      });
      ctx.append(')');
    } else {
      // 1m / m1 / 11: EXISTS (SELECT 1 FROM Related WHERE related.fk_or_pk = parent.pk_or_fk AND ...)
      // Left side is always relatedTable.references[0].foreign
      // Right side is the parent's PK (1m) or the parent's FK (m1/11)
      const joinLeft = `${this.escapeId(relatedTable, false, true)}${this.escapeId(rel.references[0].foreign)}`;
      const joinRight =
        rel.cardinality === '1m'
          ? escapedParentId
          : (opts.prefix ? this.escapeId(opts.prefix, true, true) : this.escapeId(parentTable, false, true)) +
            this.escapeId(rel.references[0].local);

      ctx.append(this.escapeId(relatedTable));
      ctx.append(` WHERE ${joinLeft} = ${joinRight}`);
      this.where(ctx, relatedEntity, val as QueryWhere<typeof relatedEntity>, {
        prefix: relatedTable,
        clause: 'AND',
        softDelete: false,
      });
    }

    ctx.append(')');
  }

  /**
   * Filter by relation size using a `COUNT(*)` subquery.
   * Supports all cardinalities: mm (via junction), 1m.
   */
  protected compareRelationSize<E>(
    ctx: QueryContext,
    entity: Type<E>,
    key: string,
    sizeVal: number | QuerySizeComparisonOps,
    rel: RelationOptions,
    opts: QueryComparisonOptions,
  ): void {
    const meta = getMeta(entity);
    const parentTable = this.resolveTableName(entity, meta);
    const parentId = meta.id!;
    const escapedParentId =
      (opts.prefix ? this.escapeId(opts.prefix, true, true) : this.escapeId(parentTable, false, true)) +
      this.escapeId(parentId);

    if (!rel.references?.length) {
      throw new TypeError(`Relation '${key}' on '${parentTable}' has no references defined`);
    }

    const appendSubquery = () => {
      ctx.append('(SELECT COUNT(*) FROM ');

      if (rel.cardinality === 'mm' && rel.through) {
        const throughEntity = rel.through();
        const throughMeta = getMeta(throughEntity);
        const throughTable = this.resolveTableName(throughEntity, throughMeta);
        const localFk = rel.references![0].local;

        ctx.append(this.escapeId(throughTable));
        ctx.append(` WHERE ${this.escapeId(throughTable, false, true)}${this.escapeId(localFk)} = ${escapedParentId}`);
      } else {
        const relatedEntity = rel.entity!();
        const relatedMeta = getMeta(relatedEntity);
        const relatedTable = this.resolveTableName(relatedEntity, relatedMeta);
        const joinLeft = `${this.escapeId(relatedTable, false, true)}${this.escapeId(rel.references![0].foreign)}`;

        ctx.append(this.escapeId(relatedTable));
        ctx.append(` WHERE ${joinLeft} = ${escapedParentId}`);
      }

      ctx.append(')');
    };

    this.buildSizeComparison(ctx, appendSubquery, sizeVal);
  }

  /**
   * Build a complete `$size` comparison expression.
   * Handles both single and multiple comparison operators by repeating the size expression.
   * @param sizeExprFn - function that appends the size expression to ctx (e.g. `jsonb_array_length("col")`)
   */
  protected buildSizeComparison(
    ctx: QueryContext,
    sizeExprFn: () => void,
    sizeVal: number | QuerySizeComparisonOps,
  ): void {
    if (typeof sizeVal === 'number') {
      sizeExprFn();
      ctx.append(' = ');
      ctx.addValue(sizeVal);
      return;
    }

    const entries = Object.entries(sizeVal).filter(([, v]) => v !== undefined);

    if (entries.length > 1) {
      ctx.append('(');
    }

    entries.forEach(([op, val], index) => {
      if (index > 0) {
        ctx.append(' AND ');
      }
      sizeExprFn();
      this.appendSizeOp(ctx, op, val);
    });

    if (entries.length > 1) {
      ctx.append(')');
    }
  }

  /**
   * Append a single size comparison operator and value to the context.
   */
  private appendSizeOp(ctx: QueryContext, op: string, val: unknown): void {
    switch (op) {
      case '$eq':
        ctx.append(' = ');
        ctx.addValue(val);
        break;
      case '$ne':
        ctx.append(' <> ');
        ctx.addValue(val);
        break;
      case '$gt':
        ctx.append(' > ');
        ctx.addValue(val);
        break;
      case '$gte':
        ctx.append(' >= ');
        ctx.addValue(val);
        break;
      case '$lt':
        ctx.append(' < ');
        ctx.addValue(val);
        break;
      case '$lte':
        ctx.append(' <= ');
        ctx.addValue(val);
        break;
      case '$between': {
        const [min, max] = val as [number, number];
        ctx.append(' BETWEEN ');
        ctx.addValue(min);
        ctx.append(' AND ');
        ctx.addValue(max);
        break;
      }
      default:
        throw TypeError(`unsupported $size comparison operator: ${op}`);
    }
  }

  abstract escape(value: unknown): string;

  protected get regexpOp(): string {
    return 'REGEXP';
  }

  protected get likeFn(): string {
    return 'LIKE';
  }

  protected ilikeExpr(f: string, ph: string): string {
    return `LOWER(${f}) LIKE ${ph}`;
  }

  /**
   * Formats an IN/NOT IN expression, binding each value individually.
   * Postgres overrides to use `= ANY($1)` / `<> ALL($1)` with a single array parameter.
   */
  protected formatIn(ctx: QueryContext, values: unknown[], negate: boolean): string {
    if (values.length === 0) return negate ? ' NOT IN (NULL)' : ' IN (NULL)';
    const phs = values.map((v) => this.addValue(ctx.values, v)).join(', ');
    return ` ${negate ? 'NOT IN' : 'IN'} (${phs})`;
  }

  protected numericCast(expr: string): string {
    return expr;
  }
}

/**
 * Type guard: narrows a relation select value to a query object (with optional `$required`).
 */
function isRelationSelectQuery(val: unknown): val is Query<unknown> & { $required?: boolean } {
  return val !== null && typeof val === 'object' && !Array.isArray(val);
}
