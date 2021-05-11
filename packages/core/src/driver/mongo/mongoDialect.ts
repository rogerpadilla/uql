import { FilterQuery, ObjectId } from 'mongodb';
import { QueryFilter, Query, EntityMeta } from '../../type';
import { getMeta } from '../../entity/decorator';

export class MongoDialect {
  buildFilter<E>(entity: { new (): E }, filter: QueryFilter<E> = {}): FilterQuery<E> {
    const meta = getMeta(entity);

    return Object.keys(filter).reduce((acc, prop) => {
      if (prop === '$and' || prop === '$or') {
        acc[prop] = filter[prop].map((filterIt: QueryFilter<E>) => this.buildFilter(entity, filterIt));
      } else {
        const { key, val } = obtainFinalKeyValue(prop, filter[prop], meta);
        acc[key] = val;
      }
      return acc;
    }, {});
  }

  buildAggregationPipeline<E>(entity: { new (): E }, qm: Query<E>): object[] {
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
      if (relOpts.cardinality !== 'manyToOne' && relOpts.cardinality !== 'oneToOne') {
        // 'manyToMany' and 'oneToMany' will need multiple queries (so they should be resolved in a higher layer)
        continue;
      }
      const relEntity = relOpts.entity();
      const relMeta = getMeta(relEntity);

      if (relOpts.cardinality === 'manyToOne') {
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
            pipeline: [{ $match: { [relOpts.mappedBy]: qm.filter[meta.id.name] } }],
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
