import { UqlRequestError } from '../util/uqlError.js';
import type { Api } from './api.js';
import { type HandlerResponse, toErrorResponse } from './errors.js';
import { decodeRequest, type HttpRequest, isJson } from './route.js';
import type { ApiOp } from './wireCall.js';

/** A request to `/{entityPath}/{op}` as a framework adapter reduces it, with what `contextOf` and middleware get. */
export type HandlerRequest<Ctx = unknown> = Omit<HttpRequest, 'op'> & {
  readonly op: string;
  /** The adapter's own request (express `req`, fetch `Request`, ...): the auth and tenant source. */
  readonly context: Ctx;
};

/**
 * Answers a request with a status and a JSON body, a failure included, or `undefined` for an entity or an op the API
 * does not serve, so an adapter can fall through (express `next()`).
 */
export type RequestHandler<Ctx = unknown> = (req: HandlerRequest<Ctx>) => Promise<HandlerResponse | undefined>;

/** The API over HTTP for any framework: mount it on `{base}/:entityPath/:op`, e.g. `/api/v1/:entityPath/:op`. */
export function toRequestHandler<Ctx>(api: Api<Ctx>): RequestHandler<Ctx> {
  return async ({ op, ...req }) => (api.serves(req.entityPath, op) ? answerRequest(api, { ...req, op }) : undefined);
}

/** Answers a request to an op the API serves (`api.serves`) with a status and a JSON body, a failure included. */
export async function answerRequest<Ctx>(
  api: Api<Ctx>,
  { context, ...req }: HandlerRequest<Ctx> & { readonly op: ApiOp },
): Promise<HandlerResponse> {
  try {
    return { status: 200, body: { data: await api.call(decodeRequest(req), context) } };
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * The API as `(request: Request) => Promise<Response>`, for any fetch-native runtime (Hono, Next.js route handlers,
 * Bun.serve, Cloudflare Workers, SvelteKit, Astro), handing the `Request` to the API as its context. Mount it on a
 * catch-all under the API's base: it reads the last two segments of the path as the entity and the op.
 */
export function toFetchHandler(api: Api<Request>): (request: Request) => Promise<Response> {
  return async (request) => {
    const url = new URL(request.url);
    const [entityPath = '', op = ''] = url.pathname.split('/').filter(Boolean).slice(-2).map(decodedSegment);
    if (!api.serves(entityPath, op)) {
      return answer(toErrorResponse(new UqlRequestError('Not Found', 404)));
    }
    const { method } = request;
    const contentType = request.headers.get('content-type');
    const q = url.searchParams.get('q') ?? undefined;
    try {
      // Read only where it is JSON: any other body is refused unread.
      const body = request.body && isJson(contentType) ? await request.text() : undefined;
      return answer(await answerRequest(api, { method, entityPath, op, q, body, contentType, context: request }));
    } catch (err) {
      return answer(toErrorResponse(err));
    }
  };
}

function answer({ status, body, headers }: HandlerResponse): Response {
  return Response.json(body, { status, ...(headers && { headers }) });
}

/** A path segment as it names an entity or an op: one that does not decode names nothing, so answers 404. */
function decodedSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return '';
  }
}
