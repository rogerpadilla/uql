import { escape } from 'sqlstring';
import { getMeta } from '../entity/decorator/definition';
import { getPersistable, getProjectRelationKeys, getPersistables, Raw, raw, isProjectingRelations, getVirtualValue, getRawValue } from '../querier';
import {
  QueryFilter,
  Query,
  Scalar,
  QueryFilterSingleFieldOperator,
  QuerySort,
  QueryPager,
  QueryTextSearchOptions,
  FieldKey,
  QueryProject,
  Type,
  QueryCriteria,
  QueryProjectArray,
  QueryOptions,
  QueryDialect,
  QueryFieldValue,
  QueryFilterOptions,
  QueryComparisonOptions,
  QueryFilterComparison,
  QuerySearch,
  QueryProjectOptions,
  QuerySortDirection,
} from '../type';
import { getKeys, hasKeys, buildSortMap } from '../util';

import { flatObject } from './sql.util';

export abstract class BaseSqlDialect implements QueryDialect {
  readonly escapeIdRegex: RegExp;

  constructor(readonly beginTransactionCommand: string, readonly escapeIdChar: '`' | '"') {
    this.escapeIdRegex = RegExp(escapeIdChar, 'g');
  }

  criteria<E>(entity: Type<E>, qm: Query<E>, opts: QueryOptions = {}): string {
    const meta = getMeta(entity);
    const prefix = opts.prefix ?? (opts.autoPrefix || isProjectingRelations(meta, qm.$project)) ? meta.name : undefined;
    const where = this.where<E>(entity, qm.$filter, { ...opts, prefix });
    const group = this.group<E>(entity, qm.$group, { ...opts, prefix });
    const having = this.where<E>(entity, qm.$having, { ...opts, prefix, clause: 'HAVING' });
    const sort = this.sort<E>(entity, qm.$sort, { ...opts, prefix });
    const pager = this.pager(qm);
    return where + group + having + sort + pager;
  }

  projectFields<E>(entity: Type<E>, project: QueryProject<E>, opts: QueryProjectOptions = {}): string {
    const meta = getMeta(entity);
    const prefix = opts.prefix ? opts.prefix + '.' : '';
    const escapedPrefix = this.escapeId(opts.prefix, true, true);

    let fields: QueryProjectArray<E>;

    if (project) {
      if (Array.isArray(project)) {
        fields = project;
      } else {
        const positiveProjectKeys = getKeys(project).filter((key) => project[key]);
        fields = positiveProjectKeys.length
          ? positiveProjectKeys.map((key) => {
              const val = project[key];
              if (val instanceof Raw) {
                return raw(val.value, key);
              }
              return key as FieldKey<E>;
            })
          : (getKeys(meta.fields).filter((it) => !(it in project) || project[it]) as FieldKey<E>[]);
      }
      fields = fields.filter((key) => key instanceof Raw || meta.fields[key as FieldKey<E>]);
      if (!fields.length || (opts.prefix && !fields.includes(meta.id))) {
        fields = [meta.id, ...fields];
      }
    } else {
      fields = getKeys(meta.fields) as FieldKey<E>[];
    }

    return fields
      .map((key) => {
        if (key instanceof Raw) {
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
          return getVirtualValue({
            value: field.virtual,
            alias: key as string,
            dialect: this,
            prefix,
            escapedPrefix,
            autoPrefixAlias: opts.autoPrefixAlias,
          });
        }

        const name = field?.name ?? (key as FieldKey<E>);
        const fieldPath = `${escapedPrefix}${this.escapeId(name)}`;

        return !opts.autoPrefixAlias && (name === key || !field) ? fieldPath : `${fieldPath} ${this.escapeId((prefix + key) as FieldKey<E>, true)}`;
      })
      .join(', ');
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
      tables += relOpts.references.map((it) => `${joinAlias}.${this.escapeId(it.target)} = ${relPath}.${this.escapeId(it.source)}`).join(' AND ');

      if (relQuery.$filter) {
        const filter = this.where(relEntity, relQuery.$filter, { prefix: key, clause: false });
        tables += ` AND ${filter}`;
      }

      tables += subTables;
    }

    return { fields, tables };
  }

  select<E>(entity: Type<E>, qm: Query<E>, opts: QueryOptions = {}): string {
    const meta = getMeta(entity);
    const prefix = opts.prefix ?? (opts.autoPrefix || isProjectingRelations(meta, qm.$project)) ? meta.name : undefined;

    const fields = this.projectFields(entity, qm.$project, { prefix });
    const { fields: relationFields, tables } = this.projectRelations(entity, qm.$project);

    return `SELECT ${fields}${relationFields} FROM ${this.escapeId(meta.name)}${tables}`;
  }

  where<E>(entity: Type<E>, filter: QueryFilter<E> = {}, opts: QueryFilterOptions = {}): string {
    const meta = getMeta(entity);
    const { usePrecedence, clause = 'WHERE', softDelete } = opts;

    if (typeof filter !== 'object' || Array.isArray(filter)) {
      filter = {
        [meta.id]: filter,
      };
    }

    if (meta.softDeleteKey && (softDelete || softDelete === undefined) && clause !== 'HAVING' && !(meta.softDeleteKey in filter)) {
      filter[meta.softDeleteKey as string] = null;
    }

    const entries = Object.entries(filter);

    if (!entries.length) {
      return '';
    }

    const options = { ...opts, usePrecedence: entries.length > 1 };

    let sql = entries.map(([key, val]) => this.compare(entity, key as keyof QueryFilterComparison<E>, val, options)).join(` AND `);

    if (usePrecedence) {
      sql = `(${sql})`;
    }

    return clause ? ` ${clause} ${sql}` : sql;
  }

  compare<E, K extends keyof QueryFilterComparison<E>>(entity: Type<E>, key: K, val: QueryFieldValue<E[K]>, opts?: QueryComparisonOptions): string {
    const meta = getMeta(entity);

    if (key === '$and' || key === '$or') {
      const values = val as E[K][];
      const hasManyItems = values.length > 1;
      const logicalComparison = values
        .map((filterEntry: QueryFilter<E>) => {
          if (filterEntry instanceof Raw) {
            return getRawValue({
              value: filterEntry,
              dialect: this,
              prefix: opts.prefix,
              escapedPrefix: this.escapeId(opts.prefix, true, true),
            });
          }
          return this.where(entity, filterEntry, {
            prefix: opts.prefix,
            usePrecedence: hasManyItems && getKeys(filterEntry).length > 1,
            clause: false,
          });
        })
        .join(key === '$or' ? ' OR ' : ' AND ');
      return opts.usePrecedence && hasManyItems ? `(${logicalComparison})` : logicalComparison;
    }

    if (key === '$not' || key === '$nor') {
      const op = (key === '$not' ? '$and' : '$or') as K;
      const values = val as E[K][];
      return `NOT ` + this.compare(entity, op, values, { usePrecedence: values.length > 1 });
    }

    if (key === '$exists' || key === '$nexists') {
      const value = val as Raw;
      const query = getRawValue({
        value,
        dialect: this,
        prefix: meta.name,
        escapedPrefix: this.escapeId(meta.name, false, true),
      });
      return `${key === '$exists' ? 'EXISTS' : 'NOT EXISTS'} (${query})`;
    }

    if (key === '$text') {
      const search = val as QueryTextSearchOptions<E>;
      return `${this.escapeId(meta.name)} MATCH ${this.escape(search.$value)}`;
    }

    if (val instanceof Raw) {
      const comparisonKey = this.getComparisonKey(entity, key, opts);
      return `${comparisonKey} = ${val.value}`;
    }

    const value = Array.isArray(val) ? { $in: val } : typeof val === 'object' && val !== null ? val : { $eq: val };
    const operators = getKeys(value) as (keyof QueryFilterSingleFieldOperator<E>)[];
    const comparisons = operators.map((op) => this.compareSingleOperator(entity, key, op, value[op], opts)).join(' AND ');

    return operators.length > 1 ? `(${comparisons})` : comparisons;
  }

  compareSingleOperator<E, K extends keyof QueryFilterComparison<E>>(
    entity: Type<E>,
    key: K,
    op: keyof QueryFilterSingleFieldOperator<E>,
    val: QueryFieldValue<E[K]>,
    opts?: QueryOptions
  ): string {
    const comparisonKey = this.getComparisonKey(entity, key, opts);
    switch (op) {
      case '$eq':
        return val === null ? `${comparisonKey} IS NULL` : `${comparisonKey} = ${this.escape(val)}`;
      case '$ne':
        return val === null ? `${comparisonKey} IS NOT NULL` : `${comparisonKey} <> ${this.escape(val)}`;
      case '$gt':
        return `${comparisonKey} > ${this.escape(val)}`;
      case '$gte':
        return `${comparisonKey} >= ${this.escape(val)}`;
      case '$lt':
        return `${comparisonKey} < ${this.escape(val)}`;
      case '$lte':
        return `${comparisonKey} <= ${this.escape(val)}`;
      case '$startsWith':
        return `${comparisonKey} LIKE ${this.escape((val as string) + '%')}`;
      case '$istartsWith':
        return `LOWER(${comparisonKey}) LIKE ${this.escape((val as string).toLowerCase() + '%')}`;
      case '$endsWith':
        return `${comparisonKey} LIKE ${this.escape('%' + (val as string))}`;
      case '$iendsWith':
        return `LOWER(${comparisonKey}) LIKE ${this.escape('%' + (val as string).toLowerCase())}`;
      case '$includes':
        return `${comparisonKey} LIKE ${this.escape('%' + (val as string) + '%')}`;
      case '$iincludes':
        return `LOWER(${comparisonKey}) LIKE ${this.escape('%' + (val as string).toLowerCase() + '%')}`;
      case '$ilike':
        return `LOWER(${comparisonKey}) LIKE ${this.escape((val as string).toLowerCase())}`;
      case '$like':
        return `${comparisonKey} LIKE ${this.escape(val as string)}`;
      case '$in':
        return `${comparisonKey} IN (${this.escape(val)})`;
      case '$nin':
        return `${comparisonKey} NOT IN (${this.escape(val)})`;
      case '$regex':
        return `${comparisonKey} REGEXP ${this.escape(val)}`;
      default:
        throw new TypeError(`unknown operator: ${op}`);
    }
  }

  getComparisonKey<E>(entity: Type<E>, key: FieldKey<E>, { prefix }: QueryOptions = {}): Scalar {
    const meta = getMeta(entity);
    const escapedPrefix = this.escapeId(prefix, true, true);
    const field = meta.fields[key];

    if (field?.virtual) {
      return getVirtualValue({
        value: field.virtual,
        dialect: this,
        prefix,
        escapedPrefix,
      });
    }

    return escapedPrefix + this.escapeId(field?.name ?? key);
  }

  group<E>(entity: Type<E>, fields: readonly FieldKey<E>[], opts: QueryOptions = {}): string {
    if (!fields?.length) {
      return '';
    }
    const meta = getMeta(entity);
    const names = fields.map((key) => this.escapeId(meta.fields[key]?.name ?? key)).join(', ');
    return ` GROUP BY ${names}`;
  }

  sort<E>(entity: Type<E>, sort: QuerySort<E>, { prefix }: QueryOptions = {}): string {
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

  count<E>(entity: Type<E>, qm: QuerySearch<E>, opts?: QueryOptions): string {
    const search: Query<E> = {
      ...qm,
      $project: [raw('COUNT(*)', 'count')],
    };

    delete search.$sort;
    delete search.$skip;
    delete search.$limit;

    const select = this.select<E>(entity, search);
    const criteria = this.criteria(entity, search, opts);

    return select + criteria;
  }

  find<E>(entity: Type<E>, qm: Query<E>, opts?: QueryOptions): string {
    const select = this.select<E>(entity, qm, opts);
    const criteria = this.criteria(entity, qm, opts);
    return select + criteria;
  }

  insert<E>(entity: Type<E>, payload: E | E[]): string {
    const meta = getMeta(entity);
    payload = getPersistables(meta, payload, 'onInsert');
    const keys = getKeys(payload[0]);
    const columns = keys.map((key) => this.escapeId(meta.fields[key].name));
    const values = payload.map((it) => keys.map((key) => this.escape(it[key])).join(', ')).join('), (');
    return `INSERT INTO ${this.escapeId(meta.name)} (${columns.join(', ')}) VALUES (${values})`;
  }

  update<E>(entity: Type<E>, qm: QueryCriteria<E>, payload: E, opts?: QueryOptions): string {
    const meta = getMeta(entity);
    payload = getPersistable(meta, payload, 'onUpdate');
    const values = getKeys(payload)
      .map((key) => `${this.escapeId(key)} = ${this.escape(payload[key])}`)
      .join(', ');
    const criteria = this.criteria(entity, qm, opts);
    return `UPDATE ${this.escapeId(meta.name)} SET ${values}${criteria}`;
  }

  delete<E>(entity: Type<E>, qm: QueryCriteria<E>, opts: QueryOptions = {}): string {
    const meta = getMeta(entity);

    if (opts.softDelete || opts.softDelete === undefined) {
      if (meta.softDeleteKey) {
        const criteria = this.criteria(entity, qm, opts);
        const value = meta.fields[meta.softDeleteKey].onDelete();
        return `UPDATE ${this.escapeId(meta.name)} SET ${this.escapeId(meta.softDeleteKey)} = ${this.escape(value)}${criteria}`;
      } else if (opts.softDelete) {
        throw new TypeError(`'${meta.name}' has not enabled 'softDelete'`);
      }
    }

    const criteria = this.criteria(entity, qm, opts);

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

  escape(value: any): Scalar {
    if (value instanceof Raw) {
      return getRawValue({ value, dialect: this });
    }
    return escape(value);
  }
}
