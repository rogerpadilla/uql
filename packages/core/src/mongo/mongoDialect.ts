import { type Document, type Filter, ObjectId, type Sort } from 'mongodb';
import { AbstractDialect } from '../dialect/index.js';
import { getMeta } from '../entity/index.js';
import type {
  EntityMeta,
  FieldValue,
  NamingStrategy,
  Query,
  QueryOptions,
  QuerySelect,
  QuerySelectMap,
  QuerySortMap,
  QueryWhere,
  RelationKey,
  Type,
} from '../type/index.js';
import {
  buildQueryWhereAsMap,
  buildSortMap,
  type CallbackKey,
  fillOnFields,
  filterFieldKeys,
  filterRelationKeys,
  getKeys,
  hasKeys,
} from '../util/index.js';

export class MongoDialect extends AbstractDialect {
  constructor(namingStrategy?: NamingStrategy) {
    super('mongodb', namingStrategy);
  }

  public where<E extends Document>(
    entity: Type<E>,
    where: QueryWhere<E> = {},
    { softDelete }: QueryOptions = {},
  ): Filter<E> {
    const meta = getMeta(entity);
    const whereMap = buildQueryWhereAsMap(meta, where);

    if (meta.softDelete && (softDelete || softDelete === undefined) && !whereMap[meta.softDelete]) {
      const field = meta.fields[meta.softDelete];
      (whereMap as Record<string, unknown>)[this.resolveColumnName(meta.softDelete, field!)] = null;
    }

    return Object.entries(whereMap).reduce<Filter<E>>(
      (acc, entry) => {
        let key = entry[0];
        let val: unknown = entry[1];
        if (key === '$and' || key === '$or') {
          const filterList = (val as QueryWhere<E>[]).map((filterIt) => this.where(entity, filterIt));
          (acc as Record<string, unknown>)[key] = filterList;
        } else {
          const field = meta.fields[key];
          if (key === '_id' || key === meta.id) {
            key = '_id';
            val = this.getIdValue(val as IdValue);
          } else if (field) {
            key = this.resolveColumnName(key, field);
          }
          if (
            val &&
            typeof val === 'object' &&
            !Array.isArray(val) &&
            this.hasOperatorKeys(val as Record<string, unknown>)
          ) {
            val = this.transformOperators(val as Record<string, unknown>);
          } else if (Array.isArray(val)) {
            val = { $in: val };
          }
          (acc as Record<string, unknown>)[key] = val;
        }
        return acc;
      },
      {} as Filter<E>,
    );
  }

  /**
   * Check if an object has operator keys (keys starting with $).
   */
  private hasOperatorKeys(obj: Record<string, unknown>): boolean {
    return Object.keys(obj).some((key) => key.startsWith('$'));
  }

  protected mapTableNameRow(row: { table_name: string }): string {
    return row.table_name;
  }

  /**
   * Transform RJPC operators to MongoDB operators.
   */
  private transformOperators<T>(ops: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [op, val] of Object.entries(ops)) {
      switch (op) {
        case '$between': {
          const [min, max] = val as [unknown, unknown];
          const $gte = '$gte';
          const $lte = '$lte';
          result[$gte] = min;
          result[$lte] = max;
          break;
        }
        case '$isNull': {
          const $eq = '$eq';
          const $ne = '$ne';
          if (val) {
            result[$eq] = null;
          } else {
            result[$ne] = null;
          }
          break;
        }
        case '$isNotNull': {
          const $ne = '$ne';
          const $eq = '$eq';
          if (val) {
            result[$ne] = null;
          } else {
            result[$eq] = null;
          }
          break;
        }
        // MongoDB native operators - pass through directly
        case '$all':
        case '$size':
        case '$elemMatch':
        case '$eq':
        case '$ne':
        case '$lt':
        case '$lte':
        case '$gt':
        case '$gte':
        case '$in':
        case '$nin':
        case '$regex':
        case '$not':
          result[op] = val;
          break;
        // String operators need to be converted to regex
        case '$startsWith': {
          const $regex = '$regex';
          result[$regex] = `^${val}`;
          break;
        }
        case '$istartsWith': {
          const $regex = '$regex';
          const $options = '$options';
          result[$regex] = `^${val}`;
          result[$options] = 'i';
          break;
        }
        case '$endsWith': {
          const $regex = '$regex';
          result[$regex] = `${val}$`;
          break;
        }
        case '$iendsWith': {
          const $regex = '$regex';
          const $options = '$options';
          result[$regex] = `${val}$`;
          result[$options] = 'i';
          break;
        }
        case '$includes': {
          const $regex = '$regex';
          result[$regex] = val;
          break;
        }
        case '$iincludes': {
          const $regex = '$regex';
          const $options = '$options';
          result[$regex] = val;
          result[$options] = 'i';
          break;
        }
        case '$text': {
          const $text = '$text';
          const $search = '$search';
          result[$text] = { [$search]: val };
          break;
        }
        case '$like': {
          const $regex = '$regex';
          // Convert SQL LIKE pattern to regex
          result[$regex] = String(val).replace(/%/g, '.*').replace(/_/g, '.');
          break;
        }
        case '$ilike': {
          const $regex = '$regex';
          const $options = '$options';
          // Convert SQL ILIKE pattern to regex
          result[$regex] = String(val).replace(/%/g, '.*').replace(/_/g, '.');
          result[$options] = 'i';
          break;
        }
        default: {
          result[op] = val;
          break;
        }
      }
    }
    return result;
  }

  public select<E extends Document>(entity: Type<E>, select: QuerySelect<E>): QuerySelectMap<E> {
    if (Array.isArray(select)) {
      return Object.fromEntries(select.map((it) => [it, true])) as QuerySelectMap<E>;
    }
    return select as QuerySelectMap<E>;
  }

  public sort<E extends Document>(entity: Type<E>, sort: QuerySortMap<E>): Sort {
    return buildSortMap(sort) as Sort;
  }

  public aggregationPipeline<E extends Document>(entity: Type<E>, q: Query<E>): MongoAggregationPipelineEntry<E>[] {
    const meta = getMeta(entity);
    const where = this.where(entity, q.$where);
    const sort = this.sort(entity, q.$sort!);
    const firstPipelineEntry: MongoAggregationPipelineEntry<E> = {};

    if (hasKeys(where)) {
      firstPipelineEntry.$match = where;
    }
    if (hasKeys(sort)) {
      firstPipelineEntry.$sort = sort;
    }

    const pipeline: MongoAggregationPipelineEntry<E>[] = [];

    if (hasKeys(firstPipelineEntry)) {
      pipeline.push(firstPipelineEntry);
    }

    const relKeys = filterRelationKeys(meta, q.$select!);

    for (const relKey of relKeys) {
      const relOpts = meta.relations[relKey];
      if (!relOpts) continue;

      if (relOpts.cardinality === '1m' || relOpts.cardinality === 'mm') {
        // '1m' and 'mm' should be resolved in a higher layer because they will need multiple queries
        continue;
      }

      const relEntity = relOpts.entity!();
      const relMeta = getMeta(relEntity);

      if (relOpts.cardinality === 'm1') {
        const localField = meta.fields[relOpts.references![0].local];
        pipeline.push({
          $lookup: {
            from: this.resolveTableName(relEntity, relMeta),
            localField: this.resolveColumnName(relOpts.references![0].local, localField!),
            foreignField: '_id',
            as: relKey,
          },
        });
      } else {
        const foreignField = relMeta.fields[relOpts.references![0].foreign];
        const foreignFieldName = this.resolveColumnName(relOpts.references![0].foreign, foreignField!);
        const referenceWhere = this.where(relEntity, where);
        const referenceSort = this.sort(relEntity, q.$sort!);
        const _id = '_id';
        const referencePipelineEntry: MongoAggregationPipelineEntry<FieldValue<E>> = {
          $match: { [foreignFieldName]: referenceWhere[_id] },
        };
        if (hasKeys(referenceSort)) {
          referencePipelineEntry.$sort = referenceSort;
        }
        pipeline.push({
          $lookup: {
            from: this.resolveTableName(relEntity, relMeta),
            pipeline: [referencePipelineEntry],
            as: relKey,
          },
        });
      }

      pipeline.push({ $unwind: { path: `$${relKey}`, preserveNullAndEmptyArrays: true } });
    }

    return pipeline;
  }

  public normalizeIds<E extends Document>(meta: EntityMeta<E>, docs: E[] | undefined): E[] | undefined {
    return docs?.map((doc) => this.normalizeId(meta, doc)) as E[] | undefined;
  }

  public normalizeId<E extends Document>(meta: EntityMeta<E>, doc: E | undefined): E | undefined {
    if (!doc) {
      return doc;
    }

    const res = doc as unknown as Record<string, unknown>;
    const _id = '_id';

    if (res[_id]) {
      res[meta.id as string] = res[_id];
      if (meta.id !== _id) {
        delete res[_id];
      }
    }

    for (const key of getKeys(meta.fields)) {
      const field = meta.fields[key];
      const dbName = this.resolveColumnName(key, field!);
      if (dbName !== key && res[dbName] !== undefined) {
        res[key] = res[dbName];
        delete res[dbName];
      }
    }

    const relKeys = getKeys(meta.relations).filter((key) => res[key]) as RelationKey<E>[];

    for (const relKey of relKeys) {
      const relOpts = meta.relations[relKey];
      if (!relOpts) continue;
      const relMeta = getMeta(relOpts.entity!());
      res[relKey] = Array.isArray(res[relKey])
        ? this.normalizeIds(relMeta, res[relKey] as Document[])
        : this.normalizeId(relMeta, res[relKey] as Document);
    }

    return res as unknown as E;
  }

  public getIdValue<T extends IdValue>(value: T): T {
    if (value instanceof ObjectId) {
      return value;
    }
    try {
      return new ObjectId(value) as T;
    } catch (e) {
      return value;
    }
  }

  public getPersistable<E extends Document>(meta: EntityMeta<E>, payload: E, callbackKey: CallbackKey): Partial<E> {
    return this.getPersistables(meta, payload, callbackKey)[0];
  }

  public getPersistables<E extends Document>(
    meta: EntityMeta<E>,
    payload: E | E[],
    callbackKey: CallbackKey,
  ): Partial<E>[] {
    const payloads = fillOnFields(meta, payload, callbackKey);
    const persistableKeys = filterFieldKeys(meta, payloads[0], callbackKey);
    return payloads.map((it) =>
      persistableKeys.reduce<Partial<E>>(
        (acc, key) => {
          const field = meta.fields[key];
          (acc as Record<string, unknown>)[this.resolveColumnName(key, field!)] = it[key];
          return acc;
        },
        {} as Partial<E>,
      ),
    );
  }
}

export type MongoAggregationPipelineEntry<E extends Document> = {
  $lookup?: MongoAggregationLookup<E>;
  $match?: Filter<E> | Record<string, any>;
  $sort?: Sort;
  $unwind?: MongoAggregationUnwind;
};

type MongoAggregationLookup<E extends Document> = {
  readonly from?: string;
  readonly foreignField?: string;
  readonly localField?: string;
  readonly pipeline?: MongoAggregationPipelineEntry<FieldValue<E>>[];
  readonly as?: RelationKey<E>;
};

type MongoAggregationUnwind = {
  readonly path?: string;
  readonly preserveNullAndEmptyArrays?: boolean;
};

type IdValue = string | ObjectId;
