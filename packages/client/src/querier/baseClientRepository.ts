import { Query, QueryCriteria, QueryOne, Type } from '@uql/core/type';
import { ClientQuerier, ClientRepository, RequestOptions } from '../type';

export class BaseClientRepository<E> implements ClientRepository<E> {
  constructor(readonly entity: Type<E>, readonly querier: ClientQuerier) {}

  insertOne(body: E, opts?: RequestOptions) {
    return this.querier.insertOne(this.entity, body, opts);
  }

  updateOneById(body: E, id: any, opts?: RequestOptions) {
    return this.querier.updateOneById(this.entity, body, id, opts);
  }

  saveOne(body: E, opts?: RequestOptions) {
    return this.querier.saveOne(this.entity, body, opts);
  }

  findMany(qm: Query<E>, opts?: RequestOptions) {
    return this.querier.findMany(this.entity, qm, opts);
  }

  findOne(qm: Query<E>, opts?: RequestOptions) {
    return this.querier.findOne(this.entity, qm, opts);
  }

  findOneById(id: any, qm?: QueryOne<E>, opts?: RequestOptions) {
    return this.querier.findOneById(this.entity, id, qm, opts);
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
