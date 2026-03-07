import { getMeta } from '../entity/index.js';
import {
  type EntityMeta,
  type FieldKey,
  type FieldOptions,
  type IdKey,
  type JsonMergeOp,
  type Key,
  type Query,
  type QueryComparisonOptions,
  type QueryConflictPaths,
  type QueryContext,
  type QueryDialect,
  type QueryOptions,
  type QueryPager,
  QueryRaw,
  type QueryRawFnOptions,
  type QuerySearch,
  type QuerySelect,
  type QuerySelectArray,
  type QuerySelectOptions,
  type QuerySortDirection,
  type QuerySortMap,
  type QueryTextSearchOptions,
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
} from '../type/index.js';

import {
  buildSortMap,
  buldQueryWhereAsMap,
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
    values.push(value ?? null);
    return this.placeholder(values.length);
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
    select: QuerySelect<E> | undefined,
    opts: QuerySelectOptions = {},
  ): void {
    const meta = getMeta(entity);
    const prefix = opts.prefix ? opts.prefix + '.' : '';
    const escapedPrefix = this.escapeId(opts.prefix as string, true, true);

    let selectArr: QuerySelectArray<E>;

    if (select) {
      if (Array.isArray(select)) {
        selectArr = select;
      } else {
        const selectPositive = getKeys(select).filter((it) => select[it]) as FieldKey<E>[];
        selectArr = selectPositive.length
          ? selectPositive
          : (getFieldKeys(meta.fields).filter((it) => !(it in select)) as FieldKey<E>[]);
      }
      selectArr = selectArr.filter((it) => it instanceof QueryRaw || it in meta.fields);
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
          // Replace dots with underscores for alias to avoid syntax errors
          const safeAlias = aliasStr.replace(/\./g, '_');
          ctx.append(' ' + this.escapeId(safeAlias, true));
        }
      }
    });
  }

  select<E>(ctx: QueryContext, entity: Type<E>, select: QuerySelect<E> | undefined, opts: QueryOptions = {}): void {
    const meta = getMeta(entity);
    const tableName = this.resolveTableName(entity, meta);
    const prefix = (opts.prefix ?? (opts.autoPrefix || isSelectingRelations(meta, select))) ? tableName : undefined;

    ctx.append('SELECT ');
    this.selectFields(ctx, entity, select, { prefix });
    // Add related fields BEFORE FROM clause
    this.selectRelationFields(ctx, entity, select, { prefix });
    ctx.append(` FROM ${this.escapeId(tableName)}`);
    // Add JOINs AFTER FROM clause
    this.selectRelationJoins(ctx, entity, select, { prefix });
  }

  protected selectRelationFields<E>(
    ctx: QueryContext,
    entity: Type<E>,
    select: QuerySelect<E> | undefined,
    opts: { prefix?: string } = {},
  ): void {
    if (Array.isArray(select)) {
      return;
    }

    const meta = getMeta(entity);
    const tableName = this.resolveTableName(entity, meta);
    const relKeys = filterRelationKeys(meta, select);
    const isSelectArray = Array.isArray(select);
    const prefix = opts.prefix;

    for (const relKey of relKeys) {
      const relOpts = meta.relations[relKey];
      if (!relOpts) continue;

      if (relOpts.cardinality === '1m' || relOpts.cardinality === 'mm') {
        continue;
      }

      const isFirstLevel = prefix === tableName;
      const joinRelAlias = isFirstLevel ? relKey : prefix ? prefix + '.' + relKey : relKey;
      if (!relOpts.entity) continue;
      const relEntity = relOpts.entity();
      const relSelect = (select as Record<string, unknown>)[relKey];
      const relQuery: Query<any> = isSelectArray
        ? {}
        : Array.isArray(relSelect)
          ? { $select: relSelect }
          : ((relSelect as Query<any>) ?? {});

      ctx.append(', ');
      this.selectFields(ctx, relEntity, relQuery.$select, {
        prefix: joinRelAlias,
        autoPrefixAlias: true,
      });

      // Recursively add nested relation fields
      this.selectRelationFields(ctx, relEntity, relQuery.$select, {
        prefix: joinRelAlias,
      });
    }
  }

  protected selectRelationJoins<E>(
    ctx: QueryContext,
    entity: Type<E>,
    select: QuerySelect<E> | undefined,
    opts: { prefix?: string } = {},
  ): void {
    if (Array.isArray(select)) {
      return;
    }

    const meta = getMeta(entity);
    const tableName = this.resolveTableName(entity, meta);
    const relKeys = filterRelationKeys(meta, select);
    const isSelectArray = Array.isArray(select);
    const prefix = opts.prefix;

    for (const relKey of relKeys) {
      const relOpts = meta.relations[relKey];
      if (!relOpts) continue;

      if (relOpts.cardinality === '1m' || relOpts.cardinality === 'mm') {
        continue;
      }

      const isFirstLevel = prefix === tableName;
      const joinRelAlias = isFirstLevel ? relKey : prefix ? prefix + '.' + relKey : relKey;
      if (!relOpts.entity) continue;
      const relEntity = relOpts.entity();
      const relSelect = (select as Record<string, unknown>)[relKey];
      const relQuery: Query<any> = isSelectArray
        ? {}
        : Array.isArray(relSelect)
          ? { $select: relSelect }
          : ((relSelect as Query<any>) ?? {});

      const relMeta = getMeta(relEntity);
      const relTableName = this.resolveTableName(relEntity, relMeta);
      const relEntityName = this.escapeId(relTableName);
      const relPath = prefix ? this.escapeId(prefix, true) : this.escapeId(tableName);
      const required = '$required';
      const joinType = (relQuery as Record<string, unknown>)[required] ? 'INNER' : 'LEFT';
      const joinAlias = this.escapeId(joinRelAlias, true);

      ctx.append(` ${joinType} JOIN ${relEntityName} ${joinAlias} ON `);
      ctx.append(
        (relOpts.references ?? [])
          .map((it) => {
            const relField = relMeta.fields[it.foreign];
            const field = meta.fields[it.local];
            const foreignColumnName = this.resolveColumnName(it.foreign, relField);
            const localColumnName = this.resolveColumnName(it.local, field);
            return `${joinAlias}.${this.escapeId(foreignColumnName)} = ${relPath}.${this.escapeId(localColumnName)}`;
          })
          .join(' AND '),
      );

      if (relQuery.$where) {
        ctx.append(' AND ');
        this.where(ctx, relEntity, relQuery.$where, { prefix: joinRelAlias, clause: false });
      }

      // Recursively add nested relation JOINs
      this.selectRelationJoins(ctx, relEntity, relQuery.$select, {
        prefix: joinRelAlias,
      });
    }
  }

  where<E>(ctx: QueryContext, entity: Type<E>, where: QueryWhere<E> = {}, opts: QueryWhereOptions = {}): void {
    const meta = getMeta(entity);
    const { usePrecedence, clause = 'WHERE', softDelete } = opts;

    where = buldQueryWhereAsMap(meta, where);

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

    const startLength = ctx.sql.length;
    (getKeys(where) as (keyof QueryWhereMap<E>)[]).forEach((key) => {
      const val = (where as Record<string, unknown>)[key];
      if (val === undefined) return;
      if (ctx.sql.length > startLength) {
        ctx.append(' AND ');
      }
      this.compare(ctx, entity, key, val as QueryWhereMap<E>[keyof QueryWhereMap<E>], {
        ...opts,
        usePrecedence: getKeys(where).length > 1,
      });
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
    const jsonDot = this.resolveJsonDotPath(meta, keyStr);
    if (jsonDot) {
      this.compareJsonPath(ctx, entity, jsonDot.root, jsonDot.jsonPath, val, opts);
      return;
    }

    // Detect relation filtering: key is a known relation with 'mm' or '1m' cardinality
    const rel = meta.relations[keyStr];
    if (rel && (rel.cardinality === 'mm' || rel.cardinality === '1m')) {
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
    const negateOperatorMap = {
      $not: '$and',
      $nor: '$or',
    } as const;

    const op = (negateOperatorMap as Record<string, '$and' | '$or'>)[key] ?? (key as '$and' | '$or');
    const negate = key in negateOperatorMap ? 'NOT' : '';

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

  compareFieldOperator<E, K extends keyof QueryWhereFieldOperatorMap<E>>(
    ctx: QueryContext,
    entity: Type<E>,
    key: FieldKey<E>,
    op: K,
    val: QueryWhereFieldOperatorMap<E>[K],
    opts: QueryOptions = {},
  ): void {
    switch (op) {
      case '$eq':
        this.getComparisonKey(ctx, entity, key, opts);
        if (val === null) {
          ctx.append(' IS NULL');
        } else {
          ctx.append(' = ');
          ctx.addValue(val);
        }
        break;
      case '$ne':
        this.getComparisonKey(ctx, entity, key, opts);
        if (val === null) {
          ctx.append(' IS NOT NULL');
        } else {
          ctx.append(' <> ');
          ctx.addValue(val);
        }
        break;
      case '$not':
        ctx.append('NOT (');
        this.compare(ctx, entity, key as keyof QueryWhereMap<E>, val as QueryWhereMap<E>[keyof QueryWhereMap<E>], opts);
        ctx.append(')');
        break;
      case '$gt':
        this.getComparisonKey(ctx, entity, key, opts);
        ctx.append(' > ');
        ctx.addValue(val);
        break;
      case '$gte':
        this.getComparisonKey(ctx, entity, key, opts);
        ctx.append(' >= ');
        ctx.addValue(val);
        break;
      case '$lt':
        this.getComparisonKey(ctx, entity, key, opts);
        ctx.append(' < ');
        ctx.addValue(val);
        break;
      case '$lte':
        this.getComparisonKey(ctx, entity, key, opts);
        ctx.append(' <= ');
        ctx.addValue(val);
        break;
      case '$startsWith':
        this.getComparisonKey(ctx, entity, key, opts);
        ctx.append(' LIKE ');
        ctx.addValue(`${val}%`);
        break;
      case '$istartsWith':
        this.getComparisonKey(ctx, entity, key, opts);
        ctx.append(' LIKE ');
        ctx.addValue(`${(val as string).toLowerCase()}%`);
        break;
      case '$endsWith':
        this.getComparisonKey(ctx, entity, key, opts);
        ctx.append(' LIKE ');
        ctx.addValue(`%${val}`);
        break;
      case '$iendsWith':
        this.getComparisonKey(ctx, entity, key, opts);
        ctx.append(' LIKE ');
        ctx.addValue(`%${(val as string).toLowerCase()}`);
        break;
      case '$includes':
        this.getComparisonKey(ctx, entity, key, opts);
        ctx.append(' LIKE ');
        ctx.addValue(`%${val}%`);
        break;
      case '$iincludes':
        this.getComparisonKey(ctx, entity, key, opts);
        ctx.append(' LIKE ');
        ctx.addValue(`%${(val as string).toLowerCase()}%`);
        break;
      case '$ilike':
        this.getComparisonKey(ctx, entity, key, opts);
        ctx.append(' LIKE ');
        ctx.addValue((val as string).toLowerCase());
        break;
      case '$like':
        this.getComparisonKey(ctx, entity, key, opts);
        ctx.append(' LIKE ');
        ctx.addValue(val);
        break;
      case '$in':
        this.getComparisonKey(ctx, entity, key, opts);
        if (Array.isArray(val) && val.length > 0) {
          ctx.append(' IN (');
          this.addValues(ctx, val as unknown[]);
          ctx.append(')');
        } else {
          ctx.append(' IN (NULL)');
        }
        break;
      case '$nin':
        this.getComparisonKey(ctx, entity, key, opts);
        if (Array.isArray(val) && val.length > 0) {
          ctx.append(' NOT IN (');
          this.addValues(ctx, val as unknown[]);
          ctx.append(')');
        } else {
          ctx.append(' NOT IN (NULL)');
        }
        break;
      case '$regex':
        this.getComparisonKey(ctx, entity, key, opts);
        ctx.append(' REGEXP ');
        ctx.addValue(val);
        break;
      case '$between': {
        const [min, max] = val as [unknown, unknown];
        this.getComparisonKey(ctx, entity, key, opts);
        ctx.append(' BETWEEN ');
        ctx.addValue(min);
        ctx.append(' AND ');
        ctx.addValue(max);
        break;
      }
      case '$isNull':
        this.getComparisonKey(ctx, entity, key, opts);
        ctx.append(val ? ' IS NULL' : ' IS NOT NULL');
        break;
      case '$isNotNull':
        this.getComparisonKey(ctx, entity, key, opts);
        ctx.append(val ? ' IS NOT NULL' : ' IS NULL');
        break;
      case '$all':
      case '$size':
      case '$elemMatch':
        // Each SQL dialect must provide its own implementation
        throw TypeError(`${op} is not supported in the base SQL dialect - override in dialect subclass`);
      default:
        throw TypeError(`unknown operator: ${op}`);
    }
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
   * Used by both `$elemMatch` and dot-notation paths. Each dialect provides a `JsonFieldConfig`.
   */
  protected buildJsonFieldCondition(
    ctx: QueryContext,
    config: JsonFieldConfig,
    jsonPath: string,
    op: string,
    value: unknown,
  ): string {
    const jsonField = config.fieldAccessor(jsonPath);
    switch (op) {
      case '$eq':
        return value === null ? `${jsonField} IS NULL` : `${jsonField} = ${config.addValue(ctx, value)}`;
      case '$ne':
        if (value === null) return `${jsonField} IS NOT NULL`;
        return config.neExpr
          ? config.neExpr(jsonField, config.addValue(ctx, value))
          : `${jsonField} <> ${config.addValue(ctx, value)}`;
      case '$gt':
        return `${config.numericCast(jsonField)} > ${config.addValue(ctx, value)}`;
      case '$gte':
        return `${config.numericCast(jsonField)} >= ${config.addValue(ctx, value)}`;
      case '$lt':
        return `${config.numericCast(jsonField)} < ${config.addValue(ctx, value)}`;
      case '$lte':
        return `${config.numericCast(jsonField)} <= ${config.addValue(ctx, value)}`;
      case '$like':
        return `${jsonField} ${config.likeFn} ${config.addValue(ctx, value)}`;
      case '$ilike':
        return config.ilikeExpr(jsonField, config.addValue(ctx, (value as string).toLowerCase()));
      case '$startsWith':
        return `${jsonField} ${config.likeFn} ${config.addValue(ctx, `${value}%`)}`;
      case '$istartsWith':
        return config.ilikeExpr(jsonField, config.addValue(ctx, `${(value as string).toLowerCase()}%`));
      case '$endsWith':
        return `${jsonField} ${config.likeFn} ${config.addValue(ctx, `%${value}`)}`;
      case '$iendsWith':
        return config.ilikeExpr(jsonField, config.addValue(ctx, `%${(value as string).toLowerCase()}`));
      case '$includes':
        return `${jsonField} ${config.likeFn} ${config.addValue(ctx, `%${value}%`)}`;
      case '$iincludes':
        return config.ilikeExpr(jsonField, config.addValue(ctx, `%${(value as string).toLowerCase()}%`));
      case '$regex':
        return `${jsonField} ${config.regexpOp} ${config.addValue(ctx, value)}`;
      case '$in': {
        if (config.inExpr) {
          return config.inExpr(jsonField, config.addValue(ctx, value));
        }
        const inVals = value as unknown[];
        return `${jsonField} IN (${inVals.map((v) => config.addValue(ctx, v)).join(', ')})`;
      }
      case '$nin': {
        if (config.ninExpr) {
          return config.ninExpr(jsonField, config.addValue(ctx, value));
        }
        const ninVals = value as unknown[];
        return `${jsonField} NOT IN (${ninVals.map((v) => config.addValue(ctx, v)).join(', ')})`;
      }
      default:
        throw TypeError(`JSON field condition does not support operator: ${op}`);
    }
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
    const flattenedSort = flatObject(sortMap, prefix);
    const directionMap = { 1: '', asc: '', '-1': ' DESC', desc: ' DESC' } as const;

    ctx.append(' ORDER BY ');

    Object.entries(flattenedSort).forEach(([key, sort], index) => {
      if (index > 0) {
        ctx.append(', ');
      }
      const direction = directionMap[sort as QuerySortDirection];

      // Detect JSONB dot-notation: 'column.path'
      const jsonDot = this.resolveJsonDotPath(meta, key);
      if (jsonDot) {
        ctx.append(jsonDot.config.fieldAccessor(jsonDot.jsonPath) + direction);
        return;
      }

      const field = meta.fields[key as Key<E>];
      const name = this.resolveColumnName(key, field);
      ctx.append(this.escapeId(name) + direction);
    });
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
    this.select<E>(ctx, entity, [raw('COUNT(*)', 'count')], undefined);
    this.search(ctx, entity, search, opts);
  }

  find<E>(ctx: QueryContext, entity: Type<E>, q: Query<E> = {}, opts?: QueryOptions): void {
    this.select(ctx, entity, q.$select, opts);
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

      if (this.isJsonMergeOp(value)) {
        this.formatJsonMerge<E>(ctx, escapedCol, value);
      } else {
        ctx.append(`${escapedCol} = `);
        this.formatPersistableValue(ctx, field, value);
      }
    });

    this.search(ctx, entity, q, opts);
  }

  upsert<E>(ctx: QueryContext, entity: Type<E>, conflictPaths: QueryConflictPaths<E>, payload: E | E[]): void {
    const meta = getMeta(entity);
    const update = this.getUpsertUpdateAssignments(ctx, meta, conflictPaths, payload, (name) => `VALUES(${name})`);

    if (update) {
      this.insert(ctx, entity, payload);
      ctx.append(` ON DUPLICATE KEY UPDATE ${update}`);
    } else {
      const insertCtx = this.createContext();
      this.insert(insertCtx, entity, payload);
      ctx.append(insertCtx.sql.replace(/^INSERT/, 'INSERT IGNORE'));
      insertCtx.values.forEach((val) => {
        ctx.pushValue(val);
      });
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
    const [filledPayload] = fillOnFields(meta, sample, 'onUpdate');
    const fields = filterFieldKeys(meta, filledPayload, 'onUpdate');
    return fields
      .filter((col) => !conflictPaths[col])
      .map((col) => {
        const field = meta.fields[col];
        const columnName = this.resolveColumnName(col, field);
        if (callback) {
          return `${this.escapeId(columnName)} = ${callback(this.escapeId(columnName))}`;
        }
        const valCtx = this.createContext();
        this.formatPersistableValue(valCtx, field, filledPayload[col]);
        valCtx.values.forEach((val) => {
          ctx.pushValue(val);
        });
        return `${this.escapeId(columnName)} = ${valCtx.sql}`;
      })
      .join(', ');
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
        valCtx.values.forEach((val) => {
          ctx.pushValue(val);
        });
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
   * Called from `update()` when a field value has `$merge` and/or `$unset` operators.
   * Generates the full `"col" = <expression>` assignment.
   *
   * Base implementation uses MySQL-compatible syntax. Override in dialect subclasses.
   */
  protected formatJsonMerge<E>(ctx: QueryContext, escapedCol: string, value: JsonMergeOp<E>): void {
    let expr = escapedCol;
    if (hasKeys(value.$merge)) {
      expr = `JSON_MERGE_PATCH(COALESCE(${escapedCol}, '{}'), ?)`;
      ctx.pushValue(JSON.stringify(value.$merge));
    }
    if (value.$unset?.length) {
      for (const key of value.$unset) {
        expr = `JSON_REMOVE(${expr}, '$.${this.escapeJsonKey(key)}')`;
      }
    }
    ctx.append(`${escapedCol} = ${expr}`);
  }

  /**
   * Checks if a value is a `$merge`/`$unset` operator object.
   */
  protected isJsonMergeOp(value: unknown): value is JsonMergeOp {
    return typeof value === 'object' && value !== null && ('$merge' in value || '$unset' in value);
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
      const fullAlias = autoPrefixAlias ? prefix + alias : alias;
      // Replace dots with underscores for alias to avoid syntax errors
      const safeAlias = fullAlias.replace(/\./g, '_');
      const escapedFullAlias = this.escapeId(safeAlias, true);
      ctx.append(' ' + escapedFullAlias);
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
  ): { root: string; jsonPath: string; config: JsonFieldConfig } | undefined {
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
    const escapedCol = this.escapeId(colName);
    const config = this.getJsonFieldConfig(escapedCol, jsonPath);
    return { root, jsonPath, config };
  }

  /**
   * Compare a JSONB dot-notation path, e.g. `'settings.isArchived': { $ne: true }`.
   * The dialect's `getJsonFieldConfig` provides the SQL expression for accessing the nested JSON value.
   */
  protected compareJsonPath<E>(
    ctx: QueryContext,
    entity: Type<E>,
    root: string,
    jsonPath: string,
    val: unknown,
    opts: QueryComparisonOptions,
  ): void {
    const meta = getMeta(entity);
    const field = meta.fields[root as FieldKey<E>];
    const columnName = this.resolveColumnName(root, field);
    const escapedColumn = (opts.prefix ? this.escapeId(opts.prefix, true, true) : '') + this.escapeId(columnName);
    const config = this.getJsonFieldConfig(escapedColumn, jsonPath);

    const value = this.normalizeWhereValue(val);
    const operators = getKeys(value);

    if (operators.length > 1) {
      ctx.append('(');
    }

    operators.forEach((op, index) => {
      if (index > 0) ctx.append(' AND ');
      ctx.append(this.buildJsonFieldCondition(ctx, config, jsonPath, op, value[op]));
    });

    if (operators.length > 1) {
      ctx.append(')');
    }
  }

  /**
   * Returns a dialect-specific `JsonFieldConfig` for accessing a nested JSON path.
   * Dialects should override this to provide their specific JSON accessor syntax.
   *
   * @param escapedColumn - The escaped column name (possibly prefixed with table name)
   * @param jsonPath - The dot-separated path within the JSON field (e.g. 'isArchived' or 'theme.color')
   */
  protected getJsonFieldConfig(escapedColumn: string, jsonPath: string): JsonFieldConfig {
    return {
      ...this.getBaseJsonConfig(),
      fieldAccessor: () => {
        const segments = jsonPath.split('.');
        let expr = escapedColumn;
        for (let i = 0; i < segments.length; i++) {
          const op = i === segments.length - 1 ? '->>' : '->';
          expr = `(${expr}${op}'${this.escapeJsonKey(segments[i])}')`;
        }
        return expr;
      },
    };
  }

  /**
   * Returns the dialect-invariant portion of `JsonFieldConfig`.
   * Dialects override this to provide casts, operators, and value binding.
   * Both `getJsonFieldConfig` (dot-notation) and `buildJsonFieldOperator` ($elemMatch) compose with this.
   */
  protected getBaseJsonConfig(): Omit<JsonFieldConfig, 'fieldAccessor'> {
    return {
      numericCast: (expr) => `CAST(${expr} AS NUMERIC)`,
      likeFn: 'LIKE',
      ilikeExpr: (f, ph) => `LOWER(${f}) LIKE ${ph}`,
      regexpOp: 'REGEXP',
      addValue: (c, v) => {
        c.pushValue(v);
        return '?';
      },
    };
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
   * Filter by ManyToMany or OneToMany relation using an EXISTS subquery.
   * Generates: `EXISTS (SELECT 1 FROM ... WHERE local_fk = parent.id AND ...)`
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
    } else if (rel.cardinality === '1m') {
      // OneToMany: EXISTS (SELECT 1 FROM Child WHERE child.parentFk = parent.id AND ...)
      const foreignFk = rel.references[0].foreign;

      ctx.append(this.escapeId(relatedTable));
      ctx.append(` WHERE ${this.escapeId(relatedTable, false, true)}${this.escapeId(foreignFk)} = ${escapedParentId}`);
      this.where(ctx, relatedEntity, val as QueryWhere<typeof relatedEntity>, {
        prefix: relatedTable,
        clause: 'AND',
        softDelete: false,
      });
    }

    ctx.append(')');
  }

  abstract escape(value: unknown): string;
}

/**
 * Configuration for JSON field operations.
 * Each SQL dialect provides its own config to the shared buildJsonFieldCondition method.
 */
export type JsonFieldConfig = {
  /** Produces the field accessor expression, e.g. `elem->>'name'` or `json_extract(value, '$.name')` */
  fieldAccessor: (field: string) => string;
  /** Wraps an expression for numeric comparison, e.g. `(expr)::numeric` or `CAST(expr AS REAL)` */
  numericCast: (expr: string) => string;
  /** The LIKE keyword to use for case-sensitive matching, e.g. `'LIKE'` */
  likeFn: string;
  /** Builds a case-insensitive LIKE expression from a field and placeholder, e.g. `LOWER(field) LIKE ph` or `field ILIKE ph` */
  ilikeExpr: (field: string, placeholder: string) => string;
  /** The regexp operator, e.g. `'REGEXP'` or `'~'` */
  regexpOp: string;
  /** Binds a value and returns its placeholder string */
  addValue: (ctx: QueryContext, value: unknown) => string;
  /** Optional: custom $in expression (e.g. Postgres `= ANY()`). If omitted, uses `IN (v1, v2, ...)` */
  inExpr?: (field: string, placeholder: string) => string;
  /** Optional: custom $nin expression (e.g. Postgres `<> ALL()`). If omitted, uses `NOT IN (v1, v2, ...)` */
  ninExpr?: (field: string, placeholder: string) => string;
  /** Optional: null-safe `$ne` (e.g. Postgres `IS DISTINCT FROM`, SQLite `IS NOT`). If omitted, uses `<>` */
  neExpr?: (field: string, placeholder: string) => string;
};
