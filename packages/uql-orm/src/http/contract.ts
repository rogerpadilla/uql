import type { Type, UniversalQuerier } from '../type/index.js';
// import from the specific util modules (not the barrel) to keep entity
// metadata and reflect-metadata out of the browser bundle
import { getKeys } from '../util/object.util.js';
import { kebabCase } from '../util/string.util.js';

type RouteShape = {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly path: '' | `/${string}`;
};

/**
 * Single source of truth for the CRUD-over-HTTP surface, shared by server adapters and the browser client.
 * Keys are constrained to {@link UniversalQuerier} method names, so renaming a querier method
 * (or routing a non-existent one) is a compile error.
 */
export const CRUD_ROUTES = {
  findMany: { method: 'GET', path: '' },
  findOne: { method: 'GET', path: '/one' },
  count: { method: 'GET', path: '/count' },
  findOneById: { method: 'GET', path: '/:id' },
  insertOne: { method: 'POST', path: '' },
  insertMany: { method: 'POST', path: '/many' },
  saveOne: { method: 'PUT', path: '' },
  saveMany: { method: 'PUT', path: '/many' },
  updateMany: { method: 'PATCH', path: '' },
  updateOneById: { method: 'PATCH', path: '/:id' },
  deleteOneById: { method: 'DELETE', path: '/:id' },
  deleteMany: { method: 'DELETE', path: '' },
} as const satisfies Partial<Record<keyof UniversalQuerier, RouteShape>>;

export type CrudOperation = keyof typeof CRUD_ROUTES;

export type CrudRoute = (typeof CRUD_ROUTES)[CrudOperation];

/**
 * `QUERY` (RFC 10008) is an alternate transport for the read operations: same semantics as the
 * GET routes, but the JSON query travels in the request body instead of the query string,
 * avoiding URL-length limits for large queries.
 */
export type HttpMethod = CrudRoute['method'] | 'QUERY';

const CRUD_OPS = getKeys(CRUD_ROUTES);

// derived from CRUD_ROUTES (the literal-path GET routes) so the sub-paths live in exactly one place
const QUERY_READ_OPS: ReadonlyMap<string, CrudOperation> = new Map(
  CRUD_OPS.filter((op) => CRUD_ROUTES[op].method === 'GET' && CRUD_ROUTES[op].path !== '/:id').map((op) => [
    CRUD_ROUTES[op].path,
    op,
  ]),
);

/**
 * URL segment for an entity, e.g. `entityPath(UserProfile) === 'user-profile'`.
 */
export function entityPath<E>(entity: Type<E>): string {
  return kebabCase(entity.name);
}

export type RouteMatch = {
  readonly op: CrudOperation;
  /**
   * the resolved transport method - differs from the op's canonical route method for QUERY.
   */
  readonly method: HttpMethod;
  readonly id?: string;
};

/**
 * Resolve a (method, sub-path) pair to a CRUD operation. Literal sub-paths win over `:id`.
 */
export function matchRoute(method: string, subPath: string | undefined): RouteMatch | undefined {
  const raw = method.toUpperCase();
  const literal = subPath === undefined ? '' : `/${subPath}`;
  if (raw === 'QUERY') {
    const op = QUERY_READ_OPS.get(literal);
    return op ? { op, method: 'QUERY' } : undefined;
  }
  // HEAD reads like GET per HTTP semantics; the server runtime omits the response body
  const verb = raw === 'HEAD' ? 'GET' : raw;
  let idOp: CrudOperation | undefined;
  for (const op of CRUD_OPS) {
    const route = CRUD_ROUTES[op];
    if (route.method !== verb) {
      continue;
    }
    if (route.path === literal) {
      return { op, method: route.method };
    }
    if (route.path === '/:id') {
      idOp = op;
    }
  }
  return idOp && subPath !== undefined ? { op: idOp, method: CRUD_ROUTES[idOp].method, id: subPath } : undefined;
}

export type RequestSuccessResponse<E> = {
  data: E;
  count?: number;
};

export type RequestCountedSuccessResponse<E> = RequestSuccessResponse<E> & {
  count: number;
};

export type RequestErrorResponse = {
  readonly error: {
    readonly message: string;
    readonly code: number;
  };
};

/**
 * Map a thrown error to the wire error envelope. Honors a numeric `status` on the error
 * (e.g. hooks throwing 403), defaults to 500; `code` mirrors the HTTP status.
 */
export function toErrorResponse(err: unknown): { status: number; body: RequestErrorResponse } {
  const status = err instanceof Error && 'status' in err && typeof err.status === 'number' ? err.status : 500;
  const message = err instanceof Error ? err.message : 'Internal Server Error';
  return { status, body: { error: { message, code: status } } };
}
