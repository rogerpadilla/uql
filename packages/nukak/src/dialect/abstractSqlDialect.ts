import {
  QueryFilter,
  Scalar,
  QueryFilterFieldOperatorMap,
  QuerySort,
  QueryPager,
  QueryTextSearchOptions,
  FieldKey,
  QueryProject,
  Type,
  QueryProjectArray,
  QueryOptions,
  QueryDialect,
  QueryFilterOptions,
  QueryComparisonOptions,
  QueryFilterMap,
  QueryProjectOptions,
  QuerySortDirection,
  QueryFilterLogical,
  QueryRaw,
  QueryProjectOperation,
  QuerySearch,
  QueryCriteria,
  Query,
} from '../type/index.js';
import {
  getPersistable,
  getProjectRelationKeys,
  getPersistables,
  isProjectingRelations,
  getKeys,
  hasKeys,
  buildSortMap,
  flatObject,
  getRawValue,
  raw,
  getQueryFilterAsMap,
  getFieldCallbackValue,
} from '../util/index.js';

import { getMeta } from '../entity/index.js';

export abstract class AbstractSqlDialect implements QueryDialect {
  readonly escapeIdRegex: RegExp;

  constructor(readonly escapeIdChar: '`' | '"' = '`', readonly beginTransactionCommand: string = 'START TRANSACTION') {
    this.escapeIdRegex = RegExp(escapeIdChar, 'g');
  }

  criteria<E, P extends QueryProject<E>>(entity: Type<E>, qm: QueryCriteria<E>, project: P, opts: QueryOptions = {}): string {
    const meta = getMeta(entity);
    const prefix = opts.prefix ?? (opts.autoPrefix || isProjectingRelations(meta, project)) ? meta.name : undefined;
    opts = { ...opts, prefix };
    const where = this.where<E>(entity, qm.$filter, opts);
    const group = this.group<E>(entity, qm.$group);
    const having = this.where<E>(entity, qm.$having, { ...opts, clause: 'HAVING' });
    const sort = this.sort<E>(entity, qm.$sort, opts);
    const pager = this.pager(qm);
    return where + group + having + sort + pager;
  }

  projectFields<E, P extends QueryProject<E>>(entity: Type<E>, project: P, opts: QueryProjectOptions): string {
    const meta = getMeta(entity);
    const prefix = opts.prefix ? opts.prefix + '.' : '';
    const escapedPrefix = this.escapeId(opts.prefix, true, true);

    let projectArr: QueryProjectArray<E>;

    if (project) {
      if (Array.isArray(project)) {
        projectArr = project;
      } else {
        const projectPositive = getKeys(project).filter((it) => project[it]);
        projectArr = projectPositive.length
          ? projectPositive.map((it) => {
              const val = project[it];
              if (val instanceof QueryRaw) {
                return raw(val.value, it);
              }
              if (typeof val === 'object' && !(it in meta.relations)) {
                return this.projectOperation(val, it);
              }
              return it as FieldKey<E>;
            })
          : (getKeys(meta.fields).filter((it) => !(it in project)) as FieldKey<E>[]);
      }
      projectArr = projectArr.filter((it) => it instanceof QueryRaw || it in meta.fields);
      if (opts.prefix && !projectArr.includes(meta.id)) {
        projectArr = [meta.id, ...projectArr];
      }
    } else {
      projectArr = getKeys(meta.fields) as FieldKey<E>[];
    }

    return projectArr
      .map((key) => {
        if (key instanceof QueryRaw) {
          return getRawValue({
            value: key,
            dialect: this,
            prefix,
            escapedPrefix,
            autoPrefixAlias: opts.autoPrefixAlias,
          });
        }

        const field = meta.fields[key as FieldKey<E>];

        if (field.virtual) {
          return getRawValue({
            value: raw(field.virtual.value, key),
            dialect: this,
            prefix,
            escapedPrefix,
            autoPrefixAlias: opts.autoPrefixAlias,
          });
        }

        const fieldPath = `${escapedPrefix}${this.escapeId(field.name)}`;

        return !opts.autoPrefixAlias && field.name === key ? fieldPath : `${fieldPath} ${this.escapeId((prefix + key) as FieldKey<E>, true)}`;
      })
      .join(', ');
  }

  projectOperation<E>(operation: QueryProjectOperation<E>, alias: string): QueryRaw {
    const operator = Object.keys(operation)[0] as keyof QueryProjectOperation<E>;
    const val = operation[operator] as any;
    let formula: string;
    switch (operator) {
      case '$count':
        formula = `COUNT(${val === 1 ? '*' : val})`;
        break;
      case '$max':
        formula = `MAX(${this.escapeId(val)})`;
        break;
      case '$min':
        formula = `MIN(${this.escapeId(val)})`;
        break;
      case '$avg':
        formula = `AVG(${this.escapeId(val)})`;
        break;
      case '$sum':
        formula = `SUM(${this.escapeId(val)})`;
        break;
      default:
        throw TypeError(`Unexpected operation ${JSON.stringify(operation, null, 2)} - ${alias}`);
    }
    return raw(formula, alias);
  }

  projectRelations<E>(entity: Type<E>, project: QueryProject<E> = {}, { prefix }: { prefix?: string } = {}): { fields: string; tables: string } {
    const meta = getMeta(entity);
    const relations = getProjectRelationKeys(meta, project);
    const isProjectArray = Array.isArray(project);
    let fields = '';
    let tables = '';

    for (const key of relations) {
      const relOpts = meta.relations[key];

      if (relOpts.cardinality === '1m' || relOpts.cardinality === 'mm') {
        // '1m' and 'mm' should be resolved in a higher layer because they will need multiple queries
        continue;
      }

      const joinRelAlias = prefix ? prefix + '.' + key : key;
      const relEntity = relOpts.entity();
      const relProject = project[key as string];
      const relQuery = isProjectArray ? {} : Array.isArray(relProject) ? { $project: relProject } : relProject;

      const relColumns = this.projectFields(relEntity, relQuery.$project, {
        prefix: joinRelAlias,
        autoPrefixAlias: true,
      });

      fields += ', ' + relColumns;

      const { fields: subColumns, tables: subTables } = this.projectRelations(relEntity, relQuery.$project, {
        prefix: joinRelAlias,
      });

      fields += subColumns;

      const relMeta = getMeta(relEntity);
      const relEntityName = this.escapeId(relMeta.name);
      const relPath = prefix ? this.escapeId(prefix, true) : this.escapeId(meta.name);
      const joinType = relQuery.$required ? 'INNER' : 'LEFT';
      const joinAlias = this.escapeId(joinRelAlias, true);

      tables += ` ${joinType} JOIN ${relEntityName} ${joinAlias} ON `;
      tables += relOpts.references.map((it) => `${joinAlias}.${this.escapeId(it.foreign)} = ${relPath}.${this.escapeId(it.local)}`).join(' AND ');

      if (relQuery.$filter) {
        const filter = this.where(relEntity, relQuery.$filter, { prefix: key, clause: false });
        tables += ` AND ${filter}`;
      }

      tables += subTables;
    }

    return { fields, tables };
  }

  select<E>(entity: Type<E>, project: QueryProject<E>, opts: QueryOptions = {}): string {
    const meta = getMeta(entity);
    const prefix = opts.prefix ?? (opts.autoPrefix || isProjectingRelations(meta, project)) ? meta.name : undefined;

    const fields = this.projectFields(entity, project, { prefix });
    const { fields: relationFields, tables } = this.projectRelations(entity, project);

    return `SELECT ${fields}${relationFields} FROM ${this.escapeId(meta.name)}${tables}`;
  }

  where<E>(entity: Type<E>, filter: QueryFilter<E> = {}, opts: QueryFilterOptions): string {
    const meta = getMeta(entity);
    const { usePrecedence, clause = 'WHERE', softDelete } = opts;

    filter = getQueryFilterAsMap(meta, filter);

    if (meta.softDelete && (softDelete || softDelete === undefined) && clause !== 'HAVING' && !filter[meta.softDelete as string]) {
      filter[meta.softDelete as string] = null;
    }

    const entries = Object.entries(filter);

    if (!entries.length) {
      return '';
    }

    const options = { ...opts, usePrecedence: entries.length > 1 };

    let sql = entries.map(([key, val]) => this.compare(entity, key as keyof QueryFilterMap<E>, val as any, options)).join(` AND `);

    if (usePrecedence) {
      sql = `(${sql})`;
    }

    return clause ? ` ${clause} ${sql}` : sql;
  }

  compare<E, K extends keyof QueryFilterMap<E>>(entity: Type<E>, key: K, val: QueryFilterMap<E>[K], opts?: QueryComparisonOptions): string {
    const meta = getMeta(entity);

    if (val instanceof QueryRaw) {
      if (key === '$exists' || key === '$nexists') {
        const value = val as QueryRaw;
        const query = getRawValue({
          value,
          dialect: this,
          prefix: meta.name,
          escapedPrefix: this.escapeId(meta.name, false, true),
        });
        return `${key === '$exists' ? 'EXISTS' : 'NOT EXISTS'} (${query})`;
      }
      const comparisonKey = this.getComparisonKey(entity, key as FieldKey<E>, opts);
      return `${comparisonKey} = ${val.value}`;
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

      const values = val as QueryFilterLogical<E>;
      const hasManyItems = values.length > 1;
      const logicalComparison = values
        .map((filterEntry) => {
          if (filterEntry instanceof QueryRaw) {
            return getRawValue({
              value: filterEntry,
              dialect: this,
              prefix: opts.prefix,
              escapedPrefix: this.escapeId(opts.prefix, true, true),
            });
          }
          return this.where(entity, filterEntry, {
            prefix: opts.prefix,
            usePrecedence: hasManyItems && !Array.isArray(filterEntry) && getKeys(filterEntry).length > 1,
            clause: false,
          });
        })
        .join(op === '$or' ? ' OR ' : ' AND ');

      return (opts.usePrecedence || negate) && hasManyItems ? `${negate}(${logicalComparison})` : `${negate}${logicalComparison}`;
    }

    const value = Array.isArray(val) ? { $in: val } : typeof val === 'object' && val !== null ? val : { $eq: val };
    const operators = getKeys(value) as (keyof QueryFilterFieldOperatorMap<E>)[];
    const comparisons = operators.map((op) => this.compareFieldOperator(entity, key as FieldKey<E>, op, value[op], opts)).join(' AND ');

    return operators.length > 1 ? `(${comparisons})` : comparisons;
  }

  compareFieldOperator<E, K extends keyof QueryFilterFieldOperatorMap<E>>(
    entity: Type<E>,
    key: FieldKey<E>,
    op: K,
    val: QueryFilterFieldOperatorMap<E>[K],
    opts?: QueryOptions
  ): string {
    const comparisonKey = this.getComparisonKey(entity, key, opts);
    switch (op) {
      case '$eq':
        return val === null ? `${comparisonKey} IS NULL` : `${comparisonKey} = ${this.escape(val)}`;
      case '$ne':
        return val === null ? `${comparisonKey} IS NOT NULL` : `${comparisonKey} <> ${this.escape(val)}`;
      case '$not':
        return this.compare(entity, '$not', [{ [key]: val }] as any, opts);
      case '$gt':
        return `${comparisonKey} > ${this.escape(val)}`;
      case '$gte':
        return `${comparisonKey} >= ${this.escape(val)}`;
      case '$lt':
        return `${comparisonKey} < ${this.escape(val)}`;
      case '$lte':
        return `${comparisonKey} <= ${this.escape(val)}`;
      case '$startsWith':
        return `${comparisonKey} LIKE ${this.escape(`${val}%`)}`;
      case '$istartsWith':
        return `LOWER(${comparisonKey}) LIKE ${this.escape((val as string).toLowerCase() + '%')}`;
      case '$endsWith':
        return `${comparisonKey} LIKE ${this.escape(`%${val}`)}`;
      case '$iendsWith':
        return `LOWER(${comparisonKey}) LIKE ${this.escape('%' + (val as string).toLowerCase())}`;
      case '$includes':
        return `${comparisonKey} LIKE ${this.escape(`%${val}%`)}`;
      case '$iincludes':
        return `LOWER(${comparisonKey}) LIKE ${this.escape('%' + (val as string).toLowerCase() + '%')}`;
      case '$ilike':
        return `LOWER(${comparisonKey}) LIKE ${this.escape((val as string).toLowerCase())}`;
      case '$like':
        return `${comparisonKey} LIKE ${this.escape(val)}`;
      case '$in':
        return `${comparisonKey} IN (${this.escape(val)})`;
      case '$nin':
        return `${comparisonKey} NOT IN (${this.escape(val)})`;
      case '$regex':
        return `${comparisonKey} REGEXP ${this.escape(val)}`;
      default:
        throw TypeError(`unknown operator: ${op}`);
    }
  }

  getComparisonKey<E>(entity: Type<E>, key: FieldKey<E>, { prefix }: QueryOptions): Scalar {
    const meta = getMeta(entity);
    const escapedPrefix = this.escapeId(prefix, true, true);
    const field = meta.fields[key];

    if (field?.virtual) {
      return getRawValue({
        value: field.virtual,
        dialect: this,
        prefix,
        escapedPrefix,
      });
    }

    return escapedPrefix + this.escapeId(field?.name ?? key);
  }

  group<E>(entity: Type<E>, fields: readonly FieldKey<E>[]): string {
    if (!fields?.length) {
      return '';
    }
    const meta = getMeta(entity);
    const names = fields.map((key) => this.escapeId(meta.fields[key]?.name ?? key)).join(', ');
    return ` GROUP BY ${names}`;
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

  count<E>(entity: Type<E>, qm?: QuerySearch<E>, opts?: QueryOptions): string {
    const search: Query<E> = {
      ...qm,
    };

    delete search.$sort;
    delete search.$skip;
    delete search.$limit;

    const project = { count: { $count: 1 } } satisfies QueryProject<E>;

    const select = this.select<E>(entity, project);
    const criteria = this.criteria(entity, search, project, opts);

    return select + criteria;
  }

  find<E, P extends QueryProject<E>>(entity: Type<E>, qm: QueryCriteria<E>, project?: P, opts?: QueryOptions): string {
    const select = this.select(entity, project, opts);
    const criteria = this.criteria(entity, qm, project, opts);
    return select + criteria;
  }

  insert<E>(entity: Type<E>, payload: E | E[]): string {
    const meta = getMeta(entity);
    const records = getPersistables(meta, payload, 'onInsert');
    const keys = getKeys(records[0]);
    const columns = keys.map((key) => this.escapeId(meta.fields[key].name));
    const values = records.map((record) => keys.map((key) => this.escape(record[key])).join(', ')).join('), (');
    return `INSERT INTO ${this.escapeId(meta.name)} (${columns.join(', ')}) VALUES (${values})`;
  }

  update<E>(entity: Type<E>, qm: QuerySearch<E>, payload: E, opts?: QueryOptions): string {
    const meta = getMeta(entity);
    const record = getPersistable(meta, payload, 'onUpdate');
    const keys = getKeys(record);
    const entries = keys.map((key) => `${this.escapeId(key)} = ${this.escape(payload[key])}`).join(', ');
    const criteria = this.criteria(entity, qm, undefined, opts);
    return `UPDATE ${this.escapeId(meta.name)} SET ${entries}${criteria}`;
  }

  delete<E>(entity: Type<E>, qm: QuerySearch<E>, opts: QueryOptions = {}): string {
    const meta = getMeta(entity);

    if (opts.softDelete || opts.softDelete === undefined) {
      if (meta.softDelete) {
        const criteria = this.criteria(entity, qm, undefined, opts);
        const value = getFieldCallbackValue(meta.fields[meta.softDelete].onDelete);
        return `UPDATE ${this.escapeId(meta.name)} SET ${this.escapeId(meta.softDelete)} = ${this.escape(value)}${criteria}`;
      } else if (opts.softDelete) {
        throw TypeError(`'${meta.name}' has not enabled 'softDelete'`);
      }
    }

    const criteria = this.criteria(entity, qm, undefined, opts);

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
    const escaped = this.escapeIdChar + val.replace(this.escapeIdRegex, this.escapeIdChar + this.escapeIdChar) + this.escapeIdChar;

    const suffix = addDot ? '.' : '';

    return escaped + suffix;
  }

  abstract escape(value: any): Scalar;
}
