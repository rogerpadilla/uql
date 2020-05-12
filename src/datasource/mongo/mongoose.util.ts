import { DocumentQuery, QueryPopulateOptions, FilterQuery } from 'mongoose';
import { QueryFilter, Query, QueryPopulate } from '../../type';

export function parseFilter<T>(filter: QueryFilter<T>): FilterQuery<T> {
  const filterQuery = Object.keys(filter).reduce((acc, key) => {
    if (key === '$and' || key === '$or') {
      acc[key] = Object.keys(filter[key]).map((subKey) => {
        return { [subKey]: filter[key][subKey] };
      });
    } else {
      acc[key] = filter[key];
    }
    return acc;
  }, {});
  return filterQuery;
}

export function fillDocumentQuery<T>(docQuery: DocumentQuery<any, any>, qm: Query<T>) {
  docQuery.lean();
  if (qm.project) {
    docQuery = docQuery.select(qm.project);
  }
  if (qm.populate) {
    docQuery.populate(parsePopulate(qm.populate));
  }
  if (qm.sort) {
    docQuery = docQuery.sort(qm.sort);
  }
  if (qm.skip) {
    docQuery = docQuery.skip(qm.skip);
  }
  if (qm.limit) {
    docQuery = docQuery.limit(qm.limit);
  }
  return docQuery;
}

function parsePopulate<T>(populate: QueryPopulate<T>): QueryPopulateOptions {
  const mongoosePopulate = Object.keys(populate).reduce((acc, key) => {
    acc.path = key;
    const val: QueryPopulate<T> = populate[key];
    if (val?.project) {
      acc.select = val.project;
    }
    if (val?.populate) {
      acc.populate = parsePopulate(val.populate);
    }
    return acc;
  }, {} as QueryPopulateOptions);
  return mongoosePopulate;
}
