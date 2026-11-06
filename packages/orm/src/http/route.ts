// the specific util modules, not the barrel, which reaches every dialect helper and would land in the browser bundle
import { isPlainObject, jsonDocument } from '../util/object.util.js';
import { type UqlErrorPath, UqlRequestError, UqlUsageError } from '../util/uqlError.js';
import { API_OPS, type ApiOp, type WireCall, wireJson } from './wireCall.js';

/**
 * How a client sends a read. `GET` carries the call in `?q=`, so a read caches and an `EventSource` can open it;
 * `QUERY` (RFC 10008) and `POST` carry it in the body, past a URL's length limit. A write is `POST` alone.
 */
export type ReadMethod = 'GET' | 'QUERY' | 'POST';

/** HEAD reads as GET does, which HTTP asks of a resource taking GET: the runtime leaves the body off. */
const READS: readonly string[] = ['GET', 'HEAD', 'QUERY', 'POST'];
const WRITES: readonly string[] = ['POST'];

/** The methods `op` takes. */
function methodsOf(op: ApiOp): readonly string[] {
  return API_OPS[op].access === 'read' ? READS : WRITES;
}

/** A call as HTTP carries it, under the API's base: `/{entity}/{op}`, the rest of the call as JSON in `?q=` or the body. */
export type HttpCall = { readonly method: ReadMethod; readonly path: string; readonly body?: string };

/** The request {@link decodeRequest} reads `call` back from. */
export function encodeCall({ entity, op, ...rest }: WireCall, readMethod: ReadMethod = 'GET'): HttpCall {
  const path = `/${encodeURIComponent(entity)}/${op}`;
  const json = wireJson(rest);
  const method = API_OPS[op].access === 'read' ? readMethod : 'POST';
  if (method !== 'GET') {
    return { method, path, body: json };
  }
  return { method, path: json === '{}' ? path : `${path}?q=${encodeURIComponent(json)}` };
}

/**
 * A request to `/{entityPath}/{op}` as an adapter reduces it: its `q` as the URL holds it, and its body as the text it
 * arrived as, which {@link decodeRequest} parses once the method and the content type are taken, or as a framework
 * parsed it already.
 */
export type HttpRequest = {
  readonly method: string;
  readonly entityPath: string;
  readonly op: ApiOp;
  readonly q?: unknown;
  readonly body?: unknown;
  readonly contentType?: string | null;
};

/**
 * The call a request carries, unchecked past its envelope (`api.call` checks the rest). Refuses a method its op
 * does not take, a body that is not JSON (which a cross-site form cannot send), and a call that is not an object.
 */
export function decodeRequest(req: HttpRequest): object {
  const { op } = req;
  const method = req.method.toUpperCase();
  const methods = methodsOf(op);
  if (!methods.includes(method)) {
    const allow = methods.join(', ');
    throw new UqlRequestError(`'${op}' takes ${allow}, not ${method}`, 405, { headers: { allow } });
  }
  const rest = method === 'GET' || method === 'HEAD' ? callInUrl(req.q) : callInBody(req, method);
  const named = ['entity', 'op'].find((key) => key in rest);
  if (named) {
    throw new UqlUsageError(`a call's '${named}' is named by its path`, { path: [named] });
  }
  return { ...rest, entity: req.entityPath, op };
}

/** Whether a content type is JSON's, the one a call's body takes: a cross-site form cannot send it. */
export function isJson(contentType: string | null | undefined): boolean {
  return contentType?.split(';')[0]?.trim().toLowerCase() === 'application/json';
}

/** The call a `GET` or `HEAD` carries, the JSON text of `q`. */
function callInUrl(q: unknown): Record<string, unknown> {
  if (q === undefined) {
    return {};
  }
  if (typeof q !== 'string') {
    throw new UqlUsageError("'q' is the call as one JSON text", { path: ['q'] });
  }
  const parsed = jsonDocument(q);
  if (parsed === undefined) {
    throw new UqlUsageError("'q' is not valid JSON", { path: ['q'] });
  }
  return objectOf(parsed, ['q']);
}

/** The call a body carries: its text, parsed once the content type is taken, or as a framework parsed it. */
function callInBody(req: HttpRequest, method: string): Record<string, unknown> {
  if (!isJson(req.contentType)) {
    throw new UqlRequestError("a call's body is JSON: send 'content-type: application/json'", 415);
  }
  if (req.q !== undefined) {
    throw new UqlUsageError(`a ${method} carries its call in the body, not in 'q'`, { path: ['q'] });
  }
  const { body } = req;
  if (typeof body !== 'string') {
    return objectOf(body ?? {}, []);
  }
  const parsed = body ? jsonDocument(body) : {};
  if (parsed === undefined) {
    throw new UqlUsageError('invalid JSON body');
  }
  return objectOf(parsed, []);
}

function objectOf(value: unknown, path: UqlErrorPath): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new UqlUsageError('a call must be a JSON object', { path });
  }
  return value;
}
