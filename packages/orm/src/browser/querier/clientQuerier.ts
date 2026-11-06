import { getMeta } from '../../entity/metadata/definition.js';
import { API_OPS, type ApiOp, type EntityPathOptions, entityPathOf, type WireCall } from '../../http/wireCall.js';
import { readWireData } from '../../http/wireRow.js';
import type { AbstractType, EntityId } from '../../type/index.js';
import { isScalarId } from '../../util/object.util.js';
import { UqlUsageError } from '../../util/uqlError.js';
import type { ClientQuerier, ClientTransport, CallOptions } from '../type/index.js';

/** A call's fields past its entity and op. */
type CallFields = Omit<WireCall, 'entity' | 'op'>;

/** The id as a call carries it, refusing a composite key, which a call has no spelling for yet. */
function idOf<E>(entity: AbstractType<E>, id: EntityId<E>): string | number {
  if (!isScalarId(id)) {
    throw new UqlUsageError(`'${entity.name}' was addressed by an id object, which a call cannot carry.`);
  }
  return typeof id === 'number' ? id : String(id);
}

/**
 * The querier a client runs against an API, over `transport`: the server querier's methods, answering what it
 * answers, each row read back as the entity holds it (a `Date` as a `Date`, a `bigint` exact).
 */
export function createClientQuerier(transport: ClientTransport, opts: EntityPathOptions = {}): ClientQuerier {
  const pathOf = entityPathOf(opts);

  /** The result is the API's, read by the entity: the network is where its type is taken on trust. */
  async function send<T>(entity: AbstractType<object>, op: ApiOp, fields: CallFields, options?: CallOptions) {
    const answer = await transport({ entity: pathOf(entity), op, ...fields }, options);
    return readWireData(getMeta(entity), answer, API_OPS[op].answers) as T;
  }

  const querier: ClientQuerier = {
    findOneById: async (entity, id, query, options) =>
      send(entity, 'findOneById', { id: idOf(entity, id), query }, options),
    findOne: (entity, query, options) => send(entity, 'findOne', { query }, options),
    findMany: (entity, query, options) => send(entity, 'findMany', { query }, options),
    findManyAndCount: (entity, query, options) => send(entity, 'findManyAndCount', { query }, options),
    findManyPage: (entity, query, options) => send(entity, 'findManyPage', { query }, options),
    count: (entity, query, options) => send(entity, 'count', { query }, options),
    /** The count capped at one row, so existence needs no op of its own. */
    exists: async (entity, query, options) => (await querier.count(entity, { ...query, $limit: 1 }, options)) > 0,
    insertOne: (entity, payload, options) => send(entity, 'insertOne', { payload }, options),
    insertMany: (entity, payload, options) => send(entity, 'insertMany', { payload }, options),
    saveOne: (entity, payload, options) => send(entity, 'saveOne', { payload }, options),
    saveMany: (entity, payload, options) => send(entity, 'saveMany', { payload }, options),
    updateOneById: async (entity, id, payload, options) =>
      send(entity, 'updateOneById', { id: idOf(entity, id), payload }, options),
    updateMany: (entity, query, payload, options) => send(entity, 'updateMany', { query, payload }, options),
    deleteOneById: async (entity, id, options) =>
      send(entity, 'deleteOneById', { id: idOf(entity, id), hardDelete: options?.hardDelete }, options),
    deleteMany: (entity, query, options) =>
      send(entity, 'deleteMany', { query, hardDelete: options?.hardDelete }, options),
  };
  return querier;
}
