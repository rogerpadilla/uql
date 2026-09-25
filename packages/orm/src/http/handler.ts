import { withContext } from '../context/context.js';
import { getEntities, getMeta, soleIdOf } from '../entity/index.js';
import type {
  EntityMeta,
  IdValue,
  Querier,
  QuerierPool,
  Query,
  RelationMeta,
  RequestSuccessResponse,
  Type,
  UpdateWrite,
  UqlContext,
} from '../type/index.js';
import { whereIds, whereWith } from '../util/dialect.util.js';
import { UqlUsageError } from '../util/uqlError.js';
import {
  CRUD_ROUTES,
  type CrudOperation,
  entityPath,
  type HttpMethod,
  matchRoute,
  type RouteMatch,
} from './contract.js';
import { parseQueryParams, type WireFlags } from './query.js';

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

export type HookContext<E extends object, Ctx = unknown> = {
  readonly meta: EntityMeta<E>;
  readonly op: CrudOperation;
  readonly method: HttpMethod;
  /** The parsed query, to reshape in place. Scope rows with a `security` filter instead, which a client cannot override. */
  query: Query<E> & WireFlags;
  /**
   * request payload - reassignable for sanitization or field injection.
   */
  body?: unknown;
  /**
   * adapter-supplied request context - the auth/tenant source (e.g. `req.user`).
   */
  readonly context: Ctx;
};

export type Hook<Ctx = unknown> = <E extends object>(ctx: HookContext<E, Ctx>) => void | Promise<void>;

export type ResponseHook<Ctx = unknown> = <E extends object>(
  ctx: HookContext<E, Ctx>,
  envelope: RequestSuccessResponse<unknown>,
) => void | Promise<void>;

export type RequestHandlerOptions<Ctx = unknown> = {
  include?: Type<object>[];
  exclude?: Type<object>[];
  /** The URL segment an entity is addressed by, its kebab-cased class name by default; the browser client takes the same option. */
  entityPath?: (entity: Type<unknown>) => string;
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
  /**
   * Derive the ambient {@link UqlContext} (e.g. `{ tenantId, userId }`) from the adapter request.
   * The whole request runs inside `withContext`, so parameterized/`security` filters are scoped
   * automatically. Derive tenant/auth from a verified source (session, JWT) - never trust the client.
   */
  getContext?: (context: Ctx) => UqlContext | undefined | Promise<UqlContext | undefined>;
  /**
   * The pool this handler runs on. A function is called per request, after `getContext`, with the
   * adapter's request and the context that resolved from it - which is what lets one deployment
   * serve a database per tenant, where a process-wide default could only serve one.
   */
  pool: QuerierPool | ((context: Ctx, appContext: UqlContext) => QuerierPool | Promise<QuerierPool>);
};

/**
 * Returns `undefined` synchronously for an unknown entity or route so adapters can fall through
 * (e.g. express `next()`); rejects with the original error on failure so adapters map it
 * (e.g. `toErrorResponse`).
 */
export type RequestHandler<Ctx = unknown> = (req: HandlerRequest<Ctx>) => Promise<HandlerResponse> | undefined;

/** `Company (crm.Company)`: the class, and the table it maps, which is what tells two apart. */
function tableOf(entity: Type<object>): string {
  const meta = getMeta(entity);
  return `${entity.name} (${meta.schema ? `${meta.schema}.${meta.name}` : meta.name})`;
}

export function createRequestHandler<Ctx = unknown>(opts: RequestHandlerOptions<Ctx>): RequestHandler<Ctx> {
  const { include, exclude, pre, preSave, preFilter, post, getContext, pool } = opts;
  const pathOf = opts.entityPath ?? entityPath;

  let entities = include ?? getEntities();
  if (exclude) {
    entities = entities.filter((entity) => !exclude.includes(entity));
  }
  if (!entities.length) {
    throw new UqlUsageError('no entities for the uql middleware');
  }

  // All of them at once, so fixing the first collision does not just reveal the next.
  const byPath = Map.groupBy(entities, pathOf);
  const collisions = [...byPath].filter(([, clashing]) => clashing.length > 1);
  if (collisions.length) {
    const lines = collisions.map(([path, clashing]) => `  /${path} <- ${clashing.map(tableOf).join(', ')}`);
    throw new UqlUsageError(
      `every entity below shares a route with another, so all but the first are unreachable:\n${lines.join('\n')}\n` +
        "A route is the kebab-cased class name unless 'entityPath' says otherwise. Name them apart, " +
        "pass an 'entityPath', or pass only one of them in 'include'.",
    );
  }
  const entityByPath = new Map<string, Type<object>>([...byPath].map(([path, [entity]]) => [path, entity]));
  const served = new Set(entities);

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
    const query = parseQueryParams<E>(method === 'QUERY' ? req.body : req.query);
    const { method: verb } = CRUD_ROUTES[op];
    // What the client sent, before the hooks: a relation a hook adds is the server's own to add.
    assertServed(meta, query, served);
    assertServed(meta, req.body, served);
    const hookCtx: HookContext<E, Ctx> = { meta, op, method, query, body: req.body, context: req.context };
    const appContext = (await getContext?.(req.context)) ?? {};
    // Scope the whole request (hooks + querier + relation/cascade queries) to the resolved context.
    return withContext(appContext, async () => {
      await pre?.(hookCtx);
      await (verb === 'GET' || verb === 'DELETE' ? preFilter : preSave)?.(hookCtx);
      // Resolved after the hooks: one that aborts the request must not reach the pool at all.
      const resolved = typeof pool === 'function' ? await pool(req.context, appContext) : pool;
      // A read acquires and releases; a write is one transaction, so a failing cascade takes its parent with it.
      const envelope = await (verb === 'GET' ? resolved.withQuerier(execute) : resolved.transaction(execute));
      await post?.(hookCtx, envelope);
      return { status: 200, body: envelope };
    });

    /** Runs `op`, reading the query and body after the hooks, which may have reshaped or reassigned them. */
    async function execute(querier: Querier): Promise<RequestSuccessResponse<unknown>> {
      const { query, body } = hookCtx;
      const { hardDelete = false, count: counts } = query;
      const scoped =
        id === undefined
          ? query
          : { ...query, $where: whereWith(soleIdOf(meta, 'the HTTP handler'), id, query.$where) };
      switch (op) {
        case 'findOne':
        case 'findOneById': {
          const data = await querier.findOne(entity, scoped);
          return { data, count: data ? 1 : 0 };
        }
        case 'count': {
          const count = await querier.count(entity, query);
          return { data: count, count };
        }
        case 'findMany': {
          const [data, count] = await Promise.all([
            querier.findMany(entity, query),
            counts ? querier.count(entity, query) : undefined,
          ]);
          return { data, count };
        }
        case 'insertOne':
          return { data: await querier.insertOne(entity, body as E), count: 1 };
        case 'saveOne':
          return { data: await querier.saveOne(entity, body as E), count: 1 };
        case 'insertMany': {
          const data = await querier.insertMany(entity, body as E[]);
          return { data, count: data.length };
        }
        case 'saveMany': {
          const data = await querier.saveMany(entity, body as E[]);
          return { data, count: data.length };
        }
        case 'updateMany':
        case 'updateOneById': {
          const count = await querier.updateMany(entity, scoped, body as UpdateWrite<E>);
          return { data: id ?? count, count };
        }
        case 'deleteOneById': {
          const count = await querier.deleteMany(entity, scoped, { hardDelete });
          return { data: id, count };
        }
        case 'deleteMany': {
          const founds = await querier.findMany(entity, query);
          if (!founds.length) {
            return { data: [], count: 0 };
          }
          const idKey = soleIdOf(meta, 'the HTTP handler');
          const ids: IdValue<E>[] = founds.map((found) => found[idKey]);
          return {
            data: ids,
            count: await querier.deleteMany(entity, { $where: whereIds(meta, ids) }, { hardDelete }),
          };
        }
      }
    }
  }
}

/**
 * Refuses a relation, at any depth of what a client sent, leading to an entity this handler does not
 * serve: `include` fences the routes, and this the rows a `$populate`, a filter, a sort, a tally or a
 * written row would otherwise reach through them. Every `$` clause holds keys of the entity it sits on.
 */
function assertServed<E>(meta: EntityMeta<E>, sent: unknown, served: ReadonlySet<Type<object>>, path = ''): void {
  if (Array.isArray(sent)) {
    for (const item of sent) {
      assertServed(meta, item, served, path);
    }
    return;
  }
  if (typeof sent !== 'object' || sent === null) {
    return;
  }
  const relations: Readonly<Record<string, RelationMeta | undefined>> = meta.relations;
  for (const [key, value] of Object.entries(sent)) {
    const relation = Object.hasOwn(relations, key) ? relations[key] : undefined;
    if (relation) {
      const target = relation.entity();
      const at = path ? `${path}.${key}` : key;
      if (!served.has(target)) {
        throw new UqlUsageError(`'${at}' reaches '${target.name}', which this handler does not serve`);
      }
      assertServed(getMeta(target), value, served, at);
    } else if (key.startsWith('$')) {
      assertServed(meta, value, served, path);
    }
  }
}
