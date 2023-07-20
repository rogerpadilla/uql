import { Document, Filter, ObjectId, Sort } from 'mongodb';
import { getKeys, hasKeys, buildSortMap, getProjectRelationKeys, getQueryFilterAsMap } from 'nukak/util';
import { getMeta } from 'nukak/entity';
import type {
  QueryFilter,
  EntityMeta,
  Type,
  QueryProject,
  QueryProjectMap,
  QueryOptions,
  QuerySort,
  FieldValue,
  RelationKey,
  QueryCriteria,
} from 'nukak/type';

export class MongoDialect {
  filter<E extends Document>(
    entity: Type<E>,
    filter: QueryFilter<E> = {},
    { softDelete }: QueryOptions = {},
  ): Filter<E> {
    const meta = getMeta(entity);

    filter = getQueryFilterAsMap(meta, filter);

    if (meta.softDelete && (softDelete || softDelete === undefined) && !filter[meta.softDelete as string]) {
      filter[meta.softDelete as string] = null;
    }

    return getKeys(filter).reduce((acc, key) => {
      let value = filter[key];
      if (key === '$and' || key === '$or') {
        acc[key] = value.map((filterIt: QueryFilter<E>) => this.filter(entity, filterIt));
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

  project<E extends Document>(entity: Type<E>, project: QueryProject<E>): QueryProjectMap<E> {
    if (Array.isArray(project)) {
      return project.reduce((acc, it) => {
        acc[it as string] = true;
        return acc;
      }, {} satisfies QueryProjectMap<E>);
    }
    return project as QueryProjectMap<E>;
  }

  sort<E extends Document>(entity: Type<E>, sort: QuerySort<E>): Sort {
    return buildSortMap(sort) as Sort;
  }

  aggregationPipeline<E extends Document, P extends QueryProject<E>>(
    entity: Type<E>,
    qm: QueryCriteria<E>,
    project?: P,
  ): MongoAggregationPipelineEntry<E>[] {
    const meta = getMeta(entity);

    const filter = this.filter(entity, qm.$filter);
    const sort = this.sort(entity, qm.$sort);
    const firstPipelineEntry: MongoAggregationPipelineEntry<E> = {};

    if (hasKeys(filter)) {
      firstPipelineEntry.$match = filter;
    }
    if (hasKeys(sort)) {
      firstPipelineEntry.$sort = sort;
    }

    const pipeline: MongoAggregationPipelineEntry<E>[] = [];

    if (hasKeys(firstPipelineEntry)) {
      pipeline.push(firstPipelineEntry);
    }

    const relations = getProjectRelationKeys(meta, project);

    for (const relKey of relations) {
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
        const referenceFilter = this.filter(relEntity, qm.$filter);
        const referenceSort = this.sort(relEntity, qm.$sort);
        const referencePipelineEntry: MongoAggregationPipelineEntry<FieldValue<E>> = {
          $match: { [foreignField]: referenceFilter._id },
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
