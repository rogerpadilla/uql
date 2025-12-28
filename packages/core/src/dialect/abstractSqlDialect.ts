import { getMeta } from '../entity/index.js';
import {
  type EntityMeta,
  type FieldKey,
  type Query,
  type QueryComparisonOptions,
  type QueryConflictPaths,
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
  type Scalar,
  type Type,
} from '../type/index.js';
import {
  buildSortMap,
  buldQueryWhereAsMap,
  type CallbackKey,
  fillOnFields,
  filterFieldKeys,
  filterRelationKeys,
  flatObject,
  getFieldCallbackValue,
  getFieldKeys,
  getKeys,
  hasKeys,
  isSelectingRelations,
  raw,
} from '../util/index.js';

export abstract class AbstractSqlDialect implements QueryDialect {
  readonly escapeIdRegex: RegExp;

  constructor(
    readonly escapeIdChar: '`' | '"' = '`',
    readonly beginTransactionCommand: string = 'START TRANSACTION',
  ) {
    this.escapeIdRegex = RegExp(escapeIdChar, 'g');
  }

  returningId<E>(entity: Type<E>): string {
    const meta = getMeta(entity);
    const idName = meta.fields[meta.id].name;
    return `RETURNING ${this.escapeId(idName)} ${this.escapeId('id')}`;
  }

  search<E>(entity: Type<E>, q: Query<E> = {}, opts: QueryOptions = {}): string {
    const meta = getMeta(entity);
    const prefix = (opts.prefix ?? (opts.autoPrefix || isSelectingRelations(meta, q.$select))) ? meta.name : undefined;
    opts = { ...opts, prefix };
    const where = this.where<E>(entity, q.$where, opts);
    const sort = this.sort<E>(entity, q.$sort, opts);
    const pager = this.pager(q);
    return where + sort + pager;
  }

  selectFields<E>(entity: Type<E>, select: QuerySelect<E>, opts: QuerySelectOptions): string {
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

    return selectArr
      .map((key) => {
        if (key instanceof QueryRaw) {
          return this.getRawValue({
            value: key,
            prefix,
            escapedPrefix,
            autoPrefixAlias: opts.autoPrefixAlias,
          });
        }

        const field = meta.fields[key as FieldKey<E>];

        if (field.virtual) {
          return this.getRawValue({
            value: raw(field.virtual.value, key),
            prefix,
            escapedPrefix,
            autoPrefixAlias: opts.autoPrefixAlias,
          });
        }

        const fieldPath = `${escapedPrefix}${this.escapeId(field.name)}`;

        return !opts.autoPrefixAlias && field.name === key
          ? fieldPath
          : `${fieldPath} ${this.escapeId((prefix + key) as FieldKey<E>, true)}`;
      })
      .join(', ');
  }

  selectRelations<E>(
    entity: Type<E>,
    select: QuerySelect<E> = {},
    { prefix }: { prefix?: string } = {},
  ): { fields: string; tables: string } {
    const meta = getMeta(entity);
    const relKeys = filterRelationKeys(meta, select);
    const isSelectArray = Array.isArray(select);
    let fields = '';
    let tables = '';

    for (const relKey of relKeys) {
      const relOpts = meta.relations[relKey];

      if (relOpts.cardinality === '1m' || relOpts.cardinality === 'mm') {
        // '1m' and 'mm' should be resolved in a higher layer because they will need multiple queries
        continue;
      }

      const joinRelAlias = prefix ? prefix + '.' + relKey : relKey;
      const relEntity = relOpts.entity();
      const relSelect = select[relKey as string];
      const relQuery = isSelectArray ? {} : Array.isArray(relSelect) ? { $select: relSelect } : relSelect;

      const relColumns = this.selectFields(relEntity, relQuery.$select, {
        prefix: joinRelAlias,
        autoPrefixAlias: true,
      });

      fields += ', ' + relColumns;

      const { fields: subColumns, tables: subTables } = this.selectRelations(relEntity, relQuery.$select, {
        prefix: joinRelAlias,
      });

      fields += subColumns;

      const relMeta = getMeta(relEntity);
      const relEntityName = this.escapeId(relMeta.name);
      const relPath = prefix ? this.escapeId(prefix, true) : this.escapeId(meta.name);
      const joinType = relQuery.$required ? 'INNER' : 'LEFT';
      const joinAlias = this.escapeId(joinRelAlias, true);

      tables += ` ${joinType} JOIN ${relEntityName} ${joinAlias} ON `;
      tables += relOpts.references
        .map((it) => `${joinAlias}.${this.escapeId(it.foreign)} = ${relPath}.${this.escapeId(it.local)}`)
        .join(' AND ');

      if (relQuery.$where) {
        const where = this.where(relEntity, relQuery.$where, { prefix: relKey, clause: false });
        tables += ` AND ${where}`;
      }

      tables += subTables;
    }

    return { fields, tables };
  }

  select<E>(entity: Type<E>, select: QuerySelect<E>, opts: QueryOptions = {}): string {
    const meta = getMeta(entity);
    const prefix = (opts.prefix ?? (opts.autoPrefix || isSelectingRelations(meta, select))) ? meta.name : undefined;

    const fields = this.selectFields(entity, select, { prefix });
    const { fields: relationFields, tables } = this.selectRelations(entity, select);

    return `SELECT ${fields}${relationFields} FROM ${this.escapeId(meta.name)}${tables}`;
  }

  where<E>(entity: Type<E>, where: QueryWhere<E> = {}, opts: QueryWhereOptions = {}): string {
    const meta = getMeta(entity);
    const { usePrecedence, clause = 'WHERE', softDelete } = opts;

    where = buldQueryWhereAsMap(meta, where);

    if (meta.softDelete && (softDelete || softDelete === undefined) && !where[meta.softDelete as string]) {
      where[meta.softDelete as string] = null;
    }

    const entries = Object.entries(where);

    if (!entries.length) {
      return '';
    }

    const options = { ...opts, usePrecedence: entries.length > 1 };

    let sql = entries
      .map(([key, val]) => this.compare(entity, key as keyof QueryWhereMap<E>, val as any, options))
      .join(` AND `);

    if (usePrecedence) {
      sql = `(${sql})`;
    }

    return clause ? ` ${clause} ${sql}` : sql;
  }

  compare<E, K extends keyof QueryWhereMap<E>>(
    entity: Type<E>,
    key: K,
    val: QueryWhereMap<E>[K],
    opts: QueryComparisonOptions = {},
  ): string {
    const meta = getMeta(entity);

    if (val instanceof QueryRaw) {
      if (key === '$exists' || key === '$nexists') {
        const value = val as QueryRaw;
        const query = this.getRawValue({
          value,
          prefix: meta.name,
          escapedPrefix: this.escapeId(meta.name, false, true),
        });
        return `${key === '$exists' ? 'EXISTS' : 'NOT EXISTS'} (${query})`;
      }
      const comparisonKey = this.getComparisonKey(entity, key as FieldKey<E>, opts);
      return `${String(comparisonKey)} = ${String(val.value)}`;
    }

    if (key === '$text') {
      const search = val as QueryTextSearchOptions<E>;
      const fields = search.$fields.map((field) => this.escapeId(meta.fields[field].name));
      return `MATCH(${fields.join(', ')}) AGAINST(${this.escape(search.$value)})`;
    }

    if (key === '$and' || key === '$or' || key === '$not' || key === '$nor') {
      const negateOperatorMap = {
        $not: '$and',
        $nor: '$or',
      } as const;

      const op: '$and' | '$or' = negateOperatorMap[key as string] ?? key;
      const negate = key in negateOperatorMap ? 'NOT ' : '';

      const values = val as QueryWhereArray<E>;
      const hasManyItems = values.length > 1;
      const logicalComparison = values
        .map((whereEntry) => {
          if (whereEntry instanceof QueryRaw) {
            return this.getRawValue({
              value: whereEntry,
              prefix: opts.prefix,
              escapedPrefix: this.escapeId(opts.prefix, true, true),
            });
          }
          return this.where(entity, whereEntry, {
            prefix: opts.prefix,
            usePrecedence: hasManyItems && !Array.isArray(whereEntry) && getKeys(whereEntry).length > 1,
            clause: false,
          });
        })
        .join(op === '$or' ? ' OR ' : ' AND ');

      return (opts.usePrecedence || negate) && hasManyItems
        ? `${negate}(${logicalComparison})`
        : `${negate}${logicalComparison}`;
    }

    const value = Array.isArray(val) ? { $in: val } : typeof val === 'object' && val !== null ? val : { $eq: val };
    const operators = getKeys(value) as (keyof QueryWhereFieldOperatorMap<E>)[];
    const comparisons = operators
      .map((op) => this.compareFieldOperator(entity, key as FieldKey<E>, op, value[op], opts))
      .join(' AND ');

    return operators.length > 1 ? `(${comparisons})` : comparisons;
  }

  compareFieldOperator<E, K extends keyof QueryWhereFieldOperatorMap<E>>(
    entity: Type<E>,
    key: FieldKey<E>,
    op: K,
    val: QueryWhereFieldOperatorMap<E>[K],
    opts: QueryOptions = {},
  ): string {
    const comparisonKey = this.getComparisonKey(entity, key, opts);
    switch (op) {
      case '$eq':
        return val === null ? `${String(comparisonKey)} IS NULL` : `${String(comparisonKey)} = ${this.escape(val)}`;
      case '$ne':
        return val === null
          ? `${String(comparisonKey)} IS NOT NULL`
          : `${String(comparisonKey)} <> ${this.escape(val)}`;
      case '$not':
        return this.compare(entity, '$not', [{ [key]: val }] as any, opts);
      case '$gt':
        return `${String(comparisonKey)} > ${this.escape(val)}`;
      case '$gte':
        return `${String(comparisonKey)} >= ${this.escape(val)}`;
      case '$lt':
        return `${String(comparisonKey)} < ${this.escape(val)}`;
      case '$lte':
        return `${String(comparisonKey)} <= ${this.escape(val)}`;
      case '$startsWith':
        return `${String(comparisonKey)} LIKE ${this.escape(`${val}%`)}`;
      case '$istartsWith':
        return `LOWER(${String(comparisonKey)}) LIKE ${this.escape((val as string).toLowerCase() + '%')}`;
      case '$endsWith':
        return `${String(comparisonKey)} LIKE ${this.escape(`%${val}`)}`;
      case '$iendsWith':
        return `LOWER(${String(comparisonKey)}) LIKE ${this.escape('%' + (val as string).toLowerCase())}`;
      case '$includes':
        return `${String(comparisonKey)} LIKE ${this.escape(`%${val}%`)}`;
      case '$iincludes':
        return `LOWER(${String(comparisonKey)}) LIKE ${this.escape('%' + (val as string).toLowerCase() + '%')}`;
      case '$ilike':
        return `LOWER(${String(comparisonKey)}) LIKE ${this.escape((val as string).toLowerCase())}`;
      case '$like':
        return `${String(comparisonKey)} LIKE ${this.escape(val)}`;
      case '$in':
        return `${String(comparisonKey)} IN (${this.escape(val)})`;
      case '$nin':
        return `${String(comparisonKey)} NOT IN (${this.escape(val)})`;
      case '$regex':
        return `${String(comparisonKey)} REGEXP ${this.escape(val)}`;
      default:
        throw TypeError(`unknown operator: ${op}`);
    }
  }

  getComparisonKey<E>(entity: Type<E>, key: FieldKey<E>, { prefix }: QueryOptions = {}): Scalar {
    const meta = getMeta(entity);
    const escapedPrefix = this.escapeId(prefix, true, true);
    const field = meta.fields[key];

    if (field?.virtual) {
      return this.getRawValue({
        value: field.virtual,
        prefix,
        escapedPrefix,
      });
    }

    return escapedPrefix + this.escapeId(field?.name ?? key);
  }

  sort<E>(entity: Type<E>, sort: QuerySort<E>, { prefix }: QueryOptions): string {
    const sortMap = buildSortMap(sort);
    if (!hasKeys(sortMap)) {
      return '';
    }
    const meta = getMeta(entity);
    const flattenedSort = flatObject(sortMap, prefix);
    const directionMap = { 1: '', asc: '', '-1': ' DESC', desc: ' DESC' } as const;
    const order = Object.entries(flattenedSort)
      .map(([key, sort]) => {
        const name = meta.fields[key]?.name ?? key;
        const direction = directionMap[sort as QuerySortDirection];
        return this.escapeId(name) + direction;
      })
      .join(', ');
    return ` ORDER BY ${order}`;
  }

  pager(opts: QueryPager): string {
    let sql = '';
    if (opts.$limit) {
      sql += ` LIMIT ${Number(opts.$limit)}`;
    }
    if (opts.$skip !== undefined) {
      sql += ` OFFSET ${Number(opts.$skip)}`;
    }
    return sql;
  }

  count<E>(entity: Type<E>, q: QuerySearch<E>, opts?: QueryOptions): string {
    const search: Query<E> = {
      ...q,
    };
    delete search.$sort;
    const select = this.select<E>(entity, [raw('COUNT(*)', 'count')]);
    const criteria = this.search(entity, search, opts);
    return select + criteria;
  }

  find<E>(entity: Type<E>, q: Query<E>, opts?: QueryOptions): string {
    const select = this.select(entity, q.$select, opts);
    const criteria = this.search(entity, q, opts);
    return select + criteria;
  }

  insert<E>(entity: Type<E>, payload: E | E[]): string {
    const meta = getMeta(entity);
    const records = this.getPersistables(meta, payload, 'onInsert');
    const keys = getKeys(records[0]);
    const columns = keys.map((key) => this.escapeId(meta.fields[key].name));
    const values = records.map((record) => keys.map((key) => record[key]).join(', ')).join('), (');
    return `INSERT INTO ${this.escapeId(meta.name)} (${columns.join(', ')}) VALUES (${values})`;
  }

  update<E>(entity: Type<E>, q: QuerySearch<E>, payload: E, opts?: QueryOptions): string {
    const meta = getMeta(entity);
    const record = this.getPersistable(meta, payload, 'onUpdate');
    const keys = getKeys(record);
    const entries = keys.map((key) => `${this.escapeId(meta.fields[key].name)} = ${record[key]}`).join(', ');
    const criteria = this.search(entity, q, opts);
    return `UPDATE ${this.escapeId(meta.name)} SET ${entries}${criteria}`;
  }

  upsert<E>(entity: Type<E>, conflictPaths: QueryConflictPaths<E>, payload: E): string {
    const insert = this.insert(entity, payload);
    const meta = getMeta(entity);
    const update = this.getUpsertUpdateAssignments(meta, conflictPaths, payload, (name) => `VALUES(${name})`);
    return update ? `${insert} ON DUPLICATE KEY UPDATE ${update}` : insert.replace(/^INSERT/, 'INSERT IGNORE');
  }

  protected getUpsertUpdateAssignments<E>(
    meta: EntityMeta<E>,
    conflictPaths: QueryConflictPaths<E>,
    payload: E,
    callback: (columnName: string) => string,
  ): string {
    fillOnFields(meta, payload, 'onUpdate');
    const fields = filterFieldKeys(meta, payload, 'onUpdate');
    return fields
      .filter((col) => !conflictPaths[col])
      .map((col) => {
        const columnName = this.escapeId(meta.fields[col].name);
        return `${columnName} = ${callback(columnName)}`;
      })
      .join(', ');
  }

  protected getUpsertConflictPathsStr<E>(meta: EntityMeta<E>, conflictPaths: QueryConflictPaths<E>): string {
    return getKeys(conflictPaths)
      .map((key) => this.escapeId(meta.fields[key]?.name ?? key))
      .join(', ');
  }

  delete<E>(entity: Type<E>, q: QuerySearch<E>, opts: QueryOptions = {}): string {
    const meta = getMeta(entity);

    if (opts.softDelete || opts.softDelete === undefined) {
      if (meta.softDelete) {
        const criteria = this.search(entity, q, opts);
        const value = getFieldCallbackValue(meta.fields[meta.softDelete].onDelete);
        return `UPDATE ${this.escapeId(meta.name)} SET ${this.escapeId(meta.softDelete)} = ${this.escape(
          value,
        )}${criteria}`;
      }
      if (opts.softDelete) {
        throw TypeError(`'${meta.name}' has not enabled 'softDelete'`);
      }
    }

    const criteria = this.search(entity, q, opts);

    return `DELETE FROM ${this.escapeId(meta.name)}${criteria}`;
  }

  escapeId(val: string, forbidQualified?: boolean, addDot?: boolean): string {
    if (!val) {
      return '';
    }

    if (!forbidQualified && val.includes('.')) {
      return val
        .split('.')
        .map((it) => this.escapeId(it))
        .join('.');
    }

    // sourced from 'escapeId' function here https://github.com/mysqljs/sqlstring/blob/master/lib/SqlString.js
    const escaped =
      this.escapeIdChar + val.replace(this.escapeIdRegex, this.escapeIdChar + this.escapeIdChar) + this.escapeIdChar;

    const suffix = addDot ? '.' : '';

    return escaped + suffix;
  }

  getPersistable<E>(meta: EntityMeta<E>, payload: E, callbackKey: CallbackKey): E {
    return this.getPersistables(meta, payload, callbackKey)[0];
  }

  getPersistables<E>(meta: EntityMeta<E>, payload: E | E[], callbackKey: CallbackKey): E[] {
    const payloads = fillOnFields(meta, payload, callbackKey);
    const fieldKeys = filterFieldKeys(meta, payloads[0], callbackKey);
    return payloads.map((it) =>
      fieldKeys.reduce((acc, key) => {
        const { type } = meta.fields[key];
        let value = it[key];
        if (value instanceof QueryRaw) {
          value = this.getRawValue({ value }) as E[FieldKey<E>];
        } else if (type === 'json' || type === 'jsonb') {
          value = (this.escape(JSON.stringify(value)) + `::${type}`) as E[FieldKey<E>];
        } else if (type === 'vector') {
          value = (value as number[]).map((num) => +num).join(',') as E[FieldKey<E>];
          value = `'[${value}]'` as E[FieldKey<E>];
        } else {
          value = this.escape(value) as E[FieldKey<E>];
        }
        acc[key] = value;
        return acc;
      }, {} as E),
    );
  }

  getRawValue(opts: QueryRawFnOptions & { value: QueryRaw; autoPrefixAlias?: boolean }) {
    const { value, prefix = '', autoPrefixAlias } = opts;
    const val =
      typeof value.value === 'function' ? value.value({ ...opts, dialect: this }) : prefix + String(value.value);
    const alias = value.alias;
    if (alias) {
      const fullAlias = autoPrefixAlias ? prefix + alias : alias;
      const escapedFullAlias = this.escapeId(fullAlias, true);
      return `${val} ${escapedFullAlias}`;
    }
    return val;
  }

  abstract escape(value: unknown): string;
}
