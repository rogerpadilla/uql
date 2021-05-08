import { escape } from 'sqlstring';
import { getMeta } from '../entity/decorator/definition';
import {
  QueryFilter,
  Query,
  QueryScalarValue,
  QueryComparisonOperator,
  QuerySort,
  QueryPager,
  QueryOptions,
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

  insert<E>(entity: { new (): E }, payload: E | E[]): string {
    const meta = getMeta(entity);
    const payloads = Array.isArray(payload) ? payload : [payload];

    const onInserts = Object.keys(meta.properties).filter((col) => meta.properties[col].onInsert);

    for (const key of onInserts) {
      for (const item of payloads) {
        if (item[key] === undefined) {
          item[key] = meta.properties[key].onInsert();
        }
      }
    }

    const persistableKeys = filterPersistableProperties(entity, payloads[0]);
    const columns = persistableKeys.map((prop) => meta.properties[prop].name);
    const values = payloads
      .map((body) => persistableKeys.map((prop) => this.escape(body[prop])).join(', '))
      .join('), (');

    return `INSERT INTO ${this.escapeId(meta.name)} (${this.escapeId(columns)}) VALUES (${values})`;
  }

  update<E>(entity: { new (): E }, filter: QueryFilter<E>, payload: E): string {
    const meta = getMeta(entity);

    const onUpdates = Object.keys(meta.properties).filter((col) => meta.properties[col].onUpdate);

    for (const key of onUpdates) {
      if (payload[key] === undefined) {
        payload[key] = meta.properties[key].onUpdate();
      }
    }

    const persistableKeys = filterPersistableProperties(entity, payload);
    const persistableData = persistableKeys.reduce((acc, key) => {
      acc[meta.properties[key].name] = payload[key];
      return acc;
    }, {} as E);
    const values = this.objectToValues(persistableData);
    const where = this.filter(entity, filter);
    return `UPDATE ${this.escapeId(meta.name)} SET ${values} WHERE ${where}`;
  }

  remove<E>(entity: { new (): E }, filter: QueryFilter<E>): string {
    const meta = getMeta(entity);
    const where = this.filter(entity, filter);
    return `DELETE FROM ${this.escapeId(meta.name)} WHERE ${where}`;
  }

  find<E>(entity: { new (): E }, qm: Query<E>, opts?: QueryOptions): string {
    const select = this.select<E>(entity, qm, opts);
    const where = this.filter<E>(entity, qm.filter, { useClause: true });
    const group = this.group<E>(qm.group);
    const sort = this.sort<E>(qm.sort);
    const pager = this.pager(qm);
    return select + where + group + sort + pager;
  }

  columns<E>(
    entity: { new (): E },
    qm: Query<E>,
    opts: { prefix?: string; usePrefixForAlias?: boolean } & QueryOptions
  ): string {
    let { project } = { ...qm };

    const meta = getMeta(entity);
    const prefix = opts.prefix ? `${this.escapeId(opts.prefix, true)}.` : '';

    if (project) {
      if (!Array.isArray(project)) {
        const hasPositives = Object.keys(project).some((key) => project[key]);
        project = Object.keys(hasPositives ? project : meta.properties).filter(
          (it) => project[it] || project[it] === undefined
        ) as (keyof E)[];
      }
      if (opts.isTrustedProject) {
        return project.join(', ');
      }
    } else {
      project = Object.keys(meta.properties) as (keyof E)[];
    }

    return project
      .map((prop) => {
        const name = meta.properties[prop as string].name;
        const col = `${prefix}${this.escapeId(name)}`;
        if (opts.usePrefixForAlias) {
          return `${col} ${this.escapeId(opts.prefix + '.' + prop, true)}`;
        }
        return name === prop ? col : `${col} ${this.escapeId(prop)}`;
      })
      .join(', ');
  }

  select<E>(entity: { new (): E }, qm: Query<E>, opts?: QueryOptions): string {
    const meta = getMeta(entity);
    const baseSelect = this.columns(entity, qm, {
      prefix: qm.populate && meta.name,
      ...opts,
    });
    const { joinsSelect, joinsTables } = this.populate(entity, qm.populate);
    return `SELECT ${baseSelect}${joinsSelect} FROM ${this.escapeId(meta.name)}${joinsTables}`;
  }

  populate<E>(
    entity: { new (): E },
    populate: QueryPopulate<E> = {},
    prefix?: string
  ): { joinsSelect: string; joinsTables: string } {
    let joinsSelect = '';
    let joinsTables = '';

    const meta = getMeta(entity);

    for (const popKey in populate) {
      const relOpts = meta.relations[popKey];

      if (!relOpts) {
        throw new TypeError(`'${entity.name}.${popKey}' is not annotated as a relation`);
      }
      if (relOpts.cardinality !== 'manyToOne' && relOpts.cardinality !== 'oneToOne') {
        // 'manyToMany' and 'oneToMany' will need multiple queries (so they should be resolved in a higher layer)
        continue;
      }

      const joinPrefix = prefix ? prefix + '.' + popKey : popKey;
      const joinPath = this.escapeId(joinPrefix, true);
      const relEntity = relOpts.entity();
      const popVal = populate[popKey];

      const relColumns = this.columns(relEntity, popVal, {
        prefix: joinPrefix,
        usePrefixForAlias: true,
      });

      joinsSelect += `, ${relColumns}`;

      const relMeta = getMeta(relEntity);
      const relEntityName = this.escapeId(relMeta.name);
      const relPath = prefix ? this.escapeId(prefix, true) : this.escapeId(meta.name);
      const joinType = popVal.required ? 'INNER' : 'LEFT';

      joinsTables += ` ${joinType} JOIN ${relEntityName} ${joinPath} ON `;

      joinsTables += relOpts.references
        .map((it) => `${joinPath}.${this.escapeId(it.target)} = ${relPath}.${this.escapeId(it.source)}`)
        .join(' AND ');

      if (popVal.filter && Object.keys(popVal.filter).length) {
        const where = this.filter(relEntity, popVal.filter, { prefix: popKey });
        joinsTables += ` AND ${where}`;
      }

      const { joinsSelect: subJoinSelect, joinsTables: subJoinTables } = this.populate(
        relEntity,
        popVal.populate,
        joinPrefix
      );

      joinsSelect += subJoinSelect;
      joinsTables += subJoinTables;
    }

    return { joinsSelect, joinsTables };
  }

  filter<E>(
    entity: { new (): E },
    filter: QueryFilter<E>,
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
          const filterItCondition = this.filter(entity, val, whereOpts);
          return hasPrecedence ? `(${filterItCondition})` : filterItCondition;
        }
        return this.compare(entity, key, val, { prefix: opts.prefix });
      })
      .join(` ${logicalOperator} `);

    return opts.useClause ? ` WHERE ${sql}` : sql;
  }

  compare<E>(
    entity: { new (): E },
    key: string,
    value: QueryScalarValue | object,
    opts: { prefix?: string } = {}
  ): string {
    switch (key) {
      case '$text':
        const search = value as QueryTextSearchOptions<E>;
        const fields = this.escapeId(search.fields);
        return `MATCH(${fields}) AGAINST(${this.escape(search.value)})`;
      default:
        const val = typeof value === 'object' && value !== null ? value : { $eq: value };
        const operators = Object.keys(val) as (keyof QueryComparisonOperator<E>)[];
        const operations = operators
          .map((operator) => this.compareProperty(entity, key, operator, val[operator], opts))
          .join(' AND ');
        return operators.length > 1 ? `(${operations})` : operations;
    }
  }

  compareProperty<E, K extends keyof QueryComparisonOperator<E>>(
    entity: { new (): E },
    prop: string,
    operator: K,
    val: QueryComparisonOperator<E>[K],
    opts: { prefix?: string } = {}
  ): string {
    const meta = getMeta(entity);
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

  group<E>(fields: (keyof E)[]): string {
    if (!fields?.length) {
      return '';
    }
    return ` GROUP BY ${this.escapeId(fields)}`;
  }

  sort<E>(sort: QuerySort<E>): string {
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

  escapeId<E>(val: string | string[] | keyof E | (keyof E)[], forbidQualified?: boolean): string {
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

  objectToValues<E>(object: E): string {
    return Object.keys(object)
      .map((key) => `${this.escapeId(key)} = ${this.escape(object[key])}`)
      .join(', ');
  }
}
