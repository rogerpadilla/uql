import { FilterQuery, ObjectId } from 'mongodb';
import { QueryFilter, Query } from '../../type';
import { getEntityMeta } from '../../entity';

export class MongoDialect {
  buildFilter<T>(filter: QueryFilter<T> = {}): FilterQuery<T> {
    return Object.keys(filter).reduce((acc, key) => {
      if (key === '$and' || key === '$or') {
        const val = filter[key];
        acc[key] = Object.keys(val).map((prop) => {
          return { [prop]: castId(prop, val) };
        });
      } else {
        acc[key] = castId(key, filter);
      }
      return acc;
    }, {});
  }

  buildAggregationPipeline<T>(type: { new (): T }, qm: Query<T>): object[] {
    const meta = getEntityMeta(type);

    const pipeline: object[] = [];

    if (qm.filter && Object.keys(qm.filter).length) {
      pipeline.push({ $match: this.buildFilter(qm.filter) });
    }

    for (const popKey in qm.populate) {
      const relOpts = meta.relations[popKey];
      if (!relOpts) {
        throw new Error(`'${type.name}.${popKey}' is not annotated with a relation decorator`);
      }
      const relType = relOpts.type();
      const relMeta = getEntityMeta(relType);
      pipeline.push({
        $lookup: {
          from: relType.name,
          localField: popKey,
          foreignField: relMeta.id.name,
          as: popKey,
        },
      });
      pipeline.push({ $unwind: { path: `$${popKey}`, preserveNullAndEmptyArrays: true } });
    }

    return pipeline;
  }
}

function castId(key: string, obj: any) {
  return key === '_id' && !(obj[key] instanceof ObjectId) ? new ObjectId(obj[key]) : obj[key];
}
