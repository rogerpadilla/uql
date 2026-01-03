import { Router as expressRouter, type NextFunction, type Request, type Response, type Router } from 'express';
import { getEntities, getMeta } from '../entity/index.js';
import { getQuerier } from '../index.js';
import type { EntityMeta, IdValue, Querier, Query, Type } from '../type/index.js';
import { kebabCase } from '../util/index.js';
import { parseQuery } from './query.util.js';

export function querierMiddleware(opts: MiddlewareOptions = {}): Router {
  const router = expressRouter();

  const { include, exclude, ...extra } = opts;

  let entities = include ?? getEntities();

  if (exclude) {
    entities = entities.filter((entity) => !exclude.includes(entity));
  }

  if (!entities.length) {
    throw new TypeError('no entities for the uql express middleware');
  }

  for (const entity of entities) {
    const path = kebabCase(entity.name);
    const subRouter = buildQuerierRouter(entity, extra);
    router.use('/' + path, subRouter);
  }

  return router;
}

export function buildQuerierRouter<E>(entity: Type<E>, opts: ExtraOptions): Router {
  const meta = getMeta(entity);
  const router = expressRouter();

  router.use((req, res, next) => {
    pre(req, meta, opts);
    next();
  });

  router.get(
    '/one',
    withQuerier(async (req, res, querier) => {
      const q = req.query as Query<E>;
      const data = await querier.findOne(entity, q);
      res.json({ data, count: data ? 1 : 0 });
    }),
  );

  router.get(
    '/count',
    withQuerier(async (req, res, querier) => {
      const q = req.query as Query<E>;
      const count = await querier.count(entity, q);
      res.json({ data: count, count });
    }),
  );

  router.get(
    '/:id',
    withQuerier(async (req, res, querier) => {
      const id = req.params.id as unknown as IdValue<E>;
      const q = req.query as Query<E>;

      q.$where ??= {};
      if (Array.isArray(q.$where)) {
        q.$where.push(id);
      } else {
        const where = q.$where as Record<string, unknown>;
        where[meta.id as string] = id;
      }

      const data = await querier.findOne(entity, q);
      res.json({ data, count: data ? 1 : 0 });
    }),
  );

  router.get(
    '/',
    withQuerier(async (req, res, querier) => {
      const q = req.query as Query<E>;
      const findManyPromise = querier.findMany(entity, q);
      const countPromise = req.query.count ? querier.count(entity, q) : undefined;
      const [data, count] = await Promise.all([findManyPromise, countPromise]);
      res.json({ data, count });
    }),
  );

  router.post(
    '/',
    withTransaction(async (req, res, querier) => {
      const payload = req.body as E;
      const id = await querier.insertOne(entity, payload);
      res.json({ data: id, count: id ? 1 : 0 });
    }),
  );

  router.patch(
    '/:id',
    withTransaction(async (req, res, querier) => {
      const payload = req.body as E;
      const id = req.params.id as unknown as IdValue<E>;
      const q = req.query as Query<E>;

      q.$where ??= {};
      if (Array.isArray(q.$where)) {
        q.$where.push(id);
      } else {
        const where = q.$where as Record<string, unknown>;
        where[meta.id as string] = id;
      }

      const count = await querier.updateMany(entity, q, payload);
      res.json({ data: req.params.id, count });
    }),
  );

  router.delete(
    '/:id',
    withTransaction(async (req, res, querier) => {
      const id = req.params.id as unknown as IdValue<E>;
      const q = req.query as Query<E>;

      q.$where ??= {};
      if (Array.isArray(q.$where)) {
        q.$where.push(id);
      } else {
        const where = q.$where as Record<string, unknown>;
        where[meta.id as string] = id;
      }

      const count = await querier.deleteMany(entity, q, {
        softDelete: !!req.query.softDelete,
      });
      res.json({ data: req.params.id, count });
    }),
  );

  router.delete(
    '/',
    withTransaction(async (req, res, querier) => {
      const q = req.query as Query<E>;
      const founds = await querier.findMany(entity, q);
      let ids: IdValue<E>[] = [];
      let count = 0;
      if (founds.length) {
        ids = founds.map((found) => found[meta.id as keyof E] as unknown as IdValue<E>);
        count = await querier.deleteMany(entity, { $where: ids } as Query<E>, {
          softDelete: !!req.query.softDelete,
        });
      }
      res.json({ data: ids, count });
    }),
  );

  return router;
}

function withQuerier(fn: (req: Request, res: Response, querier: Querier) => Promise<void>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    let querier: Querier | undefined;
    try {
      querier = await getQuerier();
      await fn(req, res, querier);
    } catch (err) {
      next(err);
    } finally {
      await querier?.release();
    }
  };
}

function withTransaction(fn: (req: Request, res: Response, querier: Querier) => Promise<void>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    let querier: Querier | undefined;
    try {
      querier = await getQuerier();
      await querier.beginTransaction();
      await fn(req, res, querier);
      await querier.commitTransaction();
    } catch (err) {
      await querier?.rollbackTransaction().catch(() => {});
      next(err);
    } finally {
      await querier?.release();
    }
  };
}

function pre(req: Request, meta: EntityMeta<any>, extra: ExtraOptions) {
  const method = req.method;
  parseQuery(req);
  extra.pre?.(req, meta);
  if (method === 'POST' || method === 'PATCH' || method === 'PUT') {
    extra.preSave?.(req, meta);
  } else if (method === 'GET' || method === 'DELETE') {
    extra.preFilter?.(req, meta);
  }
}

export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
  });
}

type ExtraOptions = {
  /**
   * Allow augment any kind of request before it runs
   */
  readonly pre?: Pre;
  /**
   * Allow augment a save request before it runs
   */
  readonly preSave?: Pre;
  /**
   * Allow augment a filter request before it runs
   */
  readonly preFilter?: Pre;
};

type Pre = (req: Request, meta: EntityMeta<any>) => void;

export type MiddlewareOptions = ExtraOptions & {
  include?: Type<any>[];
  exclude?: Type<any>[];
};
