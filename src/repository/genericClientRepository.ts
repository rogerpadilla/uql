import { get, post, put, remove, RequestOptions } from '../http';
import { Query, QueryFilter, QueryOneFilter, QueryOne } from '../type';
import { stringifyQuery, stringifyQueryParameter } from '../util/query.util';
import { formatKebabCase } from '../util/string.util';
import { getEntityMeta } from '../entity';
import { ClientRepository } from './type';

export class GenericClientRepository<T, ID> implements ClientRepository<T, ID> {
  protected readonly idName: string;

  /**
   * The base-path for the endpoints. Children could override it if necessary.
   * For instance, when endpoints are not under path '/api/', or when it is
   * something like '/api/v1/'. It can also be dynamically calculated if necessary
   * (by using a getter called 'basePath')
   */
  protected readonly basePath: string;

  constructor(readonly type: { new (): T }) {
    const meta = getEntityMeta(this.type);
    this.idName = meta.id;
    this.basePath = '/api/' + formatKebabCase(this.type.name);
  }

  insertOne(body: T, opts?: RequestOptions) {
    return post<ID>(this.basePath, body, opts);
  }

  updateOneById(id: ID, body: T, opts?: RequestOptions) {
    return put<ID>(`${this.basePath}/${id}`, body, opts);
  }

  saveOne(body: T, opts?: RequestOptions) {
    const id: ID = body[this.idName];
    if (id) {
      return this.updateOneById(id, body, opts);
    }
    return this.insertOne(body, opts);
  }

  findOneById(id: ID, qm: QueryOne<T>, opts?: RequestOptions) {
    const qs = stringifyQuery(qm);
    return get<T>(`${this.basePath}/${id}${qs}`, opts);
  }

  findOne(qm: QueryOneFilter<T>, opts?: RequestOptions) {
    const qs = stringifyQuery(qm);
    return get<T>(`${this.basePath}/one${qs}`, opts);
  }

  find(qm: Query<T>, opts?: RequestOptions) {
    const qs = stringifyQuery(qm);
    return get<T[]>(`${this.basePath}${qs}`, opts);
  }

  removeOneById(id: ID, opts?: RequestOptions) {
    return remove<ID>(`${this.basePath}/${id}`, opts);
  }

  remove(filter: QueryFilter<T>, opts?: RequestOptions) {
    const qs = stringifyQueryParameter('filter', filter);
    return remove<number>(`${this.basePath}${qs}`, opts);
  }

  count(filter: QueryFilter<T>, opts?: RequestOptions) {
    const qs = stringifyQueryParameter('filter', filter);
    return get<number>(`${this.basePath}/count${qs}`, opts);
  }
}
