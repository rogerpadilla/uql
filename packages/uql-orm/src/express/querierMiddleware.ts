import { Router as expressRouter, type NextFunction, type Request, type Response, type Router } from 'express';
import { toErrorResponse } from '../http/contract.js';
import { createRequestHandler, type RequestHandlerOptions } from '../http/handler.js';

export type MiddlewareOptions = RequestHandlerOptions<Request>;

/**
 * Express adapter over the framework-agnostic {@link createRequestHandler}.
 * Unknown entities and routes fall through via `next()` so the middleware
 * composes with custom routes; errors go to `next(err)` so user error
 * middleware (e.g. {@link errorHandler}) keeps working.
 */
export function querierMiddleware(opts: MiddlewareOptions = {}): Router {
  const handle = createRequestHandler<Request>(opts);
  const router = expressRouter();

  router.all('/:entityPath{/:subPath}', async (req, res, next) => {
    const pending = handle({
      method: req.method,
      entityPath: req.params.entityPath,
      subPath: req.params.subPath,
      query: req.query as Record<string, unknown>,
      body: req.body,
      context: req,
    });
    if (!pending) {
      next();
      return;
    }
    try {
      const { status, body } = await pending;
      res.status(status).json(body);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  const { status, body } = toErrorResponse(err);
  res.status(status).json(body);
}
