import { escape } from 'sqlstring';
import { getMeta } from '../entity/decorator/definition';
import {
  getPersistable,
  getProjectRelationKeys,
  getPersistables,
  Raw,
  raw,
  isProjectingRelations,
  getVirtualValue,
  getRawValue,
} from '../querier';
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
} from '../type';
import { getKeys } from '../util';
import { objectToValues } from './sql.util';

export abstract class BaseSqlDialect implements QueryDialect {
  readonly escapeIdRegex: RegExp;

  constructor(readonly beginTransactionCommand: string, readonly escapeIdChar: '`' | '"') {
    this.escapeIdRegex = RegExp(escapeIdChar, 'g');
  }

  criteria<E>(entity: Type<E>, qm: Query<E>, opts: QueryOptions = {}): string {
    const meta = getMeta(entity);
    const usePrefix = opts.usePrefix || isProjectingRelations(meta, qm.$project);
    const prefix = usePrefix ? opts.prefix ?? meta.name : undefined;
    const where = this.filter<E>(entity, qm.$filter, { ...opts, prefix });
    const group = this.group<E>(entity, qm.$group);
    const having = this.filter<E>(entity, qm.$having, { prefix, clause: 'HAVING' });
    const sort = this.sort<E>(entity, qm.$sort);
    const pager = this.pager(qm);
    return where + group + having + sort + pager;
  }

  project<E>(entity: Type<E>, project: QueryProject<E>, opts: QueryOptions = {}): string {
    const meta = getMeta(entity);
    let projectArray: QueryProjectArray<E>;

    if (project) {
      if (Array.isArray(project)) {
        projectArray = project;
      } else {
        const positiveProjectKeys = getKeys(project).filter((key) => project[key]);
        projectArray = positiveProjectKeys.length
          ? positiveProjectKeys.map((key) => {
              const val = project[key];
              if (val instanceof Raw) {
                return raw(val.value, key);
              }
              return key as FieldKey<E>;
            })
          : (getKeys(meta.fields).filter((it) => !(it in project) || project[it]) as FieldKey<E>[]);
      }
      projectArray = projectArray.filter((key) => key instanceof Raw || meta.fields[key as FieldKey<E>]);
      if (!projectArray.length || (opts.prefix && !projectArray.includes(meta.id))) {
        projectArray.unshift(meta.id);
      }
    } else {
      projectArray = getKeys(meta.fields) as FieldKey<E>[];
    }

    return this.projectArray(entity, projectArray, opts);
  }

  projectArray<E>(entity: Type<E>, project: QueryProjectArray<E>, opts: QueryOptions = {}): string {
    const meta = getMeta(entity);
    const prefix = opts.prefix ? opts.prefix + '.' : '';
    const escapedPrefix = this.escapeId(opts.prefix, true, true);

    return project
      .map((key) => {
        if (key instanceof Raw) {
          return getRawValue({
            value: key,
            dialect: this,
            prefix,
            escapedPrefix,
            usePrefix: opts.usePrefix,
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
            usePrefix: opts.usePrefix,
          });
        }

        const name = field?.name ?? (key as FieldKey<E>);
        const fieldPath = `${escapedPrefix}${this.escapeId(name)}`;

        if (opts.usePrefix) {
          return `${fieldPath} ${this.escapeId(prefix + key, true)}`;
        }

        return name === key || !field ? fieldPath : `${fieldPath} ${this.escapeId(key as FieldKey<E>)}`;
      })
      .join(', ');
  }

  select<E>(entity: Type<E>, qm: Query<E>): string {
    const meta = getMeta(entity);
    const hasProjectRelations = isProjectingRelations(meta, qm.$project);
    const baseColumns = this.project(entity, qm.$project, {
      prefix: hasProjectRelations ? meta.name : undefined,
    });
    const { joinsColumns, joinsTables } = this.populate(entity, qm.$project);
    return `SELECT ${baseColumns}${joinsColumns} FROM ${this.escapeId(meta.name)}${joinsTables}`;
  }

  populate<E>(
    entity: Type<E>,
    project: QueryProject<E> = {},
    opts: QueryOptions = {}
  ): { joinsColumns: string; joinsTables: string } {
    const meta = getMeta(entity);
    const relations = getProjectRelationKeys(meta, project);
    const isProjectArray = Array.isArray(project);
    let joinsColumns = '';
    let joinsTables = '';

    for (const relKey of relations) {
      const relOpts = meta.relations[relKey];

      if (relOpts.cardinality === '1m' || relOpts.cardinality === 'mm') {
        // '1m' and 'mm' should be resolved in a higher layer because they will need multiple queries
        continue;
      }

      const joinRelAlias = opts.prefix ? opts.prefix + '.' + relKey : relKey;
      const relEntity = relOpts.entity();
      const relProject = project[relKey as string];
      const relQuery = isProjectArray ? {} : Array.isArray(relProject) ? { $project: relProject } : relProject;

      const relColumns = this.project(relEntity, relQuery.$project, {
        prefix: joinRelAlias,
        usePrefix: true,
      });

      joinsColumns += ', ' + relColumns;

      const { joinsColumns: subJoinsColumns, joinsTables: subJoinsTables } = this.populate(
        relEntity,
        relQuery.$project,
        { prefix: joinRelAlias }
      );

      joinsColumns += subJoinsColumns;

      const relMeta = getMeta(relEntity);
      const relEntityName = this.escapeId(relMeta.name);
      const relPath = opts.prefix ? this.escapeId(opts.prefix, true) : this.escapeId(meta.name);
      const joinType = relQuery.$required ? 'INNER' : 'LEFT';
      const joinAlias = this.escapeId(joinRelAlias, true);

      joinsTables += ` ${joinType} JOIN ${relEntityName} ${joinAlias} ON `;
      joinsTables += relOpts.references
        .map((it) => `${joinAlias}.${this.escapeId(it.target)} = ${relPath}.${this.escapeId(it.source)}`)
        .join(' AND ');

      if (relQuery.$filter) {
        const filter = this.filter(relEntity, relQuery.$filter, { prefix: relKey, clause: false });
        joinsTables += ` AND ${filter}`;
      }

      joinsTables += subJoinsTables;
    }

    return { joinsColumns, joinsTables };
  }

  filter<E>(entity: Type<E>, filter: QueryFilter<E>, opts: QueryFilterOptions = {}): string {
    const meta = getMeta(entity);
    const { usePrecedence, clause = 'WHERE', softDelete } = opts;

    if (filter !== undefined && (typeof filter !== 'object' || Array.isArray(filter))) {
      filter = {
        [meta.id]: filter,
      };
    }

    if (
      meta.softDeleteKey &&
      (softDelete === undefined || softDelete) &&
      clause !== 'HAVING' &&
      (!filter || !(meta.softDeleteKey in filter))
    ) {
      if (!filter) {
        filter = {};
      }
      filter[meta.softDeleteKey as string] = null;
    }

    const keys = getKeys(filter);
    if (!keys.length) {
      return '';
    }

    opts = { ...opts, usePrecedence: keys.length > 1 };

    let sql = keys
      .map((key) => this.compare(entity, key as keyof QueryFilterComparison<E>, filter[key], opts))
      .join(` AND `);

    if (usePrecedence) {
      sql = `(${sql})`;
    }

    return clause ? ` ${clause} ${sql}` : sql;
  }

  compare<E, K extends keyof QueryFilterComparison<E>>(
    entity: Type<E>,
    key: K,
    val: QueryFieldValue<E[K]>,
    opts?: QueryComparisonOptions
  ): string {
    const meta = getMeta(entity);

    if (key === '$and' || key === '$or') {
      const values = val as E[K][];
      const hasManyItems = values.length > 1;
      const logicalComparison = values
        .map((filterIt: QueryFilter<E>) => {
          if (filterIt instanceof Raw) {
            return getRawValue({
              value: filterIt,
              dialect: this,
              prefix: opts.prefix,
              escapedPrefix: this.escapeId(opts.prefix, true, true),
            });
          }
          return this.filter(entity, filterIt, {
            prefix: opts.prefix,
            usePrecedence: hasManyItems && getKeys(filterIt).length > 1,
            clause: false,
          });
        })
        .join(key === '$or' ? ' OR ' : ' AND ');
      return opts.usePrecedence && hasManyItems ? `(${logicalComparison})` : logicalComparison;
    }

    if (key === '$not' || key === '$nor') {
      const op = (key === '$not' ? '$and' : '$or') as K;
      const values = val as E[K][];
      return `NOT ` + this.compare(entity, op, values, { ...opts, usePrecedence: values.length > 1 });
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
    const comparisons = operators
      .map((op) => this.compareSingleOperator(entity, key, op, value[op], opts))
      .join(' AND ');

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
      case '$istartsWith':
        return `LOWER(${comparisonKey}) LIKE ${this.escape((val as string).toLowerCase() + '%')}`;
      case '$startsWith':
        return `${comparisonKey} LIKE ${this.escape((val as string) + '%')}`;
      case '$iendsWith':
        return `LOWER(${comparisonKey}) LIKE ${this.escape('%' + (val as string).toLowerCase())}`;
      case '$endsWith':
        return `${comparisonKey} LIKE ${this.escape('%' + (val as string))}`;
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

  group<E>(entity: Type<E>, fields: readonly FieldKey<E>[]): string {
    if (!fields?.length) {
      return '';
    }
    const meta = getMeta(entity);
    const names = fields.map((key) => this.escapeId(meta.fields[key]?.name ?? key)).join(', ');
    return ` GROUP BY ${names}`;
  }

  sort<E>(entity: Type<E>, sort: QuerySort<E>): string {
    const keys = getKeys(sort);
    if (!keys.length) {
      return '';
    }
    const meta = getMeta(entity);
    const order = keys
      .map((key) => {
        const field = meta.fields[key]?.name ?? key;
        const direction = sort[key] === -1 ? ' DESC' : '';
        return this.escapeId(field) + direction;
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

  count<E>(entity: Type<E>, qm: QuerySearch<E>, opts?: QueryOptions): string {
    const search: Query<E> = {
      ...qm,
      $project: [raw('COUNT(*)', 'count')],
    };

    delete search.$sort;
    delete search.$skip;
    delete search.$limit;

    return this.find(entity, search, opts);
  }

  find<E>(entity: Type<E>, qm: Query<E>, opts?: QueryOptions): string {
    const select = this.select<E>(entity, qm);
    return select + this.criteria(entity, qm, opts);
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
    const values = objectToValues(this, payload);
    const criteria = this.criteria(entity, qm, opts);
    return `UPDATE ${this.escapeId(meta.name)} SET ${values}${criteria}`;
  }

  delete<E>(entity: Type<E>, qm: QueryCriteria<E>, opts: QueryOptions = {}): string {
    const meta = getMeta(entity);

    if (opts.softDelete === undefined || opts.softDelete) {
      if (meta.softDeleteKey) {
        const criteria = this.criteria(entity, qm, opts);
        const value = this.escape(meta.fields[meta.softDeleteKey].onDelete());
        return `UPDATE ${this.escapeId(meta.name)} SET ${this.escapeId(meta.softDeleteKey)} = ${value}${criteria}`;
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
    const escaped =
      this.escapeIdChar + val.replace(this.escapeIdRegex, this.escapeIdChar + this.escapeIdChar) + this.escapeIdChar;

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
