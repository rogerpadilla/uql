import { FilterQuery, ObjectId } from 'mongodb';
import { QueryFilter, Query, EntityMeta, Type, QueryProject, QueryProjectMap, QueryOptions } from '@uql/core/type';
import { getMeta } from '@uql/core/entity/decorator';
import { getKeys, hasKeys } from '@uql/core/util';
import { getProjectRelationKeys } from '@uql/core/querier';

export class MongoDialect {
  filter<E>(entity: Type<E>, filter: QueryFilter<E> = {}, { softDelete }: QueryOptions = {}): FilterQuery<E> {
    const meta = getMeta(entity);

    if (
      filter !== undefined &&
      (typeof filter !== 'object' ||
        Array.isArray(filter) ||
        filter instanceof ObjectId ||
        ObjectId.isValid(filter as string))
    ) {
      filter = {
        [meta.id]: filter,
      };
    }

    if (meta.softDeleteKey && !softDelete && (!filter || !(meta.softDeleteKey in filter))) {
      if (!filter) {
        filter = {};
      }
      filter[meta.softDeleteKey as string] = null;
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
        acc[key as keyof FilterQuery<E>] = value;
      }
      return acc;
    }, {} as FilterQuery<E>);
  }

  project<E>(entity: Type<E>, project: QueryProject<E>): QueryProjectMap<E> {
    if (Array.isArray(project)) {
      return project.reduce((acc, it) => {
        acc[it as string] = true;
        return acc;
      }, {} as QueryProjectMap<E>);
    }
    return project as QueryProjectMap<E>;
  }

  aggregationPipeline<E>(entity: Type<E>, qm: Query<E>): object[] {
    const meta = getMeta(entity);

    const pipeline: object[] = [];

    const filter = this.filter(entity, qm.$filter);

    if (hasKeys(filter)) {
      pipeline.push({ $match: filter });
    }

    const relations = getProjectRelationKeys(meta, qm.$project);

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
            localField: relOpts.references[0].source,
            foreignField: '_id',
            as: relKey,
          },
        });
      } else {
        const referenceKey = relOpts.mappedBy ? relOpts.references[0].target : relOpts.references[0].source;
        const referenceFilter = this.filter(relEntity, qm.$filter);
        pipeline.push({
          $lookup: {
            from: relMeta.name,
            pipeline: [{ $match: { [referenceKey]: referenceFilter._id } }],
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

    const relKeys = getKeys(meta.relations).filter((key) => doc[key]);

    for (const relKey of relKeys) {
      const relOpts = meta.relations[relKey];
      const relMeta = getMeta(relOpts.entity());
      res[relKey] = Array.isArray(res[relKey])
        ? this.normalizeIds(relMeta, res[relKey])
        : this.normalizeId(relMeta, res[relKey]);
    }

    return res as E;
  }

  getIdValue<T extends string | string[] | ObjectId | ObjectId[]>(value: T): T {
    if (value instanceof ObjectId) {
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((it) => this.getIdValue(it)) as T;
    }
    return new ObjectId(value) as T;
  }
}
