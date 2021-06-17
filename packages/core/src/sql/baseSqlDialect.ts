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
  Fields,
  QueryProject,
  Type,
  QueryCriteria,
  QueryPopulateValue,
  Relations,
} from '../type';
import { buildPersistable, fillOnCallbacks, filterFields } from '../entity/util';
import { hasKeys, getKeys } from '../util';
import { Raw } from './raw';

export abstract class BaseSqlDialect {
  readonly escapeIdRegex: RegExp;

  constructor(readonly beginTransactionCommand: string, readonly escapeIdChar: '`' | '"') {
    this.escapeIdRegex = RegExp(escapeIdChar, 'g');
  }

  criteria<E>(entity: Type<E>, qm: Query<E>): string {
    const prefix = hasKeys(qm.$populate) ? getMeta(entity).name : undefined;
    const filter = this.filter<E>(entity, qm.$filter, { prefix });
    const group = this.group<E>(entity, qm.$group);
    const having = this.filter<E>(entity, qm.$having, { prefix, clause: 'HAVING' });
    const sort = this.sort<E>(entity, qm.$sort);
    const pager = this.pager(qm);
    return filter + group + having + sort + pager;
  }

  find<E>(entity: Type<E>, qm: Query<E>): string {
    const select = this.select<E>(entity, qm);
    return select + this.criteria(entity, qm);
  }

  insert<E>(entity: Type<E>, payload: E | E[]): string {
    const meta = getMeta(entity);
    const payloads = fillOnCallbacks(meta, payload, 'onInsert');
    const keys = filterFields(meta, payloads[0]);
    const columns = keys.map((key) => this.escapeId(meta.fields[key].name));
    const values = payloads.map((it) => keys.map((key) => this.escape(it[key])).join(', ')).join('), (');
    return `INSERT INTO ${this.escapeId(meta.name)} (${columns.join(', ')}) VALUES (${values})`;
  }

  update<E>(entity: Type<E>, payload: E, qm: QueryCriteria<E>): string {
    const meta = getMeta(entity);
    payload = buildPersistable(meta, payload, 'onUpdate');
    const values = this.objectToValues(payload);
    const criteria = this.criteria(entity, qm);
    return `UPDATE ${this.escapeId(meta.name)} SET ${values}${criteria}`;
  }

  delete<E>(entity: Type<E>, qm: QueryCriteria<E>): string {
    const meta = getMeta(entity);
    const criteria = this.criteria(entity, qm);
    return `DELETE FROM ${this.escapeId(meta.name)}${criteria}`;
  }

  project<E>(entity: Type<E>, project: QueryProject<E>, opts: { prefix?: string; usePrefixInAlias?: boolean }): string {
    const meta = getMeta(entity);
    const prefix = opts.prefix ? `${this.escapeId(opts.prefix, true)}.` : '';

    if (project) {
      if (!Array.isArray(project)) {
        const projectKeys = getKeys(project);
        const hasPositives = projectKeys.some((key) => project[key]);
        project = (hasPositives ? projectKeys : getKeys(meta.fields)).filter(
          (it) => project[it] ?? project[it] === undefined
        ) as Fields<E>[];
      }
    } else {
      project = getKeys(meta.fields) as Fields<E>[];
    }

    return project
      .map((key) => {
        if (key instanceof Raw) {
          return key.alias ? `${key.value} ${this.escapeId(key.alias, true)}` : key.value;
        }
        const field = meta.fields[key];
        const name = field?.name ?? key;
        const fieldPath = `${prefix}${this.escapeId(name)}`;
        if (opts.usePrefixInAlias) {
          return `${fieldPath} ${this.escapeId(opts.prefix + '.' + key, true)}`;
        }
        return name === key || !field ? fieldPath : `${fieldPath} ${this.escapeId(key)}`;
      })
      .join(', ');
  }

  select<E>(entity: Type<E>, qm: Query<E>): string {
    const meta = getMeta(entity);
    const baseColumns = this.project(entity, qm.$project, {
      prefix: hasKeys(qm.$populate) ? meta.name : undefined,
    });
    const { joinsColumns, joinsTables } = this.join(entity, qm.$populate);
    return `SELECT ${baseColumns}${joinsColumns} FROM ${this.escapeId(meta.name)}${joinsTables}`;
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
      const relOpts = meta.relations[relKey as Relations<E>];

      if (!relOpts) {
        throw new TypeError(`'${entity.name}.${relKey}' is not annotated as a relation`);
      }
      if (relOpts.cardinality === '1m' || relOpts.cardinality === 'mm') {
        // '1m' and 'mm' will need multiple queries (so they should be resolved in a higher layer)
        continue;
      }

      const joinRelAlias = prefix ? prefix + '.' + relKey : relKey;
      const relEntity = relOpts.entity();
      const popVal = populate[relKey] as QueryPopulateValue<typeof relEntity>;

      const relColumns = this.project(relEntity, popVal.$project, {
        prefix: joinRelAlias,
        usePrefixInAlias: true,
      });

      joinsColumns += ', ' + relColumns;

      const { joinsColumns: subJoinsColumns, joinsTables: subJoinsTables } = this.join(
        relEntity,
        popVal.$populate,
        joinRelAlias
      );

      joinsColumns += subJoinsColumns;

      const relMeta = getMeta(relEntity);
      const relEntityName = this.escapeId(relMeta.name);
      const relPath = prefix ? this.escapeId(prefix, true) : this.escapeId(meta.name);
      const joinType = popVal.$required ? 'INNER' : 'LEFT';
      const joinAlias = this.escapeId(joinRelAlias, true);

      joinsTables += ` ${joinType} JOIN ${relEntityName} ${joinAlias} ON `;
      joinsTables += relOpts.references
        .map((it) => `${joinAlias}.${this.escapeId(it.target)} = ${relPath}.${this.escapeId(it.source)}`)
        .join(' AND ');

      if (hasKeys(popVal.$filter)) {
        const filter = this.filter(relEntity, popVal.$filter, { prefix: relKey, clause: false });
        joinsTables += ` AND ${filter}`;
      }

      joinsTables += subJoinsTables;
    }

    return { joinsColumns, joinsTables };
  }

  filter<E>(
    entity: Type<E>,
    filter: QueryFilter<E>,
    opts: { prefix?: string; wrapWithParenthesis?: boolean; clause?: 'WHERE' | 'HAVING' | false } = {}
  ): string {
    const { prefix, wrapWithParenthesis, clause = 'WHERE' } = opts;
    const filterKeys = getKeys(filter);
    if (!filterKeys?.length) {
      return '';
    }

    const hasMultiKeys = filterKeys.length > 1;

    let sql = filterKeys
      .map((key) => {
        const entry = filter[key];
        if (key === '$and' || key === '$or') {
          const hasManyEntries = entry.length > 1;
          const logicalComparison = entry
            .map((filterIt: QueryFilter<E>) =>
              this.filter(entity, filterIt, {
                prefix,
                wrapWithParenthesis: hasManyEntries && getKeys(filterIt).length > 1,
                clause: false,
              })
            )
            .join(key === '$or' ? ' OR ' : ' AND ');
          return hasManyEntries && hasMultiKeys ? `(${logicalComparison})` : logicalComparison;
        }
        return this.compare(entity, key, entry, { prefix });
      })
      .join(` AND `);

    if (wrapWithParenthesis) {
      sql = `(${sql})`;
    }

    return clause ? ` ${clause} ${sql}` : sql;
  }

  compare<E>(entity: Type<E>, key: string, value: Scalar | object | Scalar[], opts: { prefix?: string } = {}): string {
    switch (key) {
      case '$text':
        const meta = getMeta(entity);
        const search = value as QueryTextSearchOptions<E>;
        return `${this.escapeId(meta.name)} MATCH ${this.escape(search.$value)}`;
      default:
        const val = Array.isArray(value)
          ? { $in: value }
          : typeof value === 'object' && value !== null
          ? value
          : { $eq: value };
        const operators = getKeys(val) as (keyof QueryComparisonOperator<E>)[];
        const operations = operators
          .map((operator) => this.compareOperator(entity, key, operator, val[operator], opts))
          .join(' AND ');
        return operators.length > 1 ? `(${operations})` : operations;
    }
  }

  compareOperator<E, K extends keyof QueryComparisonOperator<E>>(
    entity: Type<E>,
    key: string,
    operator: K,
    val: QueryComparisonOperator<E>[K],
    opts: { prefix?: string } = {}
  ): string {
    const meta = getMeta(entity);
    const prefix = opts.prefix ? `${this.escapeId(opts.prefix, true)}.` : '';
    const field = this.escapeId(meta.fields[key]?.name ?? key);
    const fieldPath = prefix + field;
    switch (operator) {
      case '$eq':
        return val === null ? `${fieldPath} IS NULL` : `${fieldPath} = ${this.escape(val)}`;
      case '$ne':
        return val === null ? `${fieldPath} IS NOT NULL` : `${fieldPath} <> ${this.escape(val)}`;
      case '$gt':
        return `${fieldPath} > ${this.escape(val)}`;
      case '$gte':
        return `${fieldPath} >= ${this.escape(val)}`;
      case '$lt':
        return `${fieldPath} < ${this.escape(val)}`;
      case '$lte':
        return `${fieldPath} <= ${this.escape(val)}`;
      case '$startsWith':
        return `LOWER(${fieldPath}) LIKE ${this.escape((val as string).toLowerCase() + '%')}`;
      case '$in':
        return `${fieldPath} IN (${this.escape(val)})`;
      case '$nin':
        return `${fieldPath} NOT IN (${this.escape(val)})`;
      case '$regex':
        return `${fieldPath} REGEXP ${this.escape(val)}`;
      default:
        throw new TypeError(`unknown operator: ${operator}`);
    }
  }

  group<E>(entity: Type<E>, fields: Fields<E>[]): string {
    if (!fields?.length) {
      return '';
    }
    const meta = getMeta(entity);
    const names = fields.map((key) => this.escapeId(meta.fields[key]?.name ?? key)).join(', ');
    return ` GROUP BY ${names}`;
  }

  sort<E>(entity: Type<E>, sort: QuerySort<E>): string {
    const keys = getKeys(sort);
    if (!keys?.length) {
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

  escapeId(val: string, forbidQualified?: boolean): string {
    if (!forbidQualified && val.includes('.')) {
      return val
        .split('.')
        .map((it) => this.escapeId(it))
        .join('.');
    }

    return (
      // sourced from 'escapeId' function here https://github.com/mysqljs/sqlstring/blob/master/lib/SqlString.js
      this.escapeIdChar + val.replace(this.escapeIdRegex, this.escapeIdChar + this.escapeIdChar) + this.escapeIdChar
    );
  }

  escape(val: any): string {
    return escape(val);
  }

  objectToValues<E>(payload: E): string {
    return getKeys(payload)
      .map((key) => `${this.escapeId(key)} = ${this.escape(payload[key])}`)
      .join(', ');
  }
}
