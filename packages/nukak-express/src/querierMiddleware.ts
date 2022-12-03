import { Router as expressRouter, type Request } from 'express';
import { getQuerier } from 'nukak/options.js';
import { EntityMeta, type Type } from 'nukak/type/index.js';
import { kebabCase } from 'nukak/util/index.js';
import { getEntities, getMeta } from 'nukak/entity/decorator/index.js';
import { parseQuery } from './query.util.js';

export function querierMiddleware(opts: MiddlewareOptions = {}) {
  const router = expressRouter();

  const { include, exclude, ...extra } = opts;

  let entities = include ?? getEntities();

  if (exclude) {
    entities = entities.filter((entity) => !opts.exclude.includes(entity));
  }

  if (!entities.length) {
    throw new TypeError('no entities for the nukak express middleware');
  }

  for (const entity of entities) {
    const path = kebabCase(entity.name);
    const subRouter = buildQuerierRouter(entity, extra);
    router.use('/' + path, subRouter);
  }

  return router;
}

export function buildQuerierRouter<E>(entity: Type<E>, opts: ExtraOptions) {
  const meta = getMeta(entity);

  const router = expressRouter();

  router.use((req, res, next) => {
    pre(req, meta, opts);
    next();
  });

  router.post('/', async (req, res, next) => {
    const querier = await getQuerier();
    try {
      await querier.beginTransaction();
      const data = await querier.insertOne(entity, req.body);
      await querier.commitTransaction();
      res.json({ data });
    } catch (err: any) {
      await querier.rollbackTransaction();
      next(err);
    } finally {
      await querier.release();
    }
  });

  router.patch('/:id', async (req, res, next) => {
    req.query.$filter[meta.id as string] = req.params.id;
    const querier = await getQuerier();
    try {
      await querier.beginTransaction();
      const count = await querier.updateMany(entity, req.query, req.body);
      await querier.commitTransaction();
      res.json({ data: req.params.id, count });
    } catch (err: any) {
      await querier.rollbackTransaction();
      next(err);
    } finally {
      await querier.release();
    }
  });

  router.get('/one', async (req, res, next) => {
    const querier = await getQuerier();
    try {
      const data = await querier.findOne(entity, req.query);
      res.json({ data });
    } catch (err: any) {
      next(err);
    } finally {
      await querier.release();
    }
  });

  router.get('/count', async (req, res, next) => {
    const querier = await getQuerier();
    try {
      const count = await querier.count(entity, req.query);
      res.json({ count });
    } catch (err: any) {
      next(err);
    } finally {
      await querier.release();
    }
  });

  router.get('/:id', async (req, res, next) => {
    req.query.$filter[meta.id as string] = req.params.id;
    const querier = await getQuerier();
    try {
      const data = await querier.findOne(entity, req.query);
      res.json({ data });
    } catch (err: any) {
      next(err);
    } finally {
      await querier.release();
    }
  });

  router.get('/', async (req, res, next) => {
    const querier = await getQuerier();
    try {
      const findManyPromise = querier.findMany(entity, req.query);
      const countPromise = req.query.count ? querier.count(entity, req.query) : 0;
      const [data, count] = await Promise.all([findManyPromise, countPromise]);
      res.json({ data, count });
    } catch (err: any) {
      next(err);
    } finally {
      await querier.release();
    }
  });

  router.delete('/:id', async (req, res, next) => {
    req.query.$filter[meta.id as string] = req.params.id;
    const querier = await getQuerier();
    try {
      await querier.beginTransaction();
      const count = await querier.deleteMany(entity, req.query, {
        softDelete: !!req.query.softDelete,
      });
      await querier.commitTransaction();
      res.json({ data: req.params.id, count });
    } catch (err: any) {
      await querier.rollbackTransaction();
      next(err);
    } finally {
      querier.release();
    }
  });

  router.delete('/', async (req, res, next) => {
    const querier = await getQuerier();
    try {
      await querier.beginTransaction();
      const count = await querier.deleteMany(entity, req.query, { softDelete: !!req.query.softDelete });
      await querier.commitTransaction();
      res.json({ count });
    } catch (err: any) {
      await querier.rollbackTransaction();
      next(err);
    } finally {
      querier.release();
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
   * Allow augment a filtering request (GET, DELETE) before it runs
   */
  readonly preFilter?: PreFilter;
};

type MiddlewareOptions = {
  readonly include?: Type<any>[];
  readonly exclude?: Type<any>[];
} & ExtraOptions;

type Pre = <E = any>(req: Request, meta: EntityMeta<E>) => void;
type PreSave = <E = any>(req: Request, meta: EntityMeta<E>) => void;
type PreFilter = <E = any>(req: Request, meta: EntityMeta<E>) => void;
