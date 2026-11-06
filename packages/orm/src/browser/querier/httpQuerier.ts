import { getMeta } from '../../entity/metadata/definition.js';
import { CRUD_ROUTES, entityPath, type HttpMethod, type WireAnswer } from '../../http/contract.js';
import { stringifyQuery } from '../../http/query.js';
import { readWireData } from '../../http/wireRow.js';
import type { EntityId, SharedQuerier, AbstractType } from '../../type/index.js';
import { isScalarId } from '../../util/object.util.js';
import { UqlUsageError } from '../../util/uqlError.js';
import { get, query as httpQuery, patch, post, put, remove } from '../http/index.js';
import type { ClientQuerier, RequestFindOptions, RequestOptions } from '../type/index.js';

export type HttpQuerierDefaults = {
  /**
   * headers sent with every request from this instance, merged under per-call headers.
   * Create one instance per request (e.g. during SSR) to scope auth headers safely.
   */
  readonly headers?: Record<string, string>;
  /**
   * transport for read queries (findOne, findMany, findManyPage, count). 'QUERY' (RFC 10008) sends the
   * JSON query in the request body, avoiding URL-length limits for large queries; requires
   * infrastructure (proxies, CDNs) that forwards the QUERY method. Defaults to 'GET'.
   */
  readonly readMethod?: Extract<HttpMethod, 'GET' | 'QUERY'>;
  /**
   * The URL segment an entity is addressed by, defaulting to its kebab-cased class name - the same
   * option the server handler takes, so one map serves both. State it where the default cannot: a
   * build that minifies class names renames every route.
   */
  readonly entityPath?: (entity: AbstractType<unknown>) => string;
};

/** A response with its `data` as the entity holds it, by what its route answers: JSON carried dates and keys as text. */
function dataOf<E, R extends { readonly data: unknown }>(entity: AbstractType<E>, response: R, answers: WireAnswer): R {
  return { ...response, data: readWireData(getMeta(entity), response.data, answers) };
}

/** The id as one path segment, refusing a composite key, which has no spelling in `/:id` yet. Callers are `async`. */
function idSegment<E>(entity: AbstractType<E>, id: EntityId<E>): string {
  if (!isScalarId(id)) {
    throw new UqlUsageError(`'${entity.name}' was addressed by an id object, which the HTTP route cannot carry.`);
  }
  return String(id);
}

export class HttpQuerier implements ClientQuerier {
  constructor(
    readonly basePath: string,
    readonly defaults: HttpQuerierDefaults = {},
  ) {}

  // Typed properties instead of methods, so each takes its signature from `ClientQuerier` rather than repeating it.
  readonly findOneById: ClientQuerier['findOneById'] = async (entity, id, q, opts) =>
    dataOf(
      entity,
      await get(`${this.getBasePath(entity)}/${idSegment(entity, id)}${stringifyQuery(q)}`, this.buildOptions(opts)),
      CRUD_ROUTES.findOneById.answers,
    );

  readonly findOne: ClientQuerier['findOne'] = async (entity, q, opts) =>
    dataOf(
      entity,
      await this.read(`${this.getBasePath(entity)}${CRUD_ROUTES.findOne.path}`, q, opts),
      CRUD_ROUTES.findOne.answers,
    );

  readonly findMany: SharedQuerier<'client', RequestFindOptions>['findMany'] = async (entity, q, opts) =>
    dataOf(
      entity,
      await this.read(this.getBasePath(entity), opts?.count ? { ...q, count: true } : q, opts),
      CRUD_ROUTES.findMany.answers,
    );

  readonly findManyAndCount: SharedQuerier<'client', RequestFindOptions>['findManyAndCount'] = async (
    entity,
    q,
    opts,
  ) => {
    const response = await this.findMany(entity, q, { ...opts, count: true });
    if (typeof response.count !== 'number') {
      throw new TypeError('findManyAndCount response has an invalid count');
    }
    return { ...response, count: response.count };
  };

  readonly findManyPage: ClientQuerier['findManyPage'] = async (entity, q, opts) =>
    dataOf(
      entity,
      await this.read(`${this.getBasePath(entity)}${CRUD_ROUTES.findManyPage.path}`, q, opts),
      CRUD_ROUTES.findManyPage.answers,
    );

  readonly count: ClientQuerier['count'] = (entity, q, opts) =>
    this.read(`${this.getBasePath(entity)}${CRUD_ROUTES.count.path}`, q, opts);

  /** The `count` route capped at one row, so existence needs no endpoint of its own. */
  readonly exists: ClientQuerier['exists'] = async (entity, q, opts) => {
    const res = await this.count(entity, { ...q, $limit: 1 }, opts);
    return { ...res, data: res.data > 0 };
  };

  readonly insertOne: ClientQuerier['insertOne'] = async (entity, payload, opts) =>
    dataOf(
      entity,
      await post(this.getBasePath(entity), payload, this.buildOptions(opts)),
      CRUD_ROUTES.insertOne.answers,
    );

  readonly insertMany: ClientQuerier['insertMany'] = async (entity, payload, opts) =>
    dataOf(
      entity,
      await post(`${this.getBasePath(entity)}${CRUD_ROUTES.insertMany.path}`, payload, this.buildOptions(opts)),
      CRUD_ROUTES.insertMany.answers,
    );

  readonly updateOneById: ClientQuerier['updateOneById'] = async (entity, id, payload, opts) =>
    patch(`${this.getBasePath(entity)}/${idSegment(entity, id)}`, payload, this.buildOptions(opts));

  readonly updateMany: ClientQuerier['updateMany'] = (entity, q, payload, opts) =>
    patch(`${this.getBasePath(entity)}${stringifyQuery(q)}`, payload, this.buildOptions(opts));

  readonly saveOne: ClientQuerier['saveOne'] = async (entity, payload, opts) =>
    dataOf(entity, await put(this.getBasePath(entity), payload, this.buildOptions(opts)), CRUD_ROUTES.saveOne.answers);

  readonly saveMany: ClientQuerier['saveMany'] = async (entity, payload, opts) =>
    dataOf(
      entity,
      await put(`${this.getBasePath(entity)}${CRUD_ROUTES.saveMany.path}`, payload, this.buildOptions(opts)),
      CRUD_ROUTES.saveMany.answers,
    );

  readonly deleteOneById: ClientQuerier['deleteOneById'] = async (entity, id, opts = {}) => {
    const qs = opts.hardDelete ? stringifyQuery({ hardDelete: opts.hardDelete }) : '';
    return remove(`${this.getBasePath(entity)}/${idSegment(entity, id)}${qs}`, this.buildOptions(opts));
  };

  readonly deleteMany: ClientQuerier['deleteMany'] = (entity, q, opts = {}) =>
    remove(
      `${this.getBasePath(entity)}${stringifyQuery(opts.hardDelete ? { ...q, hardDelete: opts.hardDelete } : q)}`,
      this.buildOptions(opts),
    );

  getBasePath<E>(entity: AbstractType<E>) {
    return `${this.basePath}/${(this.defaults.entityPath ?? entityPath)(entity)}`;
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
