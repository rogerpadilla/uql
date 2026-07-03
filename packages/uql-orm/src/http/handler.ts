import { getEntities, getMeta } from '../entity/index.js';
import { getQuerier } from '../options.js';
import type { EntityMeta, IdValue, Querier, Query, QuerySearch, Type, UpdatePayload } from '../type/index.js';
import {
  type CrudOperation,
  entityPath,
  type HttpMethod,
  matchRoute,
  type RequestSuccessResponse,
  type RouteMatch,
} from './contract.js';
import { parseQueryParams } from './query.js';

/**
 * Framework-normalized request: adapters (express, fetch, ...) reduce their native
 * request to this shape and get back a status + JSON body.
 */
export type HandlerRequest<Ctx = unknown> = {
  readonly method: string;
  readonly entityPath: string;
  readonly subPath?: string;
  /**
   * raw query-string entries; JSON values may still be stringified.
   */
  readonly query?: Record<string, unknown>;
  /**
   * parsed JSON body.
   */
  readonly body?: unknown;
  /**
   * adapter-supplied request context (express `req`, fetch `Request`, ...), passed through to hooks.
   */
  readonly context: Ctx;
};

export type HandlerResponse = {
  readonly status: number;
  readonly body: unknown;
};

/**
 * Wire flags ride inside the query object (as strings on GET, booleans on QUERY),
 * so hooks can enforce them, e.g. force `softDelete: true` in `preFilter`.
 */
type WireFlags = {
  readonly softDelete?: unknown;
  readonly count?: unknown;
};

export type HookContext<E extends object, Ctx = unknown> = {
  readonly meta: EntityMeta<E>;
  readonly op: CrudOperation;
  readonly method: HttpMethod;
  /**
   * parsed query — mutate in place or reassign to enforce filters (tenant scoping, row-level rules).
   */
  query: Query<E>;
  /**
   * request payload — reassignable for sanitization or field injection.
   */
  body?: unknown;
  /**
   * adapter-supplied request context — the auth/tenant source (e.g. `req.user`).
   */
  readonly context: Ctx;
};

export type Hook<Ctx = unknown> = <E extends object>(ctx: HookContext<E, Ctx>) => void | Promise<void>;

export type ResponseHook<Ctx = unknown> = <E extends object>(
  ctx: HookContext<E, Ctx>,
  envelope: RequestSuccessResponse<unknown>,
) => void | Promise<void>;

export type RequestHandlerOptions<Ctx = unknown> = {
  // biome-ignore lint/suspicious/noExplicitAny: accepts any entity constructor
  include?: Type<any>[];
  // biome-ignore lint/suspicious/noExplicitAny: accepts any entity constructor
  exclude?: Type<any>[];
  /**
   * Allow augment any kind of request before it runs. Hooks may be async
   * and abort the request by throwing (a numeric `status` on the error is honored).
   */
  pre?: Hook<Ctx>;
  /**
   * Allow augment a save request (POST | PUT | PATCH) before it runs.
   */
  preSave?: Hook<Ctx>;
  /**
   * Allow augment a filter request (GET | DELETE) before it runs.
   */
  preFilter?: Hook<Ctx>;
  /**
   * Shape the successful response before it is sent: strip sensitive fields,
   * derive presentation fields, or coerce null data. Mutate `envelope.data` in place
   * or reassign it. Runs after the operation (and after commit for writes).
   */
  post?: ResponseHook<Ctx>;
};

/**
 * Returns `undefined` synchronously for an unknown entity or route so adapters can fall through
 * (e.g. express `next()`); rejects with the original error on failure so adapters map it
 * (e.g. `toErrorResponse`).
 */
export type RequestHandler<Ctx = unknown> = (req: HandlerRequest<Ctx>) => Promise<HandlerResponse> | undefined;

export function createRequestHandler<Ctx = unknown>(opts: RequestHandlerOptions<Ctx> = {}): RequestHandler<Ctx> {
  const { include, exclude, pre, preSave, preFilter, post } = opts;

  let entities = include ?? getEntities();
  if (exclude) {
    entities = entities.filter((entity) => !exclude.includes(entity));
  }
  if (!entities.length) {
    throw new TypeError('no entities for the uql middleware');
  }

  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous entity map
  const entityByPath = new Map<string, Type<any>>(entities.map((entity) => [entityPath(entity), entity]));

  return (req) => {
    const entity = entityByPath.get(req.entityPath);
    if (!entity) {
      return undefined;
    }
    const match = matchRoute(req.method, req.subPath);
    if (!match) {
      return undefined;
    }
    return run(entity, match, req);
  };

  async function run<E extends object>(
    entity: Type<E>,
    { op, method, id }: RouteMatch,
    req: HandlerRequest<Ctx>,
  ): Promise<HandlerResponse> {
    const meta = getMeta(entity);
    // QUERY (RFC 10008) carries the JSON query in the body instead of the query string
    const rawQuery = method === 'QUERY' ? (req.body as Record<string, unknown> | undefined) : req.query;

    const hookCtx: HookContext<E, Ctx> = {
      meta,
      op,
      method,
      query: parseQueryParams(rawQuery) as Query<E>,
      body: req.body,
      context: req.context,
    };
    await pre?.(hookCtx);
    if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
      await preSave?.(hookCtx);
    } else {
      await preFilter?.(hookCtx);
    }

    const resp = await dispatch();
    if (post) {
      await post(hookCtx, resp.body as RequestSuccessResponse<unknown>);
    }
    return resp;

    function dispatch(): Promise<HandlerResponse> {
      // read post-hooks so both in-place mutation and reassignment of hookCtx.query apply
      const query = hookCtx.query;
      const flags = query as WireFlags;
      const softDelete = flags.softDelete === 'true' || flags.softDelete === true;
      switch (op) {
        case 'findOne':
          return withQuerier(async (querier) => {
            const data = await querier.findOne(entity, query);
            return ok({ data, count: data ? 1 : 0 });
          });
        case 'count':
          return withQuerier(async (querier) => {
            const count = await querier.count(entity, query);
            return ok({ data: count, count });
          });
        case 'findOneById':
          return withQuerier(async (querier) => {
            const data = await querier.findOne(entity, buildIdQuery(meta, id, query));
            return ok({ data, count: data ? 1 : 0 });
          });
        case 'findMany':
          return withQuerier(async (querier) => {
            const findManyPromise = querier.findMany(entity, query);
            const countPromise = flags.count ? querier.count(entity, query) : undefined;
            const [data, count] = await Promise.all([findManyPromise, countPromise]);
            return ok({ data, count });
          });
        case 'insertOne':
          return withTransaction(async (querier) => {
            const data = await querier.insertOne(entity, hookCtx.body as E);
            return ok({ data, count: 1 });
          });
        case 'insertMany':
          return withTransaction(async (querier) => {
            const data = await querier.insertMany(entity, hookCtx.body as E[]);
            return ok({ data, count: data.length });
          });
        case 'saveOne':
          return withTransaction(async (querier) => {
            const data = await querier.saveOne(entity, hookCtx.body as E);
            return ok({ data, count: 1 });
          });
        case 'saveMany':
          return withTransaction(async (querier) => {
            const data = await querier.saveMany(entity, hookCtx.body as E[]);
            return ok({ data, count: data.length });
          });
        case 'updateOneById':
          return withTransaction(async (querier) => {
            const count = await querier.updateMany(
              entity,
              buildIdQuery(meta, id, query),
              hookCtx.body as UpdatePayload<E>,
            );
            return ok({ data: id, count });
          });
        case 'updateMany':
          return withTransaction(async (querier) => {
            const count = await querier.updateMany(entity, query as QuerySearch<E>, hookCtx.body as UpdatePayload<E>);
            return ok({ data: count, count });
          });
        case 'deleteOneById':
          return withTransaction(async (querier) => {
            const count = await querier.deleteMany(entity, buildIdQuery(meta, id, query), { softDelete });
            return ok({ data: id, count });
          });
        case 'deleteMany':
          return withTransaction(async (querier) => {
            const founds = await querier.findMany(entity, query);
            let ids: IdValue<E>[] = [];
            let count = 0;
            if (founds.length && meta.id) {
              const idKey = meta.id;
              ids = founds.map((found) => found[idKey]);
              count = await querier.deleteMany(entity, { $where: ids }, { softDelete });
            }
            return ok({ data: ids, count });
          });
      }
    }
  }
}

function ok(body: unknown): HandlerResponse {
  return { status: 200, body };
}

async function withQuerier(fn: (querier: Querier) => Promise<HandlerResponse>): Promise<HandlerResponse> {
  const querier = await getQuerier();
  try {
    return await fn(querier);
  } finally {
    await querier.release();
  }
}

async function withTransaction(fn: (querier: Querier) => Promise<HandlerResponse>): Promise<HandlerResponse> {
  const querier = await getQuerier();
  try {
    await querier.beginTransaction();
    const resp = await fn(querier);
    await querier.commitTransaction();
    return resp;
  } catch (err) {
    await querier.rollbackTransaction().catch(() => {});
    throw err;
  } finally {
    await querier.release();
  }
}

function buildIdQuery<E extends object>(meta: EntityMeta<E>, id: string | undefined, query: Query<E>): Query<E> {
  const idKey = meta.id as string;
  const where = query.$where;
  if (Array.isArray(where)) {
    query.$where = { $and: [{ [idKey]: { $in: where } }, { [idKey]: id }] } as Query<E>['$where'];
  } else if (typeof where === 'object' && where !== null) {
    query.$where = { ...where, [idKey]: id } as Query<E>['$where'];
  } else {
    query.$where = { [idKey]: id } as Query<E>['$where'];
  }
  return query;
}
