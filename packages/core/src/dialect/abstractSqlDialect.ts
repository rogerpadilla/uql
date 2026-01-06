import { getMeta } from '../entity/index.js';
import {
  type EntityMeta,
  type FieldKey,
  type FieldOptions,
  type NamingStrategy,
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
  type QuerySort,
  type QuerySortDirection,
  type QueryTextSearchOptions,
  type QueryWhere,
  type QueryWhereArray,
  type QueryWhereFieldOperatorMap,
  type QueryWhereMap,
  type QueryWhereOptions,
  type SqlQueryDialect,
  type Type,
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
  constructor(
    namingStrategy?: NamingStrategy,
    readonly escapeIdChar: '`' | '"' = '`',
    readonly beginTransactionCommand: string = 'START TRANSACTION',
    readonly commitTransactionCommand: string = 'COMMIT',
    readonly rollbackTransactionCommand: string = 'ROLLBACK',
  ) {
    super(namingStrategy);
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
    const idName = this.resolveColumnName(meta.id, meta.fields[meta.id]);
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

  selectFields<E>(ctx: QueryContext, entity: Type<E>, select: QuerySelect<E>, opts: QuerySelectOptions = {}): void {
    const meta = getMeta(entity);
    const prefix = opts.prefix ? opts.prefix + '.' : '';
    const escapedPrefix = this.escapeId(opts.prefix, true, true);

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
      if (opts.prefix && !selectArr.includes(meta.id)) {
        selectArr = [meta.id, ...selectArr];
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
        const field = meta.fields[key as FieldKey<E>];
        const columnName = this.resolveColumnName(key, field);
        if (field.virtual) {
          this.getRawValue(ctx, {
            value: raw(field.virtual.value, key as string),
            prefix: opts.prefix,
            escapedPrefix,
            autoPrefixAlias: opts.autoPrefixAlias,
          });
        } else {
          ctx.append(escapedPrefix + this.escapeId(columnName));
        }
        if (!field.virtual && (columnName !== key || opts.autoPrefixAlias)) {
          const aliasStr = (prefix + key) as string;
          // Replace dots with underscores for alias to avoid syntax errors
          const safeAlias = aliasStr.replace(/\./g, '_');
          ctx.append(' ' + this.escapeId(safeAlias, true));
        }
      }
    });
  }

  select<E>(ctx: QueryContext, entity: Type<E>, select: QuerySelect<E>, opts: QueryOptions = {}): void {
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
    select: QuerySelect<E>,
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

      if (relOpts.cardinality === '1m' || relOpts.cardinality === 'mm') {
        continue;
      }

      const isFirstLevel = prefix === tableName;
      const joinRelAlias = isFirstLevel ? relKey : prefix ? prefix + '.' + relKey : relKey;
      const relEntity = relOpts.entity();
      const relSelect = select[relKey as string];
      const relQuery = isSelectArray ? {} : Array.isArray(relSelect) ? { $select: relSelect } : relSelect;

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
    select: QuerySelect<E>,
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

      if (relOpts.cardinality === '1m' || relOpts.cardinality === 'mm') {
        continue;
      }

      const isFirstLevel = prefix === tableName;
      const joinRelAlias = isFirstLevel ? (relKey as string) : prefix ? prefix + '.' + relKey : (relKey as string);
      const relEntity = relOpts.entity();
      const relSelect = select[relKey as string];
      const relQuery = isSelectArray ? {} : Array.isArray(relSelect) ? { $select: relSelect } : relSelect;

      const relMeta = getMeta(relEntity);
      const relTableName = this.resolveTableName(relEntity, relMeta);
      const relEntityName = this.escapeId(relTableName);
      const relPath = prefix ? this.escapeId(prefix, true) : this.escapeId(tableName);
      const joinType = relQuery.$required ? 'INNER' : 'LEFT';
      const joinAlias = this.escapeId(joinRelAlias, true);

      ctx.append(` ${joinType} JOIN ${relEntityName} ${joinAlias} ON `);
      ctx.append(
        relOpts.references
          .map((it) => {
            const foreignColumnName = this.resolveColumnName(it.foreign, relMeta.fields[it.foreign]);
            const localColumnName = this.resolveColumnName(it.local, meta.fields[it.local]);
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

    if (meta.softDelete && (softDelete || softDelete === undefined) && !where[meta.softDelete as string]) {
      where[meta.softDelete as string] = null;
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

    entries.forEach(([key, val], index) => {
      if (index > 0) {
        ctx.append(' AND ');
      }
      this.compare(ctx, entity, key as keyof QueryWhereMap<E>, val as any, {
        ...opts,
        usePrecedence: entries.length > 1,
      });
    });

    if (usePrecedence) {
      ctx.append(')');
    }
  }

  compare<E, K extends keyof QueryWhereMap<E>>(
    ctx: QueryContext,
    entity: Type<E>,
    key: K,
    val: QueryWhereMap<E>[K],
    opts: QueryComparisonOptions = {},
  ): void {
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
      const fields = search.$fields.map((fKey) => {
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
      const negateOperatorMap = {
        $not: '$and',
        $nor: '$or',
      } as const;

      const op: '$and' | '$or' = negateOperatorMap[key as string] ?? key;
      const negate = key in negateOperatorMap ? 'NOT' : '';

      const valArr = val as QueryWhereArray<E>;
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
            prefix: opts.prefix,
            escapedPrefix: this.escapeId(opts.prefix, true, true),
          });
        } else {
          this.where(ctx, entity, whereEntry, {
            prefix: opts.prefix,
            usePrecedence: hasManyItems && !Array.isArray(whereEntry) && getKeys(whereEntry).length > 1,
            clause: false,
          });
        }
      });

      if ((opts.usePrecedence || negate) && hasManyItems) {
        ctx.append(')');
      }
      return;
    }

    const value = Array.isArray(val) ? { $in: val } : typeof val === 'object' && val !== null ? val : { $eq: val };
    const operators = getKeys(value) as (keyof QueryWhereFieldOperatorMap<E>)[];

    if (operators.length > 1) {
      ctx.append('(');
    }

    operators.forEach((op, index) => {
      if (index > 0) {
        ctx.append(' AND ');
      }
      this.compareFieldOperator(ctx, entity, key as FieldKey<E>, op, value[op], opts);
    });

    if (operators.length > 1) {
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
        this.compare(ctx, entity, key as any, val as any, opts);
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
          this.addValues(ctx, val as any[]);
          ctx.append(')');
        } else {
          ctx.append(' IN (NULL)');
        }
        break;
      case '$nin':
        this.getComparisonKey(ctx, entity, key, opts);
        if (Array.isArray(val) && val.length > 0) {
          ctx.append(' NOT IN (');
          this.addValues(ctx, val as any[]);
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

  getComparisonKey<E>(ctx: QueryContext, entity: Type<E>, key: FieldKey<E>, { prefix }: QueryOptions = {}): void {
    const meta = getMeta(entity);
    const escapedPrefix = this.escapeId(prefix, true, true);
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

  sort<E>(ctx: QueryContext, entity: Type<E>, sort: QuerySort<E>, { prefix }: QueryOptions): void {
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
      const field = meta.fields[key];
      const name = this.resolveColumnName(key, field);
      const direction = directionMap[sort as QuerySortDirection];
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

  update<E>(ctx: QueryContext, entity: Type<E>, q: QuerySearch<E>, payload: E, opts?: QueryOptions): void {
    const meta = getMeta(entity);
    const [filledPayload] = fillOnFields(meta, payload, 'onUpdate');
    const keys = filterFieldKeys(meta, filledPayload, 'onUpdate');

    const tableName = this.resolveTableName(entity, meta);
    ctx.append(`UPDATE ${this.escapeId(tableName)} SET `);
    keys.forEach((key, index) => {
      if (index > 0) {
        ctx.append(', ');
      }
      const field = meta.fields[key];
      const columnName = this.resolveColumnName(key, field);
      ctx.append(`${this.escapeId(columnName)} = `);
      this.formatPersistableValue(ctx, field, filledPayload[key]);
    });

    this.search(ctx, entity, q, opts);
  }

  upsert<E>(ctx: QueryContext, entity: Type<E>, conflictPaths: QueryConflictPaths<E>, payload: E): void {
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
    payload: E,
    callback?: (columnName: string) => string,
  ): string {
    const [filledPayload] = fillOnFields(meta, payload, 'onUpdate');
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
    return getKeys(conflictPaths)
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
        acc[key as string] = valCtx.sql;
        return acc;
      },
      {} as Record<string, unknown>,
    );
  }

  protected formatPersistableValue<E>(ctx: QueryContext, field: FieldOptions, value: unknown): void {
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

  getRawValue(ctx: QueryContext, opts: QueryRawFnOptions & { value: QueryRaw; autoPrefixAlias?: boolean }) {
    const { value, prefix = '', escapedPrefix, autoPrefixAlias } = opts;
    if (typeof value.value === 'function') {
      const res = value.value({
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
      ctx.append(prefix + String(value.value));
    }
    const alias = value.alias;
    if (alias) {
      const fullAlias = autoPrefixAlias ? prefix + alias : alias;
      // Replace dots with underscores for alias to avoid syntax errors
      const safeAlias = fullAlias.replace(/\./g, '_');
      const escapedFullAlias = this.escapeId(safeAlias, true);
      ctx.append(' ' + escapedFullAlias);
    }
  }

  abstract escape(value: unknown): string;
}
