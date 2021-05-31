import { Querier, Query, QueryCriteria, QueryOne, Repository, Type } from '../type';

export class BaseRepository<E> implements Repository<E> {
  constructor(readonly entity: Type<E>, readonly querier: Querier) {}

  insertMany(body: E[]) {
    return this.querier.insertMany(this.entity, body);
  }

  insertOne(body: E) {
    return this.querier.insertOne(this.entity, body);
  }

  updateMany(body: E, qm: QueryCriteria<E>) {
    return this.querier.updateMany(this.entity, body, qm);
  }

  updateOneById(body: E, id: any) {
    return this.querier.updateOneById(this.entity, body, id);
  }

  findMany(qm: Query<E>) {
    return this.querier.findMany(this.entity, qm);
  }

  findOne(qm: QueryOne<E>) {
    return this.querier.findOne(this.entity, qm);
  }

  findOneById(id: any, qm?: QueryOne<E>) {
    return this.querier.findOneById(this.entity, id, qm);
  }

  deleteMany(qm: QueryCriteria<E>) {
    return this.querier.deleteMany(this.entity, qm);
  }

  deleteOneById(id: any) {
    return this.querier.deleteOneById(this.entity, id);
  }

  count(qm: QueryCriteria<E>) {
    return this.querier.count(this.entity, qm);
  }
}
