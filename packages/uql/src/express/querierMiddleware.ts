import { Router as expressRouter, type Request, type Router } from 'express';
import { getEntities, getMeta } from '../entity/index.js';
import { getQuerier } from '../index.js';
import type { EntityMeta, IdValue, Query, Type } from '../type/index.js';
import { kebabCase } from '../util/index.js';
import { parseQuery } from './query.util.js';

export function querierMiddleware(opts: MiddlewareOptions = {}): Router {
  const router = expressRouter();

  const { include, exclude, ...extra } = opts;

  let entities = include ?? getEntities();

  if (exclude) {
    entities = entities.filter((entity) => !opts.exclude.includes(entity));
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

  router.get('/one', async (req, res, next) => {
    const q = req.query as Query<E>;
    const querier = await getQuerier();
    try {
      const data = await querier.findOne(entity, q);
      res.json({ data, count: data ? 1 : 0 });
    } catch (err: any) {
      next(err);
    }
  });

  router.get('/:id', async (req, res, next) => {
    const id = req.params.id as IdValue<E>;
    const q = req.query as Query<E>;
    q.$where ??= {};
    if (Array.isArray(q.$where)) {
      q.$where.push(id);
    } else {
      q.$where[meta.id as string] = id;
    }
    const querier = await getQuerier();
    try {
      const data = await querier.findOne(entity, q);
      res.json({ data, count: data ? 1 : 0 });
    } catch (err: any) {
      next(err);
    }
  });

  router.get('/', async (req, res, next) => {
    const q = req.query as Query<E>;
    const querier = await getQuerier();
    try {
      const findManyPromise = querier.findMany(entity, q);
      const countPromise = req.query.count ? querier.count(entity, q) : undefined;
      const [data, count] = await Promise.all([findManyPromise, countPromise]);
      res.json({ data, count });
    } catch (err: any) {
      next(err);
    }
  });

  router.get('/count', async (req, res, next) => {
    const q = req.query as Query<E>;
    const querier = await getQuerier();
    try {
      const count = await querier.count(entity, q);
      res.json({ data: count, count });
    } catch (err: any) {
      next(err);
    }
  });

  router.post('/', async (req, res, next) => {
    const payload = req.body as E;
    const querier = await getQuerier();
    try {
      await querier.beginTransaction();
      const id = await querier.insertOne(entity, payload);
      await querier.commitTransaction();
      res.json({ data: id, count: id ? 1 : 0 });
    } catch (err: any) {
      await querier.rollbackTransaction();
      next(err);
    } finally {
      await querier.release();
    }
  });

  router.patch('/:id', async (req, res, next) => {
    const payload = req.body as E;
    const id = req.params.id as IdValue<E>;
    const q = req.query as Query<E>;
    q.$where ??= {};
    if (Array.isArray(q.$where)) {
      q.$where.push(id);
    } else {
      q.$where[meta.id as string] = id;
    }
    const querier = await getQuerier();
    try {
      await querier.beginTransaction();
      const count = await querier.updateMany(entity, q, payload);
      await querier.commitTransaction();
      res.json({ data: req.params.id, count });
    } catch (err: any) {
      await querier.rollbackTransaction();
      next(err);
    } finally {
      await querier.release();
    }
  });

  router.delete('/:id', async (req, res, next) => {
    const id = req.params.id as IdValue<E>;
    const q = req.query as Query<E>;
    q.$where ??= {};
    if (Array.isArray(q.$where)) {
      q.$where.push(id);
    } else {
      q.$where[meta.id as string] = id;
    }
    const querier = await getQuerier();
    try {
      await querier.beginTransaction();
      const count = await querier.deleteMany(entity, q, {
        softDelete: !!req.query.softDelete,
      });
      await querier.commitTransaction();
      res.json({ data: req.params.id, count });
    } catch (err: any) {
      await querier.rollbackTransaction();
      next(err);
    } finally {
      await querier.release();
    }
  });

  router.delete('/', async (req, res, next) => {
    const q = req.query as Query<E>;
    const querier = await getQuerier();
    let ids: IdValue<E>[] = [];
    let count = 0;
    try {
      await querier.beginTransaction();
      const founds = await querier.findMany(entity, q);
      if (founds.length) {
        ids = founds.map((found) => found[meta.id]);
        count = await querier.deleteMany(entity, { $where: ids }, { softDelete: !!req.query.softDelete });
      }
      await querier.commitTransaction();
      res.json({ data: ids, count });
    } catch (err: any) {
      await querier.rollbackTransaction();
      next(err);
    } finally {
      await querier.release();
    }
  });

  return router;
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

type ExtraOptions = {
  /**
   * Allow augment any kind of request before it runs
   */
  readonly pre?: Pre;
  /**
   * Allow augment a saving request (POST, PATCH, PUT) before it runs
   */
  readonly preSave?: PreSave;
  /**
   * Allow augment a filtering request (GET, PUT, DELETE) before it runs
   */
  readonly preFilter?: PreFilter;
};

type MiddlewareOptions = {
  readonly include?: Type<unknown>[];
  readonly exclude?: Type<unknown>[];
} & ExtraOptions;

type Pre = <E = unknown>(req: Request, meta: EntityMeta<E>) => void;
type PreSave = <E = unknown>(req: Request, meta: EntityMeta<E>) => void;
type PreFilter = <E = unknown>(req: Request, meta: EntityMeta<E>) => void;
