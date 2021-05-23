import { Querier, Query, QueryFilter, QueryOne, QueryOptions, Repository, Type } from '../type';

export class BaseRepository<E> implements Repository<E> {
  constructor(readonly entity: Type<E>, readonly querier: Querier) {}

  insertMany(body: E[]) {
    return this.querier.insertMany(this.entity, body);
  }

  insertOne(body: E) {
    return this.querier.insertOne(this.entity, body);
  }

  updateMany(filter: QueryFilter<E>, body: E) {
    return this.querier.updateMany(this.entity, filter, body);
  }

  updateOneById(id: any, body: E) {
    return this.querier.updateOneById(this.entity, id, body);
  }

  findMany(qm: Query<E>, opts?: QueryOptions) {
    return this.querier.findMany(this.entity, qm, opts);
  }

  findOne(qm: Query<E>, opts?: QueryOptions) {
    return this.querier.findOne(this.entity, qm, opts);
  }

  findOneById(id: any, qo?: QueryOne<E>, opts?: QueryOptions) {
    return this.querier.findOneById(this.entity, id, qo, opts);
  }

  removeMany(filter: QueryFilter<E>) {
    return this.querier.removeMany(this.entity, filter);
  }

  removeOneById(id: any) {
    return this.querier.removeOneById(this.entity, id);
  }

  count(filter?: QueryFilter<E>) {
    return this.querier.count(this.entity, filter);
  }
}
