import { escape, escapeId, objectToValues } from 'sqlstring';
import {
  QueryFilter,
  Query,
  QueryPrimitive,
  QueryComparisonOperator,
  QuerySort,
  QueryLimit,
  QueryOptions,
  QueryProject,
  QueryComparisonValue,
  QueryLogicalOperators,
} from '../type';
import { getEntityMeta, ColumnPersistableMode, getEntityId } from '../entity';

export abstract class SqlDialect {
  readonly beginTransactionCommand: string = 'BEGIN';

  insert<T>(type: { new (): T }, body: T | T[]) {
    const bodies = Array.isArray(body) ? body : [body];
    const samplePersistableBody = filterPersistableBody(type, bodies[0], 'insert');
    const columns = Object.keys(samplePersistableBody);
    const valuesSafe = bodies.map((it) => columns.map((column) => escape(it[column])).join(', ')).join('), (');
    const typeNameSafe = escapeId(type.name);
    const fieldsSafe = escapeId(columns);
    return `INSERT INTO ${typeNameSafe} (${fieldsSafe}) VALUES (${valuesSafe})`;
  }

  update<T>(type: { new (): T }, filter: QueryFilter<T>, body: T, limit?: number) {
    const persistableBody = filterPersistableBody(type, body, 'update');
    const keyValuesSafe = objectToValues(persistableBody);
    const where = this.where(filter);
    const limitStr = this.limit({ limit });
    const typeNameSafe = escapeId(type.name);
    return `UPDATE ${typeNameSafe} SET ${keyValuesSafe} WHERE ${where}${limitStr}`;
  }

  remove<T>(type: { new (): T }, filter: QueryFilter<T>, limit?: number) {
    const whereStr = this.where(filter);
    const limitStr = this.limit({ limit });
    const typeNameSafe = escapeId(type.name);
    return `DELETE FROM ${typeNameSafe} WHERE ${whereStr}${limitStr}`;
  }

  find<T>(type: { new (): T }, qm: Query<T>, opts?: QueryOptions) {
    const select = this.select<T>(type, qm, opts);
    const where = this.where<T>(qm.filter, { prefix: true });
    const sort = this.sort<T>(qm.sort);
    const pager = this.limit(qm);
    return select + where + sort + pager;
  }

  columns<T>(type: { new (): T }, opts: { columns?: QueryProject<T>; prefix?: string; alias?: boolean }) {
    const prefix = opts.prefix ? `${escapeId(opts.prefix, true)}.` : '';

    if (!opts.columns) {
      if (!opts.alias) {
        return `${prefix}*`;
      }
      const meta = getEntityMeta(type);
      opts.columns = Object.keys(meta.columns).reduce((acc, it) => {
        acc[it] = 1;
        return acc;
      }, {} as QueryProject<T>);
    }

    const nameGenerator = opts.alias
      ? (col: string) => `${prefix}${escapeId(col)} ${escapeId(opts.prefix + '.' + col, true)}`
      : (col: string) => `${prefix}${escapeId(col)}`;

    return Object.keys(opts.columns).map(nameGenerator).join(', ');
  }

  select<T>(type: { new (): T }, qm: Query<T>, opts?: QueryOptions) {
    const baseSelect = opts?.trustedProject
      ? Object.keys(qm.project).join(', ')
      : this.columns(type, {
          columns: qm.project,
          prefix: qm.populate && type.name,
        });
    const { joinsSelect, joinsTables } = this.joins(type, qm);
    const typeNameSafe = escapeId(type.name);
    return `SELECT ${baseSelect}${joinsSelect} FROM ${typeNameSafe}${joinsTables}`;
  }

  joins<T>(type: { new (): T }, qm: Query<T>, prefix = '') {
    let joinsSelect = '';
    let joinsTables = '';
    if (qm.populate) {
      const entityMeta = getEntityMeta(type);
      for (const populateKey in qm.populate) {
        const relationProps = entityMeta.relations[populateKey];
        if (!relationProps) {
          throw new Error(`'${type.name}.${populateKey}' is not annotated with a relation decorator (e.g. @ManyToOne)`);
        }
        const path = prefix ? prefix + '.' + populateKey : populateKey;
        const pathSafe = escapeId(path, true);
        const relationType = relationProps.type();
        const populateVal = qm.populate[populateKey];
        const columns = this.columns(relationType, {
          columns: populateVal?.project,
          prefix: path,
          alias: true,
        });
        joinsSelect += `, ${columns}`;
        const relationTypeNameSafe = escapeId(relationType.name);
        const relationSafe = prefix
          ? escapeId(prefix, true) + '.' + escapeId(populateKey)
          : `${escapeId(type.name)}.${pathSafe}`;
        const relationId = escapeId(getEntityId(relationType));
        joinsTables += ` LEFT JOIN ${relationTypeNameSafe} ${pathSafe} ON ${pathSafe}.${relationId} = ${relationSafe}`;
        if (populateVal?.populate) {
          const { joinsSelect: subJoinSelect, joinsTables: subJoinTables } = this.joins(
            relationType,
            populateVal,
            path
          );
          joinsSelect += subJoinSelect;
          joinsTables += subJoinTables;
        }
      }
    }
    return { joinsSelect, joinsTables };
  }

  where<T>(filter: QueryFilter<T>, options?: { logicalOperator?: QueryLogicalOperators; prefix?: boolean }): string {
    if (!filter || Object.keys(filter).length === 0) {
      return '';
    }

    const opts = {
      logicalOperator: 'AND',
      ...options,
    } as const;

    const logicalOperatorMap = {
      $and: 'AND',
      $or: 'OR',
    } as const;

    const filterKeys = Object.keys(filter);

    const sql = filterKeys
      .map((key) => {
        const val = filter[key];
        if (logicalOperatorMap[key]) {
          const filterItCondition = this.where(val, { logicalOperator: logicalOperatorMap[key] });
          return filterKeys.length > 1 ? `(${filterItCondition})` : filterItCondition;
        }
        return this.comparison(key, val);
      })
      .join(` ${opts.logicalOperator} `);

    return opts.prefix ? ` WHERE ${sql}` : sql;
  }

  comparison<T>(key: string, value: QueryComparisonValue<T>) {
    const valueObject = typeof value === 'object' && value !== null ? value : { $eq: value as QueryPrimitive };
    const comparisonOperators = Object.keys(valueObject) as (keyof QueryComparisonOperator<T>)[];
    const comparison = comparisonOperators
      .map((comparisonOperator) => this.comparisonOperation(key, comparisonOperator, valueObject[comparisonOperator]))
      .join(' AND ');
    return comparisonOperators.length > 1 ? `(${comparison})` : comparison;
  }

  comparisonOperation<T, K extends keyof QueryComparisonOperator<T>>(
    attr: string,
    comparisonOperator: K,
    comparisonVal: QueryComparisonOperator<T>[K]
  ) {
    const attrSafe = escapeId(attr);
    switch (comparisonOperator) {
      case '$eq':
        return comparisonVal === null ? `${attrSafe} IS NULL` : `${attrSafe} = ${escape(comparisonVal)}`;
      case '$ne':
        return comparisonVal === null ? `${attrSafe} IS NOT NULL` : `${attrSafe} <> ${escape(comparisonVal)}`;
      case '$gt':
        return `${attrSafe} > ${escape(comparisonVal)}`;
      case '$gte':
        return `${attrSafe} >= ${escape(comparisonVal)}`;
      case '$lt':
        return `${attrSafe} < ${escape(comparisonVal)}`;
      case '$lte':
        return `${attrSafe} <= ${escape(comparisonVal)}`;
      case '$startsWith':
        return `LOWER(${attrSafe}) LIKE ${escape((comparisonVal as string).toLowerCase() + '%')}`;
      case '$in':
        return `${attrSafe} IN (${escape(comparisonVal)})`;
      case '$nin':
        return `${attrSafe} NOT IN (${escape(comparisonVal)})`;
      default:
        throw new Error(`Invalid comparison operator: ${comparisonOperator}`);
    }
  }

  sort<T>(sort: QuerySort<T>) {
    if (!sort || Object.keys(sort).length === 0) {
      return '';
    }
    const order = Object.keys(sort)
      .map((prop) => {
        const direction = sort[prop] === -1 ? ' DESC' : '';
        return escapeId(prop) + direction;
      })
      .join(', ');
    return ` ORDER BY ${order}`;
  }

  limit(pager: QueryLimit) {
    let sql = '';
    if (pager.limit) {
      sql += ` LIMIT ${Number(pager.limit)}`;
      if (pager.skip !== undefined) {
        sql += ` OFFSET ${Number(pager.skip)}`;
      }
    }
    return sql;
  }
}

function filterPersistableBody<T>(type: { new (): T }, body: T, mode: ColumnPersistableMode) {
  const entityMeta = getEntityMeta(type);
  return Object.keys(body).reduce((persistableBody, colName) => {
    const colMeta = entityMeta.columns[colName];
    const colVal = body[colName];
    if (colMeta && (colMeta.mode === undefined || colMeta.mode === mode) && colVal !== undefined) {
      persistableBody[colName] = colVal;
    }
    return persistableBody;
  }, {} as T);
}
