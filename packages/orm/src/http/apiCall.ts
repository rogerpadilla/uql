import type { EntityWrite, Query, Type, UpdateWrite } from '../type/index.js';
import { isRecord } from '../util/object.util.js';
import { UqlUsageError } from '../util/uqlError.js';
import type { API_OPS, ApiOp } from './wireCall.js';
import type { WireCursors } from './wireQuery.js';

/** Each kind of payload an op writes, as the entity holds it. */
type Payloads<E> = {
  readonly row: EntityWrite<E>;
  readonly rows: readonly EntityWrite<E>[];
  readonly changes: UpdateWrite<E>;
};

type PayloadOf<E, Op extends ApiOp> = (typeof API_OPS)[Op] extends {
  readonly writes: infer W extends keyof Payloads<E>;
}
  ? { readonly payload: Payloads<E>[W] }
  : { readonly payload?: undefined };

/** The row an op by id addresses, which no other op names. */
type IdOf<Op extends ApiOp> = (typeof API_OPS)[Op] extends { readonly byId: true }
  ? { readonly id: string | number }
  : { readonly id?: undefined };

type CallOf<E, Op extends ApiOp> = {
  readonly entity: Type<E>;
  readonly op: Op;
  readonly query: Query<E> & WireCursors;
  readonly hardDelete: boolean;
} & IdOf<Op> &
  PayloadOf<E, Op>;

/**
 * A call as the API runs it, decoded and checked, for a middleware to read or reshape: one member per op, so
 * narrowing on `op` types the payload (`call.op === 'insertOne'` makes it a row).
 */
export type ApiCall<E, Op extends ApiOp = ApiOp> = Op extends ApiOp ? CallOf<E, Op> : never;

/** What a middleware hands on to: the next middleware, the querier last. */
export type ApiNext<E> = (call: ApiCall<E>) => Promise<unknown>;

/**
 * Runs around each call to one entity: reshape it before `next`, abort by throwing (a `UqlRequestError` answers its
 * status), or reshape what `next` resolves to, the result as the entity holds it. `context` is the transport's.
 */
export type EntityMiddleware<E, Ctx = unknown> = (call: ApiCall<E>, context: Ctx, next: ApiNext<E>) => Promise<unknown>;

/** A middleware run around a call to any entity, for what reads no entity's members: logging, timing, a refusal. */
export type ApiMiddleware<Ctx = unknown> = <E extends object>(
  call: ApiCall<E>,
  context: Ctx,
  next: ApiNext<E>,
) => Promise<unknown>;

/** Whether `call` is a call to `entity`, for a middleware typed by it. */
export function isCallOf<E extends object>(entity: Type<E>, call: ApiCall<object>): call is ApiCall<E> {
  return call.entity === entity;
}

/** Runs `use` around `last`, first to last. */
export function chain<E, Ctx>(use: readonly EntityMiddleware<E, Ctx>[], context: Ctx, last: ApiNext<E>): ApiNext<E> {
  return use.reduceRight<ApiNext<E>>((next, middleware) => (call) => middleware(call, context, next), last);
}

type Decoded<E> = {
  readonly entity: Type<E>;
  readonly op: ApiOp;
  readonly id?: string | number;
  readonly query: Query<E> & WireCursors;
  readonly payload: unknown;
  readonly hardDelete: boolean;
};

/** The call `decoded` asks for, the id and the payload's shape its op needs checked. */
export function callOf<E extends object>({ op, id, payload, ...rest }: Decoded<E>): ApiCall<E> {
  switch (op) {
    case 'insertOne':
    case 'saveOne':
      return { ...rest, op, payload: recordOf<EntityWrite<E>>(payload) };
    case 'insertMany':
    case 'saveMany':
      return { ...rest, op, payload: rowsOf<E>(payload) };
    case 'updateMany':
      return { ...rest, op, payload: recordOf<UpdateWrite<E>>(payload) };
    case 'updateOneById':
      return { ...rest, op, id: idOf(op, id), payload: recordOf<UpdateWrite<E>>(payload) };
    case 'findOneById':
    case 'deleteOneById':
      return { ...rest, op, id: idOf(op, id) };
    default:
      return { ...rest, op };
  }
}

function idOf(op: ApiOp, id: string | number | undefined): string | number {
  if (id === undefined) {
    throw new UqlUsageError(`'${op}' names the row it addresses in 'id'`, { path: ['id'] });
  }
  return id;
}

/** Whether `value` is a row, or changes to one, as JSON carries it: its fields are the querier's to check. */
function isRecordOf<T extends object>(value: unknown): value is T {
  return isRecord(value);
}

function recordOf<T extends object>(payload: unknown): T {
  if (!isRecordOf<T>(payload)) {
    throw new UqlUsageError('the payload must be a JSON object', { path: ['payload'] });
  }
  return payload;
}

function rowsOf<E>(payload: unknown): readonly EntityWrite<E>[] {
  if (!Array.isArray(payload) || !payload.every((row) => isRecordOf<EntityWrite<E>>(row))) {
    throw new UqlUsageError('the payload must be a JSON array of rows', { path: ['payload'] });
  }
  return payload;
}
