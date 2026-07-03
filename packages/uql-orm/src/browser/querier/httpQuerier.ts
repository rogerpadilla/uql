import { CRUD_ROUTES, entityPath, type HttpMethod, type RequestSuccessResponse } from '../../http/contract.js';
import { stringifyQuery } from '../../http/query.js';
import type { IdValue, Query, QueryOne, QueryOptions, QuerySearch, Type, UpdatePayload } from '../../type/index.js';
import { get, query as httpQuery, patch, post, put, remove } from '../http/index.js';
import type { ClientQuerier, RequestFindOptions, RequestOptions } from '../type/index.js';

export type HttpQuerierDefaults = {
  /**
   * headers sent with every request from this instance, merged under per-call headers.
   * Create one instance per request (e.g. during SSR) to scope auth headers safely.
   */
  readonly headers?: Record<string, string>;
  /**
   * transport for read queries (findOne, findMany, count). 'QUERY' (RFC 10008) sends the
   * JSON query in the request body, avoiding URL-length limits for large queries; requires
   * infrastructure (proxies, CDNs) that forwards the QUERY method. Defaults to 'GET'.
   */
  readonly readMethod?: Extract<HttpMethod, 'GET' | 'QUERY'>;
};

export class HttpQuerier implements ClientQuerier {
  constructor(
    readonly basePath: string,
    readonly defaults: HttpQuerierDefaults = {},
  ) {}

  findOneById<E>(
    entity: Type<E>,
    id: IdValue<E>,
    q?: QueryOne<E>,
    opts?: RequestOptions,
  ): Promise<RequestSuccessResponse<E | undefined>> {
    const basePath = this.getBasePath(entity);
    const qs = stringifyQuery(q);
    return get<E | undefined>(`${basePath}/${id}${qs}`, this.buildOptions(opts));
  }

  findOne<E>(entity: Type<E>, q: QueryOne<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<E | undefined>> {
    return this.read<E | undefined>(`${this.getBasePath(entity)}${CRUD_ROUTES.findOne.path}`, q, opts);
  }

  findMany<E>(entity: Type<E>, q: Query<E>, opts?: RequestFindOptions) {
    const data: Query<E> & { count?: boolean } = { ...q };
    if (opts?.count) {
      data.count = true;
    }
    return this.read<E[]>(this.getBasePath(entity), data, opts);
  }

  findManyAndCount<E>(entity: Type<E>, q: Query<E>, opts?: RequestFindOptions) {
    return this.findMany(entity, q, { ...opts, count: true });
  }

  count<E>(entity: Type<E>, q: QuerySearch<E>, opts?: RequestOptions) {
    return this.read<number>(`${this.getBasePath(entity)}${CRUD_ROUTES.count.path}`, q, opts);
  }

  insertOne<E>(entity: Type<E>, payload: E, opts?: RequestOptions) {
    const basePath = this.getBasePath(entity);
    return post<IdValue<E>>(basePath, payload, this.buildOptions(opts));
  }

  insertMany<E>(entity: Type<E>, payload: E[], opts?: RequestOptions) {
    const basePath = this.getBasePath(entity);
    return post<IdValue<E>[]>(`${basePath}${CRUD_ROUTES.insertMany.path}`, payload, this.buildOptions(opts));
  }

  updateOneById<E>(entity: Type<E>, id: IdValue<E>, payload: UpdatePayload<E>, opts?: RequestOptions) {
    const basePath = this.getBasePath(entity);
    return patch<number>(`${basePath}/${id}`, payload, this.buildOptions(opts));
  }

  updateMany<E>(entity: Type<E>, q: QuerySearch<E>, payload: UpdatePayload<E>, opts?: RequestOptions) {
    const basePath = this.getBasePath(entity);
    const qs = stringifyQuery(q);
    return patch<number>(`${basePath}${qs}`, payload, this.buildOptions(opts));
  }

  saveOne<E>(entity: Type<E>, payload: E, opts?: RequestOptions) {
    const basePath = this.getBasePath(entity);
    return put<IdValue<E>>(basePath, payload, this.buildOptions(opts));
  }

  saveMany<E>(entity: Type<E>, payload: E[], opts?: RequestOptions) {
    const basePath = this.getBasePath(entity);
    return put<IdValue<E>[]>(`${basePath}${CRUD_ROUTES.saveMany.path}`, payload, this.buildOptions(opts));
  }

  deleteOneById<E>(entity: Type<E>, id: IdValue<E>, opts: QueryOptions & RequestOptions = {}) {
    const basePath = this.getBasePath(entity);
    const qs = opts.softDelete ? stringifyQuery({ softDelete: opts.softDelete }) : '';
    return remove<number>(`${basePath}/${id}${qs}`, this.buildOptions(opts));
  }

  deleteMany<E>(entity: Type<E>, q: QuerySearch<E>, opts: QueryOptions & RequestOptions = {}) {
    const basePath = this.getBasePath(entity);
    const qs = stringifyQuery(opts.softDelete ? { ...q, softDelete: opts.softDelete } : q);
    return remove<number>(`${basePath}${qs}`, this.buildOptions(opts));
  }

  getBasePath<E>(entity: Type<E>) {
    return `${this.basePath}/${entityPath(entity)}`;
  }

  protected read<T>(path: string, q: Record<string, unknown> | undefined, opts?: RequestOptions) {
    if (this.defaults.readMethod === 'QUERY') {
      return httpQuery<T>(path, q ?? {}, this.buildOptions(opts));
    }
    return get<T>(`${path}${stringifyQuery(q)}`, this.buildOptions(opts));
  }

  protected buildOptions<O extends RequestOptions>(opts?: O): O | undefined {
    if (!this.defaults.headers && !opts?.headers) {
      return opts;
    }
    return { ...(opts as O), headers: { ...this.defaults.headers, ...opts?.headers } };
  }
}
