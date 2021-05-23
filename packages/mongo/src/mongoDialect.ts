import { FilterQuery, ObjectId } from 'mongodb';
import { QueryFilter, Query, EntityMeta, Type } from '@uql/core/type';
import { getMeta } from '@uql/core/entity/decorator';

export class MongoDialect {
  buildFilter<E>(entity: Type<E>, filter: QueryFilter<E> = {}): FilterQuery<E> {
    const meta = getMeta(entity);

    return Object.keys(filter).reduce((acc, prop) => {
      const entry = filter[prop];
      if (prop === '$and' || prop === '$or') {
        acc[prop] = entry.map((filterIt: QueryFilter<E>) => this.buildFilter(entity, filterIt));
      } else {
        const { key, val } = obtainFinalKeyValue(prop, entry, meta);
        acc[key] = val;
      }
      return acc;
    }, {});
  }

  buildAggregationPipeline<E>(entity: Type<E>, qm: Query<E>): object[] {
    const meta = getMeta(entity);

    const pipeline: object[] = [];

    if (qm.filter && Object.keys(qm.filter).length) {
      pipeline.push({ $match: this.buildFilter(entity, qm.filter) });
    }

    for (const popKey in qm.populate) {
      const relOpts = meta.relations[popKey];
      if (!relOpts) {
        throw new TypeError(`'${entity.name}.${popKey}' is not annotated as a relation`);
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
            localField: popKey,
            foreignField: '_id',
            as: popKey,
          },
        });
      } else {
        pipeline.push({
          $lookup: {
            from: relMeta.name,
            pipeline: [{ $match: { [relOpts.mappedBy as string]: qm.filter[meta.id.name] } }],
            as: popKey,
          },
        });
      }

      pipeline.push({ $unwind: { path: `$${popKey}`, preserveNullAndEmptyArrays: true } });
    }

    return pipeline;
  }
}

function obtainFinalKeyValue<E>(key: string, val: any, meta: EntityMeta<E>) {
  if (key === '_id' || key === meta.id.property) {
    const objectId = val instanceof ObjectId ? val : new ObjectId(val);
    return { key: '_id', val: objectId };
  }
  return { key, val };
}
