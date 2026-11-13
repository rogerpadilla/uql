import { getContext as ambientContext, withContext } from '../context/context.js';
import { getMeta, soleIdOf } from '../entity/index.js';
import { assertPageable } from '../querier/keyset.js';
import type { Querier, QuerierPool, Type, UqlContext } from '../type/index.js';
import { whereWith } from '../util/query.util.js';
import { UqlError, UqlRequestError, UqlUsageError } from '../util/uqlError.js';
import { type ApiCall, type ApiMiddleware, callOf, chain, isCallOf } from './apiCall.js';
import { exposedQuery, type Served, type ServedEntities, servedEntry } from './exposure.js';
import {
  API_OPS,
  type ApiOp,
  type EntityPathOptions,
  entityPathOf,
  isApiOp,
  parseWireCall,
  type WireCall,
} from './wireCall.js';
import { parseWireQuery } from './wireQuery.js';
import { readWirePayload, readWireQuery, writeWireData } from './wireRow.js';

export type ApiOptions<Ctx = unknown> = EntityPathOptions & {
  /**
   * The entities served, and the only ones a call reaches, through a relation too: nothing is served by being
   * defined, so an entity holding secrets (a session's token) stays off the wire unless named. Each entity's `wire`
   * says what a client may do to it; `serve(User, { use })` runs middleware of its own.
   */
  include: readonly (Type<object> | Served<object, Ctx>)[];
  /** Run around every call, first to last, before an entity's own. */
  use?: readonly ApiMiddleware<Ctx>[];
  /**
   * Derive the ambient {@link UqlContext} (e.g. `{ tenantId, userId }`) from the transport's context, which the whole
   * call then runs inside, so policies scope it. Derive it from a verified source (a session, a JWT).
   * Without it, a call runs in whatever context its caller set (a tRPC middleware's).
   */
  contextOf?: (context: Ctx) => UqlContext | undefined | Promise<UqlContext | undefined>;
  /**
   * The pool a call runs on. A function is called per call, after `contextOf` and every middleware, with the
   * transport's context and the context the call runs in: a database per tenant.
   */
  pool: QuerierPool | ((context: Ctx, appContext: UqlContext) => QuerierPool | Promise<QuerierPool>);
};

export type Api<Ctx = unknown> = {
  /** Whether `op` on the entity at `path` is a call this API serves: what a transport that falls through on others asks. */
  serves(path: string, op: string): op is ApiOp;
  /**
   * Run a client's call, which arrives as JSON from any transport and is checked here, and resolve to its result as
   * JSON carries it. Refuses what the call may not reach before any middleware runs, so what a middleware adds is
   * the server's own.
   */
  call(call: unknown, context: Ctx): Promise<unknown>;
};

/** `Company (crm.Company)`: the class, and the table it maps, which is what tells two apart. */
function tableOf(entity: Type<object>): string {
  const meta = getMeta(entity);
  return `${entity.name} (${meta.schema ? `${meta.schema}.${meta.name}` : meta.name})`;
}

export function createApi<Ctx = unknown>(opts: ApiOptions<Ctx>): Api<Ctx> {
  const { include, use = [], contextOf, pool } = opts;
  const pathOf = entityPathOf(opts);

  // Refused rather than defaulted to every entity defined, which would serve whatever one registers.
  if (!include?.length) {
    throw new UqlUsageError("name the entities the API serves in 'include': it serves those alone");
  }
  const entries = include.map(servedEntry);
  const entities = entries.map(([entity]) => entity);
  const served = new Map(entries);
  const unwired = entities.filter((entity) => getMeta(entity).wire === false);
  if (unwired.length) {
    throw new UqlUsageError(
      `'wire: false' keeps ${unwired.map((entity) => `'${entity.name}'`).join(', ')} off every API: remove from 'include'`,
    );
  }

  // All of them at once, so fixing the first collision does not just reveal the next.
  const byPath = Map.groupBy(entities, pathOf);
  const collisions = [...byPath].filter(([, clashing]) => clashing.length > 1);
  if (collisions.length) {
    const lines = collisions.map(([path, clashing]) => `  /${path} <- ${clashing.map(tableOf).join(', ')}`);
    throw new UqlUsageError(
      `every entity below shares a path with another, so all but the first are unreachable:\n${lines.join('\n')}\n` +
        "A path is the kebab-cased class name unless 'entityPath' says otherwise. Name them apart, " +
        "pass an 'entityPath', or pass only one of them in 'include'.",
    );
  }
  const entityByPath = new Map<string, Type<object>>([...byPath].map(([path, [entity]]) => [path, entity]));

  return {
    serves: (path, op): op is ApiOp => entityByPath.has(path) && isApiOp(op),
    call: async (input, context) => {
      const sent = parseWireCall(input);
      const entity = entityByPath.get(sent.entity);
      if (!entity) {
        // A 404, as a route that names no entity is: the call is well formed, its entity is not here.
        throw new UqlRequestError(`'${sent.entity}' is not an entity this API serves`, 404);
      }
      return run(entity, sent, context);
    },
  };

  async function run<E extends object>(entity: Type<E>, sent: WireCall, context: Ctx): Promise<unknown> {
    const meta = getMeta(entity);
    const shape = API_OPS[sent.op];
    const call = decodedCall(entity, sent, served);
    const appContext = contextOf ? ((await contextOf(context)) ?? {}) : (ambientContext() ?? {});
    const around = served.get(entity);
    const answer = () =>
      chain<object, Ctx>(around ? [...use, around] : use, context, async (reshaped) => {
        if (!isCallOf(entity, reshaped)) {
          throw new UqlUsageError(`a middleware moved a call to '${entity.name}' to another entity`);
        }
        // Resolved after the middleware: one that aborts the call must not reach the pool at all.
        const resolved = typeof pool === 'function' ? await pool(context, appContext) : pool;
        // A read acquires and releases; a write is one transaction, so a failing cascade takes its parent with it.
        const execute = (querier: Querier) => executeOn(querier, reshaped);
        const pending = shape.access === 'read' ? resolved.withQuerier(execute) : resolved.transaction(execute);
        return pending.catch(placedInQuery);
      })(call);
    // Scope the whole call (middleware, querier, relation and cascade queries) to the context `contextOf` resolved;
    // without one, the call keeps the context its caller runs in.
    const result = await (contextOf ? withContext(appContext, answer) : answer());
    return writeWireData(meta, result, shape.answers);
  }
}

/**
 * The call `sent` asks of `entity` as the querier takes it: its query and payload read back as the entity holds them,
 * checked against what its op takes and what the API exposes. Run on what the client sent, before any middleware, so
 * what a middleware adds is the server's own to add.
 */
function decodedCall<E extends object>(entity: Type<E>, sent: WireCall, served: ServedEntities): ApiCall<E> {
  const meta = getMeta(entity);
  const { op } = sent;
  const query = readWireQuery(meta, parseWireQuery<E>(sent.query));
  const payload = readWirePayload(meta, sent.payload);
  return callOf({
    entity,
    op,
    id: sent.id,
    query: exposedQuery(meta, op, query, payload, served),
    payload,
    hardDelete: sent.hardDelete ?? false,
  });
}

/** A querier's refusal names its place within the query it refused: within the call, that is under `query`. */
function placedInQuery(err: unknown): never {
  if (err instanceof UqlError && err.path) {
    Object.defineProperty(err, 'path', { value: ['query', ...err.path] });
  }
  throw err;
}

async function executeOn<E extends object>(querier: Querier, call: ApiCall<E>): Promise<unknown> {
  const { entity, query, hardDelete } = call;
  /** The query scoped to the one row the call addresses. */
  const byId = (id: string | number) => ({
    ...query,
    $where: whereWith(soleIdOf(getMeta(entity), 'the API'), id, query.$where),
  });
  switch (call.op) {
    case 'findOne':
      return querier.findOne(entity, query);
    case 'findOneById':
      return querier.findOne(entity, byId(call.id));
    case 'count':
      return querier.count(entity, query);
    case 'findMany':
      return querier.findMany(entity, query);
    case 'findManyAndCount':
      return querier.findManyAndCount(entity, query);
    case 'findManyPage':
      assertPageable(getMeta(entity), query);
      return querier.findManyPage(entity, query);
    case 'insertOne':
      return querier.insertOne(entity, call.payload);
    case 'saveOne':
      return querier.saveOne(entity, call.payload);
    case 'insertMany':
      return querier.insertMany(entity, call.payload);
    case 'saveMany':
      return querier.saveMany(entity, call.payload);
    // A write answers how many rows it changed, and the querier still refuses a delete that names no rows.
    case 'updateMany':
      return querier.updateMany(entity, query, call.payload);
    case 'updateOneById':
      return querier.updateMany(entity, byId(call.id), call.payload);
    case 'deleteMany':
      return querier.deleteMany(entity, query, { hardDelete });
    case 'deleteOneById':
      return querier.deleteMany(entity, byId(call.id), { hardDelete });
  }
}
