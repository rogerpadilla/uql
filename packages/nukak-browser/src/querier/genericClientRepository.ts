import { IdValue, QueryCriteria, QueryOne, QueryOptions, QueryProject, QuerySearch, Type } from 'nukak/type';
import { ClientQuerier, ClientRepository, RequestOptions } from '../type/index.js';

export class GenericClientRepository<E> implements ClientRepository<E> {
  constructor(readonly entity: Type<E>, readonly querier: ClientQuerier) {}

  findOneById<P extends QueryProject<E>>(id: IdValue<E>, project?: P, opts?: RequestOptions) {
    return this.querier.findOneById(this.entity, id, project, opts);
  }

  findOne<P extends QueryProject<E>>(qm: QueryOne<E>, project?: P, opts?: RequestOptions) {
    return this.querier.findOne(this.entity, qm, project, opts);
  }

  findMany<P extends QueryProject<E>>(qm: QueryCriteria<E>, project?: P, opts?: RequestOptions) {
    return this.querier.findMany(this.entity, qm, project, opts);
  }

  findManyAndCount<P extends QueryProject<E>>(qm: QueryCriteria<E>, project?: P, opts?: RequestOptions) {
    return this.querier.findManyAndCount(this.entity, qm, project, opts);
  }

  count(qm?: QuerySearch<E>, opts?: RequestOptions) {
    return this.querier.count(this.entity, qm, opts);
  }

  insertOne(payload: E, opts?: RequestOptions) {
    return this.querier.insertOne(this.entity, payload, opts);
  }

  updateOneById(id: IdValue<E>, payload: E, opts?: RequestOptions) {
    return this.querier.updateOneById(this.entity, id, payload, opts);
  }

  saveOne(payload: E, opts?: RequestOptions) {
    return this.querier.saveOne(this.entity, payload, opts);
  }

  deleteOneById(id: IdValue<E>, opts?: QueryOptions) {
    return this.querier.deleteOneById(this.entity, id, opts);
  }

  deleteMany(qm: QuerySearch<E>, opts?: QueryOptions) {
    return this.querier.deleteMany(this.entity, qm, opts);
  }
}
