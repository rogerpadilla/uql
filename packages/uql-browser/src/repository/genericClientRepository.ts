import { getEntityMeta } from 'uql/decorator';
import { Query, QueryFilter, QueryOne, EntityMeta } from 'uql/type';
import { formatKebabCase } from 'uql/util';
import { get, post, put, remove } from '../http';
import { RequestOptions, ClientRepository, RequestFindOptions } from '../type';
import { stringifyQuery, stringifyQueryParameter } from './query.util';

export class GenericClientRepository<T, ID = any> implements ClientRepository<T, ID> {
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

  insertOne(body: T, opts?: RequestOptions) {
    return post<ID>(this.basePath, body, opts);
  }

  updateOneById(id: ID, body: T, opts?: RequestOptions) {
    return put<number>(`${this.basePath}/${id}`, body, opts);
  }

  saveOne(body: T, opts?: RequestOptions) {
    const id = body[this.meta.id.property] as ID;
    if (id) {
      return this.updateOneById(id, body, opts).then((res) => {
        return { data: id };
      });
    }
    return this.insertOne(body, opts);
  }

  findOne(qm: Query<T>, opts?: RequestOptions) {
    const qs = stringifyQuery(qm);
    return get<T>(`${this.basePath}/one${qs}`, opts);
  }

  findOneById(id: ID, qm: QueryOne<T>, opts?: RequestOptions) {
    const qs = stringifyQuery(qm);
    return get<T>(`${this.basePath}/${id}${qs}`, opts);
  }

  find(qm: Query<T>, opts: RequestFindOptions = {}) {
    const data: typeof qm & Pick<typeof opts, 'count'> = { ...qm };
    if (opts.count) {
      data.count = true;
    }
    const qs = stringifyQuery(data);
    return get<T[]>(`${this.basePath}${qs}`, opts);
  }

  remove(filter: QueryFilter<T>, opts?: RequestOptions) {
    const qs = stringifyQueryParameter('filter', filter);
    return remove<number>(`${this.basePath}${qs}`, opts);
  }

  removeOneById(id: ID, opts?: RequestOptions) {
    return remove<number>(`${this.basePath}/${id}`, opts);
  }

  count(filter: QueryFilter<T>, opts?: RequestOptions) {
    const qs = stringifyQueryParameter('filter', filter);
    return get<number>(`${this.basePath}/count${qs}`, opts);
  }
}
