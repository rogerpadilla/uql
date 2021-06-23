import { FilterQuery, ObjectId } from 'mongodb';
import { QueryFilter, Query, EntityMeta, Type, QueryProject, QueryProjectMap, RelationKey, Key } from '@uql/core/type';
import { getMeta } from '@uql/core/entity/decorator';
import { hasKeys, getKeys } from '@uql/core/util';
import { getProjectRelations } from '@uql/core/querier';

export class MongoDialect {
  filter<E>(entity: Type<E>, filter: QueryFilter<E> = {}): FilterQuery<E> {
    const meta = getMeta(entity);

    return getKeys(filter).reduce((acc, prop) => {
      const value = filter[prop];
      if (prop === '$and' || prop === '$or') {
        acc[prop] = value.map((filterIt: QueryFilter<E>) => this.filter(entity, filterIt));
      } else {
        const { key, val } = this.obtainFinalKeyValue(meta, prop as Key<E>, value);
        acc[key as keyof FilterQuery<E>] = val;
      }
      return acc;
    }, {} as FilterQuery<E>);
  }

  project<E>(entity: Type<E>, project: QueryProject<E>): QueryProjectMap<E> {
    if (Array.isArray(project)) {
      return project.reduce((acc, it) => {
        if (typeof it === 'string') {
          acc[it as string] = true;
        }
        return acc;
      }, {} as QueryProjectMap<E>);
    }
    return project as QueryProjectMap<E>;
  }

  aggregationPipeline<E>(entity: Type<E>, qm: Query<E>): object[] {
    const meta = getMeta(entity);

    const pipeline: object[] = [];

    if (hasKeys(qm.$filter)) {
      pipeline.push({ $match: this.filter(entity, qm.$filter) });
    }

    const relations = getProjectRelations(meta, qm.$project);

    for (const relKey of relations) {
      const relOpts = meta.relations[relKey as RelationKey<E>];

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
            localField: relOpts.references[0].source,
            foreignField: '_id',
            as: relKey,
          },
        });
      } else {
        const referenceKey = relOpts.mappedBy ? relOpts.references[0].target : relOpts.references[0].source;
        pipeline.push({
          $lookup: {
            from: relMeta.name,
            pipeline: [{ $match: { [referenceKey]: qm.$filter[meta.id as string] } }],
            as: relKey,
          },
        });
      }

      pipeline.push({ $unwind: { path: `$${relKey}`, preserveNullAndEmptyArrays: true } });
    }

    return pipeline;
  }

  normalizeIds<E>(meta: EntityMeta<E>, docs: E[]): E[] {
    return docs?.map((doc) => this.normalizeId(meta, doc));
  }

  normalizeId<E>(meta: EntityMeta<E>, doc: E): E {
    if (!doc) {
      return;
    }

    const res = doc as E & { _id: any };

    if (res._id) {
      res[meta.id] = res._id;
      delete res._id;
    }

    const keys = getKeys(meta.relations).filter((key) => doc[key]);

    for (const key of keys) {
      const relOpts = meta.relations[key];
      const relMeta = getMeta(relOpts.entity());
      res[key] = Array.isArray(res[key]) ? this.normalizeIds(relMeta, res[key]) : this.normalizeId(relMeta, res[key]);
    }

    return res as E;
  }

  obtainFinalKeyValue<E>(meta: EntityMeta<E>, key: Key<E>, val: string | number | ObjectId) {
    if (key === '_id' || key === meta.id) {
      const objectId = val instanceof ObjectId ? val : new ObjectId(val);
      return { key: '_id', val: objectId };
    }
    return { key, val };
  }
}
