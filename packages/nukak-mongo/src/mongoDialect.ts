import { Document, Filter, ObjectId, Sort } from 'mongodb';
import {
  getKeys,
  hasKeys,
  buildSortMap,
  filterRelationKeys,
  buldQueryWhereAsMap,
  CallbackKey,
  fillOnFields,
  filterFieldKeys,
} from 'nukak/util';
import { getMeta } from 'nukak/entity';
import type {
  QueryWhere,
  EntityMeta,
  Type,
  QuerySelect,
  QuerySelectMap,
  QueryOptions,
  QuerySort,
  FieldValue,
  RelationKey,
  Query,
} from 'nukak/type';

export class MongoDialect {
  where<E extends Document>(entity: Type<E>, where: QueryWhere<E> = {}, { softDelete }: QueryOptions = {}): Filter<E> {
    const meta = getMeta(entity);

    where = buldQueryWhereAsMap(meta, where);

    if (meta.softDelete && (softDelete || softDelete === undefined) && !where[meta.softDelete as string]) {
      where[meta.softDelete as string] = null;
    }

    return getKeys(where).reduce((acc, key) => {
      let value = where[key];
      if (key === '$and' || key === '$or') {
        acc[key] = value.map((filterIt: QueryWhere<E>) => this.where(entity, filterIt));
      } else {
        if (key === '_id' || key === meta.id) {
          key = '_id';
          value = this.getIdValue(value);
        } else if (Array.isArray(value)) {
          value = {
            $in: value,
          };
        }
        acc[key as keyof Filter<E>] = value;
      }
      return acc;
    }, {} as Filter<E>);
  }

  select<E extends Document>(entity: Type<E>, select: QuerySelect<E>): QuerySelectMap<E> {
    if (Array.isArray(select)) {
      return select.reduce((acc, it) => {
        acc[it as string] = true;
        return acc;
      }, {} satisfies QuerySelectMap<E>);
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
        pipeline.push({
          $lookup: {
            from: relMeta.name,
            localField: relOpts.references[0].local,
            foreignField: '_id',
            as: relKey,
          },
        });
      } else {
        const foreignField = relOpts.references[0].foreign;
        const referenceWhere = this.where(relEntity, where);
        const referenceSort = this.sort(relEntity, q.$sort);
        const referencePipelineEntry: MongoAggregationPipelineEntry<FieldValue<E>> = {
          $match: { [foreignField]: referenceWhere._id },
        };
        if (hasKeys(referenceSort)) {
          referencePipelineEntry.$sort = referenceSort;
        }
        pipeline.push({
          $lookup: {
            from: relMeta.name,
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

    const res = doc as E & { _id: any };

    if (res._id) {
      res[meta.id] = res._id;
      delete res._id;
    }

    const relKeys = getKeys(meta.relations).filter((key) => doc[key]) as RelationKey<E>[];

    for (const relKey of relKeys) {
      const relOpts = meta.relations[relKey];
      const relMeta = getMeta(relOpts.entity());
      res[relKey] = Array.isArray(res[relKey])
        ? this.normalizeIds(relMeta, res[relKey])
        : this.normalizeId(relMeta, res[relKey]);
    }

    return res;
  }

  getIdValue<T extends IdValue>(value: T): T {
    if (value instanceof ObjectId) {
      return value;
    }
    return new ObjectId(value) as T;
  }

  getPersistable<E>(meta: EntityMeta<E>, payload: E, callbackKey: CallbackKey): E {
    return this.getPersistables(meta, payload, callbackKey)[0];
  }

  getPersistables<E>(meta: EntityMeta<E>, payload: E | E[], callbackKey: CallbackKey): E[] {
    const payloads = fillOnFields(meta, payload, callbackKey);
    const persistableKeys = filterFieldKeys(meta, payloads[0], callbackKey);
    return payloads.map((it) =>
      persistableKeys.reduce((acc, key) => {
        acc[key] = it[key];
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
