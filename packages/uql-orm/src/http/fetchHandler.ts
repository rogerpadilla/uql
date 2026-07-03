import { type RequestErrorResponse, toErrorResponse } from './contract.js';
import { createRequestHandler, type RequestHandlerOptions } from './handler.js';

export type FetchHandlerOptions = RequestHandlerOptions<Request> & {
  /**
   * URL prefix to strip before matching entity routes, e.g. '/api'. Defaults to ''.
   */
  readonly basePath?: string;
};

/**
 * Web-standard adapter over {@link createRequestHandler}: mount the returned
 * `(request: Request) => Promise<Response>` in any fetch-native runtime
 * (Hono, Next.js route handlers, Bun.serve, Deno.serve, Cloudflare Workers, SvelteKit).
 */
export function createFetchHandler(opts: FetchHandlerOptions = {}): (request: Request) => Promise<Response> {
  const { basePath = '', ...handlerOpts } = opts;
  const handle = createRequestHandler<Request>(handlerOpts);

  return async (request) => {
    try {
      const url = new URL(request.url);
      let path = url.pathname;
      if (basePath && (path === basePath || path.startsWith(`${basePath}/`))) {
        path = path.slice(basePath.length);
      }
      const segments = path.split('/').filter((segment) => segment.length);
      if (segments.length === 0 || segments.length > 2) {
        return notFound();
      }
      const [entityPath, subPath] = segments;
      const method = request.method.toUpperCase();
      const pending = handle({
        method,
        entityPath,
        subPath,
        query: Object.fromEntries(url.searchParams),
        body: await parseBody(request, method),
        context: request,
      });
      if (!pending) {
        return notFound();
      }
      const { status, body } = await pending;
      return Response.json(body, { status });
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      return Response.json(body, { status });
    }
  };
}

async function parseBody(request: Request, method: string): Promise<unknown> {
  if (method !== 'POST' && method !== 'PUT' && method !== 'PATCH' && method !== 'QUERY') {
    return undefined;
  }
  const text = await request.text();
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new SyntaxError('invalid JSON body'), { status: 400 });
  }
}

function notFound(): Response {
  const body: RequestErrorResponse = { error: { message: 'not found', code: 404 } };
  return Response.json(body, { status: 404 });
}
