import { escape } from 'sqlstring';
import { getMeta } from '../entity/decorator/definition';
import {
  QueryFilter,
  Query,
  Scalar,
  QueryComparisonOperator,
  QuerySort,
  QueryPager,
  QueryOptions,
  QueryTextSearchOptions,
  QueryPopulate,
  Properties,
  QueryProject,
  Type,
} from '../type';
import { filterPersistableProperties } from '../entity/util';

export abstract class BaseSqlDialect {
  readonly escapeIdRegex: RegExp;

  constructor(readonly beginTransactionCommand: string, readonly escapeIdChar: '`' | '"') {
    this.escapeIdRegex = RegExp(escapeIdChar, 'g');
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

    return `INSERT INTO ${this.escapeId(meta.name)} (${this.escapeId(columns)}) VALUES (${values})`;
  }

  update<E>(entity: Type<E>, filter: QueryFilter<E>, payload: E): string {
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

  remove<E>(entity: Type<E>, filter: QueryFilter<E>): string {
    const meta = getMeta(entity);
    const where = this.filter(entity, filter);
    return `DELETE FROM ${this.escapeId(meta.name)} WHERE ${where}`;
  }

  find<E>(entity: Type<E>, qm: Query<E>, opts?: QueryOptions): string {
    const select = this.select<E>(entity, qm, opts);
    const filter = this.filter<E>(entity, qm.filter, { prependClause: true });
    const group = this.group<E>(entity, qm.group);
    const sort = this.sort<E>(entity, qm.sort);
    const pager = this.pager(qm);
    return select + filter + group + sort + pager;
  }

  project<E>(
    entity: Type<E>,
    project: QueryProject<E>,
    opts: { prefix?: string; prependPrefixToAlias?: boolean } & QueryOptions
  ): string {
    const meta = getMeta(entity);
    const prefix = opts.prefix ? `${this.escapeId(opts.prefix, true)}.` : '';

    if (project) {
      if (!Array.isArray(project)) {
        const hasPositives = Object.keys(project).some((key) => project[key]);
        project = Object.keys(hasPositives ? project : meta.properties).filter(
          (it) => project[it] ?? project[it] === undefined
        ) as Properties<E>[];
      }
      if (opts.isTrustedProject) {
        return project.join(', ');
      }
    } else {
      project = Object.keys(meta.properties) as Properties<E>[];
    }

    return project
      .map((prop) => {
        const name = meta.properties[prop as string].name;
        const col = `${prefix}${this.escapeId(name)}`;
        if (opts.prependPrefixToAlias) {
          return `${col} ${this.escapeId(opts.prefix + '.' + prop, true)}`;
        }
        return name === prop ? col : `${col} ${this.escapeId(prop)}`;
      })
      .join(', ');
  }

  select<E>(entity: Type<E>, qm: Query<E>, opts?: QueryOptions): string {
    const meta = getMeta(entity);
    const baseColumns = this.project(entity, qm.project, {
      prefix: qm.populate && meta.name,
      ...opts,
    });
    const { joinsColumns, joinsTables } = this.populate(entity, qm.populate);
    return `SELECT ${baseColumns}${joinsColumns} FROM ${this.escapeId(meta.name)}${joinsTables}`;
  }

  populate<E>(
    entity: Type<E>,
    populate: QueryPopulate<E> = {},
    prefix?: string
  ): { joinsColumns: string; joinsTables: string } {
    let joinsColumns = '';
    let joinsTables = '';

    const meta = getMeta(entity);

    for (const popKey in populate) {
      const relOpts = meta.relations[popKey];

      if (!relOpts) {
        throw new TypeError(`'${entity.name}.${popKey}' is not annotated as a relation`);
      }
      if (relOpts.cardinality !== 'm1' && relOpts.cardinality !== '11') {
        // 'manyToMany' and 'oneToMany' will need multiple queries (so they should be resolved in a higher layer)
        continue;
      }

      const joinPrefix = prefix ? prefix + '.' + popKey : popKey;
      const joinPath = this.escapeId(joinPrefix, true);
      const relEntity = relOpts.entity();
      const popVal = populate[popKey];

      const relColumns = this.project(relEntity, popVal.project, {
        prefix: joinPrefix,
        prependPrefixToAlias: true,
      });

      joinsColumns += `, ${relColumns}`;

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

      const { joinsColumns: subJoinsColumns, joinsTables: subJoinsTables } = this.populate(
        relEntity,
        popVal.populate,
        joinPrefix
      );

      joinsColumns += subJoinsColumns;
      joinsTables += subJoinsTables;
    }

    return { joinsColumns, joinsTables };
  }

  filter<E>(
    entity: Type<E>,
    filter: QueryFilter<E>,
    opts: { prefix?: string; prependClause?: boolean; wrapWithParenthesis?: boolean } = {}
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
              this.filter(entity, filterIt, {
                prefix: opts.prefix,
                wrapWithParenthesis: hasMultiItems && Object.keys(filterIt).length > 1,
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

    return opts.prependClause ? ` WHERE ${sql}` : sql;
  }

  compare<E>(entity: Type<E>, key: string, value: Scalar | object, opts: { prefix?: string } = {}): string {
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
    entity: Type<E>,
    prop: string,
    operator: K,
    val: QueryComparisonOperator<E>[K],
    opts: { prefix?: string } = {}
  ): string {
    const meta = getMeta(entity);
    const prefix = opts.prefix ? `${this.escapeId(opts.prefix, true)}.` : '';
    const name = meta.properties[prop]?.name ?? prop;
    const colPath = prefix + this.escapeId(name);
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
    const names = properties.map((prop) => meta.properties[prop as string].name);
    return ` GROUP BY ${this.escapeId(names)}`;
  }

  sort<E>(entity: Type<E>, sort: QuerySort<E>): string {
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
    }
    if (opts.skip !== undefined) {
      sql += ` OFFSET ${Number(opts.skip)}`;
    }
    return sql;
  }

  escapeId(val: any, forbidQualified?: boolean): string {
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
      .map((key) => `${this.escapeId(key)} = ${this.escape(object[key])}`)
      .join(', ');
  }
}
