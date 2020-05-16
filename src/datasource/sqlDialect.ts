import { escape, escapeId, objectToValues } from 'sqlstring';
import {
  QueryFilter,
  Query,
  QueryPrimitive,
  QueryComparisonOperator,
  QuerySort,
  QueryPager,
  QueryOptions,
  QueryProject,
  QueryComparisonValue,
  QueryLogicalOperators,
} from '../type';
import { getEntityMeta, ColumnPersistableMode } from '../entity';

export abstract class SqlDialect {
  static readonly logicalOperatorMap = {
    $and: 'AND',
    $or: 'OR',
  } as const;

  readonly beginTransactionCommand: string = 'BEGIN';

  insert<T>(type: { new (): T }, body: T | T[]) {
    const bodies = Array.isArray(body) ? body : [body];
    const samplePersistableBody = filterPersistable(type, bodies[0], 'insert');
    const columns = Object.keys(samplePersistableBody);
    const valuesSafe = bodies.map((it) => columns.map((column) => escape(it[column])).join(', ')).join('), (');
    const typeNameSafe = escapeId(type.name);
    const fieldsSafe = escapeId(columns);
    return `INSERT INTO ${typeNameSafe} (${fieldsSafe}) VALUES (${valuesSafe})`;
  }

  update<T>(type: { new (): T }, filter: QueryFilter<T>, body: T, limit?: number) {
    const persistableBody = filterPersistable(type, body, 'update');
    const keyValuesSafe = objectToValues(persistableBody);
    const where = this.where(filter);
    const pager = this.pager({ limit });
    const typeNameSafe = escapeId(type.name);
    return `UPDATE ${typeNameSafe} SET ${keyValuesSafe} WHERE ${where}${pager}`;
  }

  remove<T>(type: { new (): T }, filter: QueryFilter<T>, limit?: number) {
    const whereStr = this.where(filter);
    const limitStr = this.pager({ limit });
    const typeNameSafe = escapeId(type.name);
    return `DELETE FROM ${typeNameSafe} WHERE ${whereStr}${limitStr}`;
  }

  find<T>(type: { new (): T }, qm: Query<T>, opts?: QueryOptions) {
    const select = this.select<T>(type, qm, opts);
    const where = this.where<T>(qm.filter, { prefix: true });
    const sort = this.sort<T>(qm.sort);
    const pager = this.pager(qm);
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
      for (const popKey in qm.populate) {
        const relProps = entityMeta.columns[popKey].relation;
        if (!relProps) {
          throw new Error(`'${type.name}.${popKey}' is not annotated with a relation decorator`);
        }
        const joinPrefix = prefix ? prefix + '.' + popKey : popKey;
        const joinPathSafe = escapeId(joinPrefix, true);
        const relType = relProps.type();
        const popVal = qm.populate[popKey];
        const relColumns = this.columns(relType, {
          columns: popVal?.project,
          prefix: joinPrefix,
          alias: true,
        });
        joinsSelect += `, ${relColumns}`;
        const relTypeNameSafe = escapeId(relType.name);
        const relSafe = prefix ? escapeId(prefix, true) + '.' + escapeId(popKey) : `${escapeId(type.name)}.${joinPathSafe}`;
        const relMeta = getEntityMeta(relType);
        joinsTables += ` LEFT JOIN ${relTypeNameSafe} ${joinPathSafe} ON ${joinPathSafe}.${escapeId(relMeta.id)} = ${relSafe}`;
        if (popVal?.populate) {
          const { joinsSelect: subJoinSelect, joinsTables: subJoinTables } = this.joins(relType, popVal, joinPrefix);
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

    const filterKeys = Object.keys(filter);

    const sql = filterKeys
      .map((key) => {
        const val = filter[key];
        if (SqlDialect.logicalOperatorMap[key]) {
          const filterItCondition = this.where(val, { logicalOperator: SqlDialect.logicalOperatorMap[key] });
          return filterKeys.length > 1 ? `(${filterItCondition})` : filterItCondition;
        }
        return this.comparison(key, val);
      })
      .join(` ${opts.logicalOperator} `);

    return opts.prefix ? ` WHERE ${sql}` : sql;
  }

  comparison<T>(key: string, value: QueryComparisonValue<T>) {
    const val = typeof value === 'object' && value !== null ? value : { $eq: value as QueryPrimitive };
    const operators = Object.keys(val) as (keyof QueryComparisonOperator<T>)[];
    const comparison = operators.map((operator) => this.comparisonOperation(key, operator, val[operator])).join(' AND ');
    return operators.length > 1 ? `(${comparison})` : comparison;
  }

  comparisonOperation<T, K extends keyof QueryComparisonOperator<T>>(
    attr: keyof T,
    operator: K,
    val: QueryComparisonOperator<T>[K]
  ) {
    const attrSafe = escapeId(attr);
    switch (operator) {
      case '$eq':
        return val === null ? `${attrSafe} IS NULL` : `${attrSafe} = ${escape(val)}`;
      case '$ne':
        return val === null ? `${attrSafe} IS NOT NULL` : `${attrSafe} <> ${escape(val)}`;
      case '$gt':
        return `${attrSafe} > ${escape(val)}`;
      case '$gte':
        return `${attrSafe} >= ${escape(val)}`;
      case '$lt':
        return `${attrSafe} < ${escape(val)}`;
      case '$lte':
        return `${attrSafe} <= ${escape(val)}`;
      case '$startsWith':
        return `LOWER(${attrSafe}) LIKE ${escape((val as string).toLowerCase() + '%')}`;
      case '$in':
        return `${attrSafe} IN (${escape(val)})`;
      case '$nin':
        return `${attrSafe} NOT IN (${escape(val)})`;
      default:
        throw new Error(`Unsupported comparison operator: ${operator}`);
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

  pager(opts: QueryPager) {
    let sql = '';
    if (opts.limit) {
      sql += ` LIMIT ${Number(opts.limit)}`;
      if (opts.skip !== undefined) {
        sql += ` OFFSET ${Number(opts.skip)}`;
      }
    }
    return sql;
  }
}

function filterPersistable<T>(type: { new (): T }, body: T, mode: ColumnPersistableMode) {
  const meta = getEntityMeta(type);
  return Object.keys(body).reduce((persistableBody, colName) => {
    const colProps = meta.columns[colName];
    const colVal = body[colName];
    if (colProps && (colProps.mode === undefined || colProps.mode === mode) && colVal !== undefined) {
      persistableBody[colName] = colVal;
    }
    return persistableBody;
  }, {} as T);
}
