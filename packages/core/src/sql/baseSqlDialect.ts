import { escape } from 'sqlstring';
import { getMeta } from '../entity/decorator/definition';
import {
  QueryFilter,
  Query,
  Scalar,
  QueryComparisonOperator,
  QuerySort,
  QueryPager,
  QueryTextSearchOptions,
  QueryPopulate,
  Properties,
  QueryProject,
  Type,
  QueryCriteria,
  QueryPopulateValue,
} from '../type';
import { filterPersistableProperties } from '../entity/util';
import { Raw } from './raw';

export abstract class BaseSqlDialect {
  readonly escapeIdRegex: RegExp;

  constructor(readonly beginTransactionCommand: string, readonly escapeIdChar: '`' | '"') {
    this.escapeIdRegex = RegExp(escapeIdChar, 'g');
  }

  criteria<E>(entity: Type<E>, qm: Query<E>): string {
    const filter = this.where<E>(entity, qm.$filter);
    const group = this.group<E>(entity, qm.$group);
    const sort = this.sort<E>(entity, qm.$sort);
    const pager = this.pager(qm);
    return filter + group + sort + pager;
  }

  find<E>(entity: Type<E>, qm: Query<E>): string {
    const select = this.select<E>(entity, qm);
    return select + this.criteria(entity, qm);
  }

  insert<E>(entity: Type<E>, payload: E | E[]): string {
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

    return `INSERT INTO ${meta.name} (${columns.join(', ')}) VALUES (${values})`;
  }

  delete<E>(entity: Type<E>, qm: QueryCriteria<E>): string {
    const meta = getMeta(entity);
    const criteria = this.criteria(entity, qm);
    return `DELETE FROM ${meta.name}${criteria}`;
  }

  update<E>(entity: Type<E>, payload: E, qm: QueryCriteria<E>): string {
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
    const criteria = this.criteria(entity, qm);
    return `UPDATE ${meta.name} SET ${values}${criteria}`;
  }

  project<E>(
    entity: Type<E>,
    project: QueryProject<E>,
    opts: { prefix?: string; prependPrefixToAlias?: boolean }
  ): string {
    const meta = getMeta(entity);
    const prefix = opts.prefix ? `${opts.prefix}.` : '';

    if (project) {
      if (!Array.isArray(project)) {
        const hasPositives = Object.keys(project).some((key) => project[key]);
        project = Object.keys(hasPositives ? project : meta.properties).filter(
          (it) => project[it] ?? project[it] === undefined
        ) as Properties<E>[];
      }
    } else {
      project = Object.keys(meta.properties) as Properties<E>[];
    }

    return project
      .map((key) => {
        if (key instanceof Raw) {
          return key.value;
        }
        const property = meta.properties[key as string];
        const name = property?.name ?? this.escapeId(key);
        const col = `${prefix}${name}`;
        if (opts.prependPrefixToAlias) {
          return `${col} ${this.escapeId(opts.prefix + '.' + key, true)}`;
        }
        return name === key || !property ? col : `${col} ${key}`;
      })
      .join(', ');
  }

  select<E>(entity: Type<E>, qm: Query<E>): string {
    const meta = getMeta(entity);
    const baseColumns = this.project(entity, qm.$project, {
      prefix: qm.$populate && meta.name,
    });
    const { joinsColumns, joinsTables } = this.join(entity, qm.$populate);
    return `SELECT ${baseColumns}${joinsColumns} FROM ${meta.name}${joinsTables}`;
  }

  join<E>(
    entity: Type<E>,
    populate: QueryPopulate<E> = {},
    prefix?: string
  ): { joinsColumns: string; joinsTables: string } {
    let joinsColumns = '';
    let joinsTables = '';

    const meta = getMeta(entity);

    for (const relKey in populate) {
      const relOpts = meta.relations[relKey];

      if (!relOpts) {
        throw new TypeError(`'${entity.name}.${relKey}' is not annotated as a relation`);
      }
      if (relOpts.cardinality === '1m' || relOpts.cardinality === 'mm') {
        // '1m' and 'mm' will need multiple queries (so they should be resolved in a higher layer)
        continue;
      }

      const joinPath = prefix ? prefix + '.' + relKey : relKey;
      const relEntity = relOpts.entity();
      const popVal = populate[relKey] as QueryPopulateValue<typeof relEntity>;

      const relColumns = this.project(relEntity, popVal.$project, {
        prefix: joinPath,
        prependPrefixToAlias: true,
      });

      joinsColumns += `, ${relColumns}`;

      const relMeta = getMeta(relEntity);
      const relEntityName = relMeta.name;
      const relPath = prefix ? prefix : meta.name;
      const joinType = popVal.$required ? 'INNER' : 'LEFT';

      joinsTables += ` ${joinType} JOIN ${relEntityName} ${joinPath} ON `;
      joinsTables += relOpts.references.map((it) => `${joinPath}.${it.target} = ${relPath}.${it.source}`).join(' AND ');

      if (popVal.$filter && Object.keys(popVal.$filter).length) {
        const where = this.where(relEntity, popVal.$filter, { prefix: relKey, omitClause: true });
        joinsTables += ` AND ${where}`;
      }

      const { joinsColumns: subJoinsColumns, joinsTables: subJoinsTables } = this.join(
        relEntity,
        popVal.$populate,
        joinPath
      );

      joinsColumns += subJoinsColumns;
      joinsTables += subJoinsTables;
    }

    return { joinsColumns, joinsTables };
  }

  where<E>(
    entity: Type<E>,
    filter: QueryFilter<E>,
    opts: { prefix?: string; omitClause?: boolean; wrapWithParenthesis?: boolean } = {}
  ): string {
    const filterKeys = filter && Object.keys(filter);
    if (!filterKeys?.length) {
      return '';
    }

    const hasMultiKeys = filterKeys.length > 1;

    let sql = filterKeys
      .map((key) => {
        const entry = filter[key];
        if (key === '$and' || key === '$or') {
          const hasMultiItems = entry.length > 1;
          const logicalComparison = entry
            .map((filterIt: QueryFilter<E>) =>
              this.where(entity, filterIt, {
                prefix: opts.prefix,
                wrapWithParenthesis: hasMultiItems && Object.keys(filterIt).length > 1,
                omitClause: true,
              })
            )
            .join(key === '$or' ? ' OR ' : ' AND ');
          return hasMultiKeys && hasMultiItems ? `(${logicalComparison})` : logicalComparison;
        }
        return this.compare(entity, key, entry, { prefix: opts.prefix });
      })
      .join(` AND `);

    if (opts.wrapWithParenthesis) {
      sql = `(${sql})`;
    }

    return opts.omitClause ? sql : ` WHERE ${sql}`;
  }

  compare<E>(entity: Type<E>, key: string, value: Scalar | object, opts: { prefix?: string } = {}): string {
    switch (key) {
      case '$text':
        const meta = getMeta(entity);
        const search = value as QueryTextSearchOptions<E>;
        return `${meta.name} MATCH ${this.escape(search.$value)}`;
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
    entity: Type<E>,
    prop: string,
    operator: K,
    val: QueryComparisonOperator<E>[K],
    opts: { prefix?: string } = {}
  ): string {
    const meta = getMeta(entity);
    const prefix = opts.prefix ? `${opts.prefix}.` : '';
    const name = meta.properties[prop]?.name ?? this.escapeId(prop);
    const colPath = prefix + name;
    switch (operator) {
      case '$eq':
        return val === null ? `${colPath} IS NULL` : `${colPath} = ${this.escape(val)}`;
      case '$ne':
        return val === null ? `${colPath} IS NOT NULL` : `${colPath} <> ${this.escape(val)}`;
      case '$gt':
        return `${colPath} > ${this.escape(val)}`;
      case '$gte':
        return `${colPath} >= ${this.escape(val)}`;
      case '$lt':
        return `${colPath} < ${this.escape(val)}`;
      case '$lte':
        return `${colPath} <= ${this.escape(val)}`;
      case '$startsWith':
        return `LOWER(${colPath}) LIKE ${this.escape((val as string).toLowerCase() + '%')}`;
      case '$in':
        return `${colPath} IN (${this.escape(val)})`;
      case '$nin':
        return `${colPath} NOT IN (${this.escape(val)})`;
      case '$re':
        return `${colPath} REGEXP ${this.escape(val)}`;
      default:
        throw new TypeError(`unknown operator: ${operator}`);
    }
  }

  group<E>(entity: Type<E>, properties: Properties<E>[]): string {
    if (!properties?.length) {
      return '';
    }
    const meta = getMeta(entity);
    const names = properties.map((prop) => meta.properties[prop as string]?.name ?? this.escapeId(prop)).join(', ');
    return ` GROUP BY ${names}`;
  }

  sort<E>(entity: Type<E>, sort: QuerySort<E>): string {
    if (!sort || Object.keys(sort).length === 0) {
      return '';
    }
    const meta = getMeta(entity);
    const order = Object.keys(sort)
      .map((prop) => {
        const field = meta.properties[prop as string]?.name ?? this.escapeId(prop);
        const direction = sort[prop] === -1 ? ' DESC' : '';
        return field + direction;
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

  escapeId(val: any, forbidQualified?: boolean): string {
    if (Array.isArray(val)) {
      return val.map((it) => this.escapeId(it, forbidQualified)).join(', ');
    }

    const str = val as string;

    if (!forbidQualified && val.includes('.')) {
      return str
        .split('.')
        .map((it) => this.escapeId(it))
        .join('.');
    }

    return (
      // sourced from 'escapeId' function here https://github.com/mysqljs/sqlstring/blob/master/lib/SqlString.js
      this.escapeIdChar + str.replace(this.escapeIdRegex, this.escapeIdChar + this.escapeIdChar) + this.escapeIdChar
    );
  }

  escape(val: any): string {
    return escape(val);
  }

  objectToValues<E>(object: E): string {
    return Object.keys(object)
      .map((key) => `${key} = ${this.escape(object[key])}`)
      .join(', ');
  }
}
