import { CRUD_ROUTES, entityPath, type HttpMethod } from '../../http/contract.js';
import { stringifyQuery } from '../../http/query.js';
import type {
  EntityData,
  EntityId,
  FieldKey,
  IdValue,
  Query,
  QueryFilter,
  QueryFindResult,
  QueryOneProjected,
  QueryOptions,
  QueryPage,
  QueryProjected,
  QuerySearch,
  RelationKey,
  RequestCountedSuccessResponse,
  RequestSuccessResponse,
  Type,
  UpdatePayload,
} from '../../type/index.js';
import { isScalarId } from '../../util/object.util.js';
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

/**
 * The id as one path segment.
 *
 * A composite key has no spelling here yet - the route is `/:id`, and how several columns share one
 * segment is a serialization to invent rather than copy. Refused rather than interpolated, which
 * would have sent `[object Object]` for the server to reject. Its callers are `async` so this
 * surfaces as a rejection, like every other failure they can hand back.
 */
function idSegment<E>(entity: Type<E>, id: EntityId<E>): string {
  if (!isScalarId(id)) {
    throw new TypeError(`'${entity.name}' was addressed by an id object, which the HTTP route cannot carry.`);
  }
  return String(id);
}

export class HttpQuerier implements ClientQuerier {
  constructor(
    readonly basePath: string,
    readonly defaults: HttpQuerierDefaults = {},
  ) {}

  async findOneById<
    E extends object,
    const S extends FieldKey<E> = never,
    const V = true,
    const X extends FieldKey<E> = never,
    const P extends RelationKey<E> = never,
    const C extends RelationKey<E> = never,
  >(
    entity: Type<E>,
    id: EntityId<E>,
    q?: QueryOneProjected<E, S, V, X, P, C>,
    opts?: RequestOptions,
  ): Promise<RequestSuccessResponse<QueryFindResult<E, S, V, X, P, C> | undefined>> {
    const basePath = this.getBasePath(entity);
    const qs = stringifyQuery(q);
    return get<QueryFindResult<E, S, V, X, P, C> | undefined>(
      `${basePath}/${idSegment(entity, id)}${qs}`,
      this.buildOptions(opts),
    );
  }

  findOne<
    E extends object,
    const S extends FieldKey<E> = never,
    const V = true,
    const X extends FieldKey<E> = never,
    const P extends RelationKey<E> = never,
    const C extends RelationKey<E> = never,
  >(
    entity: Type<E>,
    q: QueryOneProjected<E, S, V, X, P, C>,
    opts?: RequestOptions,
  ): Promise<RequestSuccessResponse<QueryFindResult<E, S, V, X, P, C> | undefined>> {
    return this.read<QueryFindResult<E, S, V, X, P, C> | undefined>(
      `${this.getBasePath(entity)}${CRUD_ROUTES.findOne.path}`,
      q,
      opts,
    );
  }

  findMany<
    E extends object,
    const S extends FieldKey<E> = never,
    const V = true,
    const X extends FieldKey<E> = never,
    const P extends RelationKey<E> = never,
    const C extends RelationKey<E> = never,
  >(
    entity: Type<E>,
    q: QueryProjected<E, S, V, X, P, C>,
    opts?: RequestFindOptions,
  ): Promise<RequestSuccessResponse<QueryFindResult<E, S, V, X, P, C>[]>> {
    const data: Query<E> & { count?: boolean } = { ...q };
    if (opts?.count) {
      data.count = true;
    }
    return this.read<QueryFindResult<E, S, V, X, P, C>[]>(this.getBasePath(entity), data, opts);
  }

  async findManyAndCount<
    E extends object,
    const S extends FieldKey<E> = never,
    const V = true,
    const X extends FieldKey<E> = never,
    const P extends RelationKey<E> = never,
    const C extends RelationKey<E> = never,
  >(
    entity: Type<E>,
    q: QueryProjected<E, S, V, X, P, C>,
    opts?: RequestFindOptions,
  ): Promise<RequestCountedSuccessResponse<QueryFindResult<E, S, V, X, P, C>[]>> {
    const response = await this.findMany(entity, q, { ...opts, count: true });
    if (typeof response.count !== 'number') {
      throw new TypeError('findManyAndCount response has an invalid count');
    }
    return { ...response, count: response.count };
  }

  count<E extends object>(entity: Type<E>, q?: QueryPage<E>, opts?: RequestOptions) {
    return this.read<number>(`${this.getBasePath(entity)}${CRUD_ROUTES.count.path}`, q, opts);
  }

  /** The `count` route capped at one row, so existence needs no endpoint of its own. */
  async exists<E extends object>(entity: Type<E>, q?: QueryFilter<E>, opts?: RequestOptions) {
    const res = await this.count(entity, { ...q, $limit: 1 }, opts);
    return { ...res, data: res.data > 0 };
  }

  insertOne<E extends object>(entity: Type<E>, payload: EntityData<E>, opts?: RequestOptions) {
    const basePath = this.getBasePath(entity);
    return post<IdValue<E> | undefined>(basePath, payload, this.buildOptions(opts));
  }

  insertMany<E extends object>(entity: Type<E>, payload: EntityData<E>[], opts?: RequestOptions) {
    const basePath = this.getBasePath(entity);
    return post<IdValue<E>[]>(`${basePath}${CRUD_ROUTES.insertMany.path}`, payload, this.buildOptions(opts));
  }

  async updateOneById<E extends object>(
    entity: Type<E>,
    id: EntityId<E>,
    payload: UpdatePayload<E>,
    opts?: RequestOptions,
  ) {
    const basePath = this.getBasePath(entity);
    return patch<number>(`${basePath}/${idSegment(entity, id)}`, payload, this.buildOptions(opts));
  }

  updateMany<E extends object>(entity: Type<E>, q: QuerySearch<E>, payload: UpdatePayload<E>, opts?: RequestOptions) {
    const basePath = this.getBasePath(entity);
    const qs = stringifyQuery(q);
    return patch<number>(`${basePath}${qs}`, payload, this.buildOptions(opts));
  }

  saveOne<E extends object>(entity: Type<E>, payload: EntityData<E>, opts?: RequestOptions) {
    const basePath = this.getBasePath(entity);
    return put<IdValue<E>>(basePath, payload, this.buildOptions(opts));
  }

  saveMany<E extends object>(entity: Type<E>, payload: EntityData<E>[], opts?: RequestOptions) {
    const basePath = this.getBasePath(entity);
    return put<IdValue<E>[]>(`${basePath}${CRUD_ROUTES.saveMany.path}`, payload, this.buildOptions(opts));
  }

  async deleteOneById<E extends object>(entity: Type<E>, id: EntityId<E>, opts: QueryOptions & RequestOptions = {}) {
    const basePath = this.getBasePath(entity);
    const qs = opts.hardDelete ? stringifyQuery({ hardDelete: opts.hardDelete }) : '';
    return remove<number>(`${basePath}/${idSegment(entity, id)}${qs}`, this.buildOptions(opts));
  }

  deleteMany<E extends object>(entity: Type<E>, q: QuerySearch<E>, opts: QueryOptions & RequestOptions = {}) {
    const basePath = this.getBasePath(entity);
    const qs = stringifyQuery(opts.hardDelete ? { ...q, hardDelete: opts.hardDelete } : q);
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

  protected buildOptions(opts?: RequestOptions): RequestOptions | undefined {
    if (!this.defaults.headers && !opts?.headers) {
      return opts;
    }
    return { ...opts, headers: { ...this.defaults.headers, ...opts?.headers } };
  }
}
