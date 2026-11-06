import express, { type Request, type Response, type Router } from 'express';
import type { Api } from '../http/api.js';
import { type HandlerResponse, toErrorResponse } from '../http/errors.js';
import { answerRequest } from '../http/handler.js';
import { isRecord } from '../util/object.util.js';
import { UqlRequestError } from '../util/uqlError.js';

/**
 * The API as an express router, handing the express `Request` to the API as its context. Mount it under the API's
 * base, e.g. `app.use('/api/v1', toExpress(api))`. It reads a body only on a route it serves, and a route it does
 * not serve falls through via `next()`, so it composes with custom routes.
 */
export function toExpress(api: Api<Request>): Router {
  const router = express.Router();
  // As text, for the API to parse once it takes the method and the content type; one parsed already passes as it is.
  const text = express.text({ type: 'application/json' });

  router.all('/:entityPath/:op', (req, res, next) => {
    const { entityPath, op } = req.params;
    if (!api.serves(entityPath, op)) {
      next();
      return;
    }
    text(req, res, (err?: unknown) => {
      if (err) {
        send(res, toErrorResponse(unread(err)));
        return;
      }
      const answered = answerRequest(api, {
        method: req.method,
        entityPath,
        op,
        q: req.query['q'],
        body: req.body,
        contentType: req.get('content-type'),
        context: req,
      });
      void answered.then((response) => send(res, response));
    });
  });

  return router;
}

function send(res: Response, { status, body, headers }: HandlerResponse): void {
  res
    .status(status)
    .set(headers ?? {})
    .json(body);
}

/** What the body reader refused, an oversized body or an unknown charset, as the request it refuses: a 4xx. */
function unread(err: unknown): UqlRequestError {
  const status = isRecord(err) && typeof err['status'] === 'number' && err['status'] < 500 ? err['status'] : 400;
  return new UqlRequestError('the body could not be read', status);
}
