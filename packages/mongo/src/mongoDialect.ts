import { FilterQuery, ObjectId } from 'mongodb';
import { QueryFilter, Query, EntityMeta, Type, QueryProject, QueryProjectProperties, Relations } from '@uql/core/type';
import { getMeta } from '@uql/core/entity/decorator';
import { hasKeys, getKeys } from '@uql/core/util';

export class MongoDialect {
  filter<E>(entity: Type<E>, filter: QueryFilter<E> = {}): FilterQuery<E> {
    const meta = getMeta(entity);

    return getKeys(filter).reduce((acc, prop) => {
      const value = filter[prop];
      if (prop === '$and' || prop === '$or') {
        acc[prop] = value.map((filterIt: QueryFilter<E>) => this.filter(entity, filterIt));
      } else {
        const { key, val } = obtainFinalKeyValue(prop, value, meta);
        acc[key as keyof FilterQuery<E>] = val;
      }
      return acc;
    }, {} as FilterQuery<E>);
  }

  project<E>(project: QueryProject<E>): QueryProjectProperties<E> {
    if (Array.isArray(project)) {
      return project.reduce((acc, it) => {
        acc[it] = true;
        return acc;
      }, {} as QueryProjectProperties<E>);
    }
    return project as QueryProjectProperties<E>;
  }

  aggregationPipeline<E>(entity: Type<E>, qm: Query<E>): object[] {
    const meta = getMeta(entity);

    const pipeline: object[] = [];

    if (hasKeys(qm.$filter)) {
      pipeline.push({ $match: this.filter(entity, qm.$filter) });
    }

    for (const relKey in qm.$populate) {
      const relOpts = meta.relations[relKey as Relations<E>];
      if (!relOpts) {
        throw new TypeError(`'${entity.name}.${relKey}' is not annotated as a relation`);
      }
      if (relOpts.cardinality !== 'm1' && relOpts.cardinality !== '11') {
        // 'manyToMany' and 'oneToMany' will need multiple queries (so they should be resolved in a higher layer)
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
        const prop = relOpts.mappedBy ? relOpts.references[0].target : relOpts.references[0].source;
        pipeline.push({
          $lookup: {
            from: relMeta.name,
            pipeline: [{ $match: { [prop]: qm.$filter[meta.id as string] } }],
            as: relKey,
          },
        });
      }

      pipeline.push({ $unwind: { path: `$${relKey}`, preserveNullAndEmptyArrays: true } });
    }

    return pipeline;
  }
}

function obtainFinalKeyValue<E>(key: string, val: any, meta: EntityMeta<E>) {
  if (key === '_id' || key === meta.id) {
    const objectId = val instanceof ObjectId ? val : new ObjectId(val);
    return { key: '_id', val: objectId };
  }
  return { key, val };
}
