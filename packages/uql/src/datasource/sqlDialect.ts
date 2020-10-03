import { escapeId, escape } from 'sqlstring';
import {
  QueryFilter,
  Query,
  QueryPrimitive,
  QueryComparisonOperator,
  QuerySort,
  QueryPager,
  QueryOptions,
  QueryProject,
  QueryLogicalOperatorValue,
  QueryTextSearchOptions,
} from 'uql/type';
import { getEntityMeta } from 'uql/decorator';

export abstract class SqlDialect {
  readonly beginTransactionCommand: string = 'START TRANSACTION';

  insert<T>(type: { new (): T }, payload: T | T[]): string {
    const meta = getEntityMeta(type);
    const payloads = Array.isArray(payload) ? payload : [payload];

    const onInserts = Object.keys(meta.properties).filter((col) => meta.properties[col].onInsert);
    if (onInserts.length) {
      for (const item of payloads) {
        for (const key of onInserts) {
          if (item[key] === undefined) {
            item[key] = meta.properties[key].onInsert();
          }
        }
      }
    }

    const persistable = filterPersistable(type, payloads[0]);
    const properties = Object.keys(persistable);
    const columns = properties.map((prop) => meta.properties[prop].name);
    const values = payloads.map((body) => properties.map((prop) => this.escape(body[prop])).join(', ')).join('), (');

    return `INSERT INTO ${this.escapeId(meta.name)} (${this.escapeId(columns)}) VALUES (${values})`;
  }

  update<T>(type: { new (): T }, filter: QueryFilter<T>, payload: T): string {
    const meta = getEntityMeta(type);

    const onUpdates = Object.keys(meta.properties).filter((col) => meta.properties[col].onUpdate);
    if (onUpdates.length) {
      for (const key of onUpdates) {
        if (payload[key] === undefined) {
          payload[key] = meta.properties[key].onUpdate();
        }
      }
    }

    const persistable = filterPersistable(type, payload);
    const persistableData = Object.keys(persistable).reduce((acc, key) => {
      acc[meta.properties[key].name] = payload[key];
      return acc;
    }, {} as T);
    const values = this.objectToValues(persistableData);
    const where = this.where(type, filter);
    return `UPDATE ${this.escapeId(meta.name)} SET ${values} WHERE ${where}`;
  }

  remove<T>(type: { new (): T }, filter: QueryFilter<T>): string {
    const meta = getEntityMeta(type);
    const where = this.where(type, filter);
    return `DELETE FROM ${this.escapeId(meta.name)} WHERE ${where}`;
  }

  find<T>(type: { new (): T }, qm: Query<T>, opts?: QueryOptions): string {
    const select = this.select<T>(type, qm, opts);
    const where = this.where<T>(type, qm.filter, { usePrefix: true });
    const group = this.group<T>(qm.group);
    const sort = this.sort<T>(qm.sort);
    const pager = this.pager(qm);
    return select + where + group + sort + pager;
  }

  columns<T>(
    type: { new (): T },
    project: QueryProject<T>,
    opts: { prefix?: string; alias?: boolean } & QueryOptions
  ): string {
    if (opts.isTrustedProject) {
      return Object.keys(project).join(', ');
    }

    const prefix = opts.prefix ? `${this.escapeId(opts.prefix, true)}.` : '';
    const meta = getEntityMeta(type);

    if (project) {
      const hasPositives = Object.keys(project).some((key) => project[key]);
      project = Object.keys(hasPositives ? project : meta.properties).reduce((acc, it) => {
        if (project[it] !== false && project[it] !== 0) {
          acc[it] = project[it];
        }
        return acc;
      }, {} as QueryProject<T>);
    } else {
      if (!opts.alias) {
        return `${prefix}*`;
      }
      project = Object.keys(meta.properties).reduce((acc, it) => {
        acc[it] = true;
        return acc;
      }, {} as QueryProject<T>);
    }

    const aliasMapper = opts.alias
      ? (name: string) => `${prefix}${this.escapeId(name)} ${this.escapeId(opts.prefix + '.' + name, true)}`
      : (name: string) => `${prefix}${this.escapeId(name)}`;

    return Object.keys(project).map(aliasMapper).join(', ');
  }

  select<T>(type: { new (): T }, qm: Query<T>, opts?: QueryOptions): string {
    const meta = getEntityMeta(type);
    const baseSelect = this.columns(type, qm.project, {
      prefix: qm.populate && meta.name,
      ...opts,
    });
    const { joinsSelect, joinsTables } = this.joins(type, qm);
    return `SELECT ${baseSelect}${joinsSelect} FROM ${this.escapeId(meta.name)}${joinsTables}`;
  }

  joins<T>(type: { new (): T }, qm: Query<T>, prefix = ''): { joinsSelect: string; joinsTables: string } {
    let joinsSelect = '';
    let joinsTables = '';
    const meta = getEntityMeta(type);
    for (const popKey in qm.populate) {
      const relOpts = meta.relations[popKey];
      if (!relOpts) {
        throw new TypeError(`'${type.name}.${popKey}' is not annotated as a relation`);
      }
      if (relOpts.cardinality.endsWith('ToMany')) {
        throw new TypeError(
          `'${type.name}.${popKey}' is annotated as a '${relOpts.cardinality}' relation which is not yet supported for populates, consider running two separate queries in parallel`
        );
      }
      const joinPrefix = prefix ? prefix + '.' + popKey : popKey;
      const joinPath = this.escapeId(joinPrefix, true);
      const relType = relOpts.type();
      const popVal = qm.populate[popKey];
      const relProperties = this.columns(relType, popVal.project, {
        prefix: joinPrefix,
        alias: true,
      });
      joinsSelect += `, ${relProperties}`;
      const relMeta = getEntityMeta(relType);
      const relTypeName = this.escapeId(relMeta.name);
      const rel = prefix
        ? this.escapeId(prefix, true) + '.' + this.escapeId(popKey)
        : `${this.escapeId(meta.name)}.${joinPath}`;
      joinsTables += ` LEFT JOIN ${relTypeName} ${joinPath} ON ${joinPath}.${this.escapeId(relMeta.id.name)} = ${rel}`;
      if (popVal.populate) {
        const { joinsSelect: subJoinSelect, joinsTables: subJoinTables } = this.joins(relType, popVal, joinPrefix);
        joinsSelect += subJoinSelect;
        joinsTables += subJoinTables;
      }
    }
    return { joinsSelect, joinsTables };
  }

  group<T>(fields: (keyof T)[]): string {
    if (!fields?.length) {
      return '';
    }
    return ` GROUP BY ${this.escapeId(fields)}`;
  }

  where<T>(
    type: { new (): T },
    filter: QueryFilter<T>,
    opts: { logicalOperator?: QueryLogicalOperatorValue; usePrefix?: boolean } = {}
  ): string {
    const filterKeys = filter && Object.keys(filter);
    if (!filterKeys?.length) {
      return '';
    }

    const logicalOperator: QueryLogicalOperatorValue = opts.logicalOperator || 'AND';

    const sql = filterKeys
      .map((key) => {
        const val = filter[key];
        if (key === '$and' || key === '$or') {
          const logicalOperator = key;
          let whereOpts: typeof opts;
          if (logicalOperator === '$or') {
            whereOpts = { logicalOperator: 'OR' };
          }
          const hasPrecedence = filterKeys.length > 1 && Object.keys(val).length > 1;
          const filterItCondition = this.where(type, val, whereOpts);
          return hasPrecedence ? `(${filterItCondition})` : filterItCondition;
        }
        return this.comparison(type, key, val);
      })
      .join(` ${logicalOperator} `);

    return opts.usePrefix ? ` WHERE ${sql}` : sql;
  }

  comparison<T>(type: { new (): T }, key: string, value: object | QueryPrimitive): string {
    switch (key) {
      case '$text':
        const search = value as QueryTextSearchOptions<T>;
        const fields = this.escapeId(search.fields);
        return `MATCH(${fields}) AGAINST(${this.escape(search.value)})`;
      default:
        const val = typeof value === 'object' && value !== null ? value : { $eq: value };
        const operators = Object.keys(val) as (keyof QueryComparisonOperator<T>)[];
        const operations = operators
          .map((operator) => this.comparisonOperation(key, operator, val[operator]))
          .join(' AND ');
        return operators.length > 1 ? `(${operations})` : operations;
    }
  }

  comparisonOperation<T, K extends keyof QueryComparisonOperator<T>>(
    attr: keyof T,
    operator: K,
    val: QueryComparisonOperator<T>[K]
  ): string {
    switch (operator) {
      case '$eq':
        return val === null ? `${this.escapeId(attr)} IS NULL` : `${this.escapeId(attr)} = ${this.escape(val)}`;
      case '$ne':
        return val === null ? `${this.escapeId(attr)} IS NOT NULL` : `${this.escapeId(attr)} <> ${this.escape(val)}`;
      case '$gt':
        return `${this.escapeId(attr)} > ${this.escape(val)}`;
      case '$gte':
        return `${this.escapeId(attr)} >= ${this.escape(val)}`;
      case '$lt':
        return `${this.escapeId(attr)} < ${this.escape(val)}`;
      case '$lte':
        return `${this.escapeId(attr)} <= ${this.escape(val)}`;
      case '$startsWith':
        return `LOWER(${this.escapeId(attr)}) LIKE ${this.escape((val as string).toLowerCase() + '%')}`;
      case '$in':
        return `${this.escapeId(attr)} IN (${this.escape(val)})`;
      case '$nin':
        return `${this.escapeId(attr)} NOT IN (${this.escape(val)})`;
      case '$re':
        return `${this.escapeId(attr)} REGEXP ${this.escape(val)}`;
      default:
        throw new TypeError(`unknown operator: ${operator}`);
    }
  }

  sort<T>(sort: QuerySort<T>): string {
    if (!sort || Object.keys(sort).length === 0) {
      return '';
    }
    const order = Object.keys(sort)
      .map((prop) => {
        const direction = sort[prop] === -1 ? ' DESC' : '';
        return this.escapeId(prop) + direction;
      })
      .join(', ');
    return ` ORDER BY ${order}`;
  }

  pager(opts: QueryPager): string {
    let sql = '';
    if (opts.limit) {
      sql += ` LIMIT ${Number(opts.limit)}`;
      if (opts.skip !== undefined) {
        sql += ` OFFSET ${Number(opts.skip)}`;
      }
    }
    return sql;
  }

  escapeId<T>(val: string | string[] | keyof T | (keyof T)[], forbidQualified?: boolean): string {
    return escapeId(val, forbidQualified);
  }

  escape(val: any): string {
    return escape(val);
  }

  objectToValues<T>(object: T): string {
    return Object.keys(object)
      .map((key) => `${this.escapeId(key)} = ${this.escape(object[key])}`)
      .join(', ');
  }
}

function filterPersistable<T>(type: { new (): T }, body: T): T {
  const meta = getEntityMeta(type);
  return Object.keys(body).reduce((persistableBody, prop) => {
    const isProperty = Boolean(meta.properties[prop]);
    const value = body[prop];
    const relationOpts = meta.relations[prop];
    if (
      isProperty &&
      value !== undefined &&
      // 'manyToOne' is the only relation which doesn't require additional stuff when saving
      (!relationOpts || relationOpts.cardinality === 'manyToOne')
    ) {
      persistableBody[prop] = value;
    }
    return persistableBody;
  }, {} as T);
}
