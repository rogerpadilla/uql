import { Query, QueryFilter, QueryOne, Type } from '@uql/core/type';
import { ClientQuerier, ClientRepository, RequestOptions } from '../type';

export class BaseClientRepository<E> implements ClientRepository<E> {
  constructor(readonly entity: Type<E>, readonly querier: ClientQuerier) {}

  insertOne(body: E, opts?: RequestOptions) {
    return this.querier.insertOne(this.entity, body, opts);
  }

  updateOneById(id: any, body: E, opts?: RequestOptions) {
    return this.querier.updateOneById(this.entity, id, body, opts);
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

  findOneById(id: any, qo?: QueryOne<E>, opts?: RequestOptions) {
    return this.querier.findOneById(this.entity, id, qo, opts);
  }

  deleteMany(filter: QueryFilter<E>) {
    return this.querier.deleteMany(this.entity, filter);
  }

  deleteOneById(id: any) {
    return this.querier.deleteOneById(this.entity, id);
  }

  count(filter?: QueryFilter<E>) {
    return this.querier.count(this.entity, filter);
  }
}
