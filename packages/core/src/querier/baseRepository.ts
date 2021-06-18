import { FieldValue, Querier, Query, QueryCriteria, QueryOne, Repository, Type } from '../type';

export class BaseRepository<E> implements Repository<E> {
  constructor(readonly entity: Type<E>, readonly querier: Querier) {}

  insertMany(payload: E[]) {
    return this.querier.insertMany(this.entity, payload);
  }

  insertOne(payload: E) {
    return this.querier.insertOne(this.entity, payload);
  }

  updateMany(payload: E, qm: QueryCriteria<E>) {
    return this.querier.updateMany(this.entity, payload, qm);
  }

  updateOneById(payload: E, id: FieldValue<E>) {
    return this.querier.updateOneById(this.entity, payload, id);
  }

  findMany(qm: Query<E>) {
    return this.querier.findMany(this.entity, qm);
  }

  findOne(qm: QueryOne<E>) {
    return this.querier.findOne(this.entity, qm);
  }

  findOneById(id: FieldValue<E>, qm?: QueryOne<E>) {
    return this.querier.findOneById(this.entity, id, qm);
  }

  deleteMany(qm: QueryCriteria<E>) {
    return this.querier.deleteMany(this.entity, qm);
  }

  deleteOneById(id: FieldValue<E>) {
    return this.querier.deleteOneById(this.entity, id);
  }

  count(qm: QueryCriteria<E>) {
    return this.querier.count(this.entity, qm);
  }
}
