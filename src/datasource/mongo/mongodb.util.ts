import { FilterQuery } from 'mongodb';
import { QueryFilter, Query } from '../../type';
import { getEntityMeta } from '../../entity';

export function buildFilter<T>(filter: QueryFilter<T>): FilterQuery<T> {
  return Object.keys(filter).reduce((acc, key) => {
    const val = filter[key];
    if (key === '$and' || key === '$or') {
      acc[key] = Object.keys(val).map((prop) => {
        return { [prop]: val[prop] };
      });
    } else {
      acc[key] = val;
    }
    return acc;
  }, {});
}

export function buildAggregationPipeline<T>(type: { new (): T }, qm: Query<T>) {
  const meta = getEntityMeta(type);

  const pipeline: object[] = [];

  if (qm.filter && Object.keys(qm.filter).length) {
    pipeline.push({ $match: buildFilter(qm.filter) });
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
        foreignField: relMeta.id,
        as: popKey,
      },
    });
    pipeline.push({ $unwind: { path: `$${popKey}`, preserveNullAndEmptyArrays: true } });
  }

  return pipeline;
}
