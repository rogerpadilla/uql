import { Query, QueryFilter, QueryOne, Type } from '@uql/core/type';
import { ClientQuerier, ClientRepository, RequestOptions } from '../type';

export class BaseClientRepository<E, ID = any> implements ClientRepository<E, ID> {
  constructor(readonly entity: Type<E>, readonly querier: ClientQuerier<ID>) {}

  insertOne(body: E, opts?: RequestOptions) {
    return this.querier.insertOne(this.entity, body, opts);
  }

  updateOneById(id: ID, body: E, opts?: RequestOptions) {
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

  findOneById(id: ID, qo?: QueryOne<E>, opts?: RequestOptions) {
    return this.querier.findOneById(this.entity, id, qo, opts);
  }

  removeMany(filter: QueryFilter<E>) {
    return this.querier.removeMany(this.entity, filter);
  }

  removeOneById(id: ID) {
    return this.querier.removeOneById(this.entity, id);
  }

  count(filter?: QueryFilter<E>) {
    return this.querier.count(this.entity, filter);
  }
}
