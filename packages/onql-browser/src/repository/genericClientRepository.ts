import { stringifyQuery, stringifyQueryParameter } from 'onql/util/query.util';
import { formatKebabCase } from 'onql/util/string.util';
import { getEntityMeta, EntityMeta } from 'onql/entity';
import {
  RequestOptions,
  RequestSuccessResponse,
  Query,
  QueryFilter,
  QueryOneFilter,
  QueryOne,
  ClientRepository,
} from '../type';
import { get, post, put, remove } from '../http';

export class GenericClientRepository<T, ID> implements ClientRepository<T, ID> {
  readonly meta: EntityMeta<T>;

  /**
   * The base-path for the endpoints. Children could override it if necessary.
   * For instance, when endpoints are not under path '/api/', or when it is
   * something like '/api/v1/'. It can also be dynamically calculated if necessary
   * (by using a getter called 'basePath')
   */
  protected readonly basePath: string;

  constructor(type: { new (): T }) {
    this.meta = getEntityMeta(type);
    this.basePath = '/api/' + formatKebabCase(this.meta.name);
  }

  insertOne(body: T, opts?: RequestOptions): Promise<RequestSuccessResponse<ID>> {
    return post<ID>(this.basePath, body, opts);
  }

  updateOneById(id: ID, body: T, opts?: RequestOptions): Promise<RequestSuccessResponse<void>> {
    return put<void>(`${this.basePath}/${id}`, body, opts);
  }

  saveOne(body: T, opts?: RequestOptions): Promise<RequestSuccessResponse<ID>> {
    const id = body[this.meta.id.property] as ID;
    if (id) {
      return this.updateOneById(id, body, opts).then((res) => {
        return { data: id };
      });
    }
    return this.insertOne(body, opts);
  }

  findOneById(id: ID, qm: QueryOne<T>, opts?: RequestOptions): Promise<RequestSuccessResponse<T>> {
    const qs = stringifyQuery(qm);
    return get<T>(`${this.basePath}/${id}${qs}`, opts);
  }

  findOne(qm: QueryOneFilter<T>, opts?: RequestOptions): Promise<RequestSuccessResponse<T>> {
    const qs = stringifyQuery(qm);
    return get<T>(`${this.basePath}/one${qs}`, opts);
  }

  find(qm: Query<T>, opts?: RequestOptions): Promise<RequestSuccessResponse<T[]>> {
    const qs = stringifyQuery(qm);
    return get<T[]>(`${this.basePath}${qs}`, opts);
  }

  removeOneById(id: ID, opts?: RequestOptions): Promise<RequestSuccessResponse<void>> {
    return remove<void>(`${this.basePath}/${id}`, opts);
  }

  remove(filter: QueryFilter<T>, opts?: RequestOptions): Promise<RequestSuccessResponse<number>> {
    const qs = stringifyQueryParameter('filter', filter);
    return remove<number>(`${this.basePath}${qs}`, opts);
  }

  count(filter: QueryFilter<T>, opts?: RequestOptions): Promise<RequestSuccessResponse<number>> {
    const qs = stringifyQueryParameter('filter', filter);
    return get<number>(`${this.basePath}/count${qs}`, opts);
  }
}
