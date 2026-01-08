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
  QuerySort,
  QueryWhere,
  RelationKey,
  Type,
} from '../type/index.js';
import {
  buildSortMap,
  buldQueryWhereAsMap,
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
  where<E extends Document>(entity: Type<E>, where: QueryWhere<E> = {}, { softDelete }: QueryOptions = {}): Filter<E> {
    const meta = getMeta(entity);

    where = buldQueryWhereAsMap(meta, where);

    if (meta.softDelete && (softDelete || softDelete === undefined) && !where[meta.softDelete]) {
      const field = meta.fields[meta.softDelete];
      where[this.resolveColumnName(meta.softDelete, field)] = null;
    }

    return getKeys(where).reduce(
      (acc, key) => {
        let value = where[key];
        if (key === '$and' || key === '$or') {
          acc[key] = value.map((filterIt: QueryWhere<E>) => this.where(entity, filterIt));
        } else {
          const field = meta.fields[key];
          if (key === '_id' || key === meta.id) {
            key = '_id';
            value = this.getIdValue(value);
          } else if (field) {
            key = this.resolveColumnName(key, field);
          }
          if (Array.isArray(value)) {
            value = {
              $in: value,
            };
          }
          acc[key as keyof Filter<E>] = value;
        }
        return acc;
      },
      {} as Filter<E>,
    );
  }

  select<E extends Document>(entity: Type<E>, select: QuerySelect<E>): QuerySelectMap<E> {
    if (Array.isArray(select)) {
      return select.reduce(
        (acc, it) => {
          acc[it as string] = true;
          return acc;
        },
        {} satisfies QuerySelectMap<E>,
      );
    }
    return select as QuerySelectMap<E>;
  }

  sort<E extends Document>(entity: Type<E>, sort: QuerySort<E>): Sort {
    return buildSortMap(sort) as Sort;
  }

  aggregationPipeline<E extends Document>(entity: Type<E>, q: Query<E>): MongoAggregationPipelineEntry<E>[] {
    const meta = getMeta(entity);

    const where = this.where(entity, q.$where);
    const sort = this.sort(entity, q.$sort);
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

    const relKeys = filterRelationKeys(meta, q.$select);

    for (const relKey of relKeys) {
      const relOpts = meta.relations[relKey];

      if (relOpts.cardinality === '1m' || relOpts.cardinality === 'mm') {
        // '1m' and 'mm' should be resolved in a higher layer because they will need multiple queries
        continue;
      }

      const relEntity = relOpts.entity();
      const relMeta = getMeta(relEntity);

      if (relOpts.cardinality === 'm1') {
        const localField = meta.fields[relOpts.references[0].local];
        pipeline.push({
          $lookup: {
            from: this.resolveTableName(relEntity, relMeta),
            localField: this.resolveColumnName(relOpts.references[0].local, localField),
            foreignField: '_id',
            as: relKey,
          },
        });
      } else {
        const foreignField = relMeta.fields[relOpts.references[0].foreign];
        const foreignFieldName = this.resolveColumnName(relOpts.references[0].foreign, foreignField);
        const referenceWhere = this.where(relEntity, where);
        const referenceSort = this.sort(relEntity, q.$sort);
        const referencePipelineEntry: MongoAggregationPipelineEntry<FieldValue<E>> = {
          $match: { [foreignFieldName]: referenceWhere._id },
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

  normalizeIds<E extends Document>(meta: EntityMeta<E>, docs: E[]): E[] {
    return docs?.map((doc) => this.normalizeId(meta, doc));
  }

  normalizeId<E extends Document>(meta: EntityMeta<E>, doc: E): E {
    if (!doc) {
      return;
    }

    const res = doc as unknown as Record<string, unknown>;

    if (res._id) {
      res[meta.id] = res._id;
      if (meta.id !== '_id') {
        delete res._id;
      }
    }

    for (const key of getKeys(meta.fields)) {
      const field = meta.fields[key];
      const dbName = this.resolveColumnName(key, field);
      if (dbName !== key && res[dbName] !== undefined) {
        res[key as string] = res[dbName];
        delete res[dbName];
      }
    }

    const relKeys = getKeys(meta.relations).filter((key) => res[key]) as RelationKey<E>[];

    for (const relKey of relKeys) {
      const relOpts = meta.relations[relKey];
      const relMeta = getMeta(relOpts.entity());
      res[relKey as string] = Array.isArray(res[relKey as string])
        ? this.normalizeIds(relMeta, res[relKey as string] as Document[])
        : this.normalizeId(relMeta, res[relKey as string] as Document);
    }

    return res as unknown as E;
  }

  getIdValue<T extends IdValue>(value: T): T {
    if (value instanceof ObjectId) {
      return value;
    }
    try {
      return new ObjectId(value) as T;
    } catch (e) {
      return value;
    }
  }

  getPersistable<E>(meta: EntityMeta<E>, payload: E, callbackKey: CallbackKey): E {
    return this.getPersistables(meta, payload, callbackKey)[0];
  }

  getPersistables<E>(meta: EntityMeta<E>, payload: E | E[], callbackKey: CallbackKey): E[] {
    const payloads = fillOnFields(meta, payload, callbackKey);
    const persistableKeys = filterFieldKeys(meta, payloads[0], callbackKey);
    return payloads.map((it) =>
      persistableKeys.reduce((acc, key) => {
        const field = meta.fields[key];
        acc[this.resolveColumnName(key, field)] = it[key];
        return acc;
      }, {} as E),
    );
  }
}

type MongoAggregationPipelineEntry<E extends Document> = {
  readonly $lookup?: MongoAggregationLookup<E>;
  $match?: Filter<E> | Record<string, any>;
  $sort?: Sort;
  readonly $unwind?: MongoAggregationUnwind;
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
