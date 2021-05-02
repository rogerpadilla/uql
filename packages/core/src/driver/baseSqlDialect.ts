import { escape } from 'sqlstring';
import { getEntityMeta } from '../entity/decorator/definition';
import {
  QueryFilter,
  Query,
  QueryScalarValue,
  QueryComparisonOperator,
  QuerySort,
  QueryPager,
  QueryOptions,
  QueryProject,
  QueryLogicalOperatorValue,
  QueryTextSearchOptions,
  QueryPopulate,
} from '../type';
import { filterPersistableProperties } from './entity.util';

export abstract class BaseSqlDialect {
  protected readonly escapeIdRegex: RegExp;

  constructor(readonly beginTransactionCommand: string, readonly escapeIdChar: '`' | '"') {
    this.escapeIdRegex = RegExp(escapeIdChar, 'g');
  }

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

    const persistableKeys = filterPersistableProperties(type, payloads[0]);
    const columns = persistableKeys.map((prop) => meta.properties[prop].name);
    const values = payloads
      .map((body) => persistableKeys.map((prop) => this.escape(body[prop])).join(', '))
      .join('), (');

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

    const persistableKeys = filterPersistableProperties(type, payload);
    const persistableData = persistableKeys.reduce((acc, key) => {
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
    const where = this.where<T>(type, qm.filter, { useClause: true });
    const group = this.group<T>(qm.group);
    const sort = this.sort<T>(qm.sort);
    const pager = this.pager(qm);
    return select + where + group + sort + pager;
  }

  columns<T>(
    type: { new (): T },
    qm: Query<T>,
    opts: { prefix?: string; usePrefixForAlias?: boolean } & QueryOptions
  ): string {
    let { project } = { ...qm };

    const meta = getEntityMeta(type);

    if (opts.isTrustedProject) {
      if (qm.populate) {
        for (const popKey in qm.populate) {
          if (meta.properties[popKey]) {
            project[popKey] = true;
          }
        }
      }
      return Object.keys(project).join(', ');
    }

    const prefix = opts.prefix ? `${this.escapeId(opts.prefix, true)}.` : '';

    if (project) {
      const hasPositives = Object.keys(project).some((key) => project[key]);
      project = Object.keys(hasPositives ? project : meta.properties).reduce((acc, it) => {
        if (project[it] !== false && project[it] !== 0) {
          acc[it] = project[it];
        }
        return acc;
      }, {} as QueryProject<T>);
    } else {
      project = Object.keys(meta.properties).reduce((acc, it) => {
        acc[it] = true;
        return acc;
      }, {} as QueryProject<T>);
    }

    if (qm.populate) {
      for (const popKey in qm.populate) {
        if (meta.properties[popKey]) {
          project[popKey] = true;
        }
      }
    }

    const projectItemMapper = (prop: string) => {
      const name = meta.properties[prop].name;
      const col = `${prefix}${this.escapeId(name)}`;
      if (opts.usePrefixForAlias) {
        return `${col} ${this.escapeId(opts.prefix + '.' + prop, true)}`;
      }
      return name === prop ? col : `${col} ${this.escapeId(prop)}`;
    };

    return Object.keys(project).map(projectItemMapper).join(', ');
  }

  select<T>(type: { new (): T }, qm: Query<T>, opts?: QueryOptions): string {
    const meta = getEntityMeta(type);
    const baseSelect = this.columns(type, qm, {
      prefix: qm.populate && meta.name,
      ...opts,
    });
    const { joinsSelect, joinsTables } = this.joins(type, qm.populate);
    return `SELECT ${baseSelect}${joinsSelect} FROM ${this.escapeId(meta.name)}${joinsTables}`;
  }

  joins<T>(
    type: { new (): T },
    populate: QueryPopulate<T> = {},
    prefix?: string
  ): { joinsSelect: string; joinsTables: string } {
    let joinsSelect = '';
    let joinsTables = '';

    const meta = getEntityMeta(type);

    for (const popKey in populate) {
      const relOpts = meta.relations[popKey];
      if (!relOpts) {
        throw new TypeError(`'${type.name}.${popKey}' is not annotated as a relation`);
      }
      if (relOpts.cardinality !== 'manyToOne' && relOpts.cardinality !== 'oneToOne') {
        // 'manyToMany' and 'oneToMany' will need multiple queries (so they should be resolved in a higher layer)
        continue;
      }
      const joinPrefix = prefix ? prefix + '.' + popKey : popKey;
      const joinPath = this.escapeId(joinPrefix, true);
      const relType = relOpts.type();
      const popVal = populate[popKey];
      const relColumns = this.columns(relType, popVal, {
        prefix: joinPrefix,
        usePrefixForAlias: true,
      });
      joinsSelect += `, ${relColumns}`;
      const relMeta = getEntityMeta(relType);
      const relTypeName = this.escapeId(relMeta.name);
      const rel = prefix
        ? this.escapeId(prefix, true) + '.' + this.escapeId(relOpts.mappedBy ? meta.id.name : popKey)
        : `${this.escapeId(meta.name)}.${relOpts.mappedBy ? this.escapeId(meta.id.name) : joinPath}`;
      const joinType = popVal.required ? 'INNER' : 'LEFT';
      joinsTables += ` ${joinType} JOIN ${relTypeName} ${joinPath} ON ${joinPath}.${this.escapeId(
        relOpts.mappedBy ?? relMeta.id.name
      )} = ${rel}`;
      if (popVal.filter && Object.keys(popVal.filter).length) {
        const where = this.where(relType, popVal.filter, { prefix: popKey });
        joinsTables += ` AND ${where}`;
      }
      const { joinsSelect: subJoinSelect, joinsTables: subJoinTables } = this.joins(
        relType,
        popVal.populate,
        joinPrefix
      );
      joinsSelect += subJoinSelect;
      joinsTables += subJoinTables;
    }

    return { joinsSelect, joinsTables };
  }

  where<T>(
    type: { new (): T },
    filter: QueryFilter<T>,
    opts: { logicalOperator?: QueryLogicalOperatorValue; prefix?: string; useClause?: boolean } = {}
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
          const whereOpts: typeof opts = { prefix: opts.prefix };
          if (key === '$or') {
            whereOpts.logicalOperator = 'OR';
          }
          const hasPrecedence = filterKeys.length > 1 && Object.keys(val).length > 1;
          const filterItCondition = this.where(type, val, whereOpts);
          return hasPrecedence ? `(${filterItCondition})` : filterItCondition;
        }
        return this.compare(type, key, val, { prefix: opts.prefix });
      })
      .join(` ${logicalOperator} `);

    return opts.useClause ? ` WHERE ${sql}` : sql;
  }

  compare<T>(
    type: { new (): T },
    key: string,
    value: QueryScalarValue | object,
    opts: { prefix?: string } = {}
  ): string {
    switch (key) {
      case '$text':
        const search = value as QueryTextSearchOptions<T>;
        const fields = this.escapeId(search.fields);
        return `MATCH(${fields}) AGAINST(${this.escape(search.value)})`;
      default:
        const val = typeof value === 'object' && value !== null ? value : { $eq: value };
        const operators = Object.keys(val) as (keyof QueryComparisonOperator<T>)[];
        const operations = operators
          .map((operator) => this.compareProperty(type, key, operator, val[operator], opts))
          .join(' AND ');
        return operators.length > 1 ? `(${operations})` : operations;
    }
  }

  compareProperty<T, K extends keyof QueryComparisonOperator<T>>(
    type: { new (): T },
    prop: string,
    operator: K,
    val: QueryComparisonOperator<T>[K],
    opts: { prefix?: string } = {}
  ): string {
    const meta = getEntityMeta(type);
    const prefix = opts.prefix ? `${this.escapeId(opts.prefix, true)}.` : '';
    const name = meta.properties[prop]?.name || prop;
    const col = prefix + this.escapeId(name);
    switch (operator) {
      case '$eq':
        return val === null ? `${col} IS NULL` : `${col} = ${this.escape(val)}`;
      case '$ne':
        return val === null ? `${col} IS NOT NULL` : `${col} <> ${this.escape(val)}`;
      case '$gt':
        return `${col} > ${this.escape(val)}`;
      case '$gte':
        return `${col} >= ${this.escape(val)}`;
      case '$lt':
        return `${col} < ${this.escape(val)}`;
      case '$lte':
        return `${col} <= ${this.escape(val)}`;
      case '$startsWith':
        return `LOWER(${col}) LIKE ${this.escape((val as string).toLowerCase() + '%')}`;
      case '$in':
        return `${col} IN (${this.escape(val)})`;
      case '$nin':
        return `${col} NOT IN (${this.escape(val)})`;
      case '$re':
        return `${col} REGEXP ${this.escape(val)}`;
      default:
        throw new TypeError(`unknown operator: ${operator}`);
    }
  }

  group<T>(fields: (keyof T)[]): string {
    if (!fields?.length) {
      return '';
    }
    return ` GROUP BY ${this.escapeId(fields)}`;
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
    if (Array.isArray(val)) {
      return (val as string[]).map((it) => this.escapeId(it, forbidQualified)).join(', ');
    }

    const str = val as string;

    if (!forbidQualified && str.includes('.')) {
      return str
        .split('.')
        .map((it) => this.escapeId(it))
        .join('.');
    }

    // sourced from 'escapeId' function here https://github.com/mysqljs/sqlstring/blob/master/lib/SqlString.js
    return (
      this.escapeIdChar + str.replace(this.escapeIdRegex, this.escapeIdChar + this.escapeIdChar) + this.escapeIdChar
    );
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
