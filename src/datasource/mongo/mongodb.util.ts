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

  if (qm.filter) {
    pipeline.push({ $match: buildFilter(qm.filter) });
  }

  for (const popKey of Object.keys(qm.populate)) {
    const relProps = meta.columns[popKey].relation;
    const relType = relProps.type();
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
