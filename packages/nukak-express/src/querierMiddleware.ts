import { Request } from 'express-serve-static-core';
import { Router as expressRouter } from 'express';

import { getQuerier } from 'nukak/options.js';
import { EntityMeta, IdValue, Query, QueryOne, QueryUnique, Type } from 'nukak/type/index.js';
import { kebabCase } from 'nukak/util/index.js';
import { getEntities, getMeta } from 'nukak/entity/decorator/index.js';
import { parseQuery } from './query.util.js';

export function querierMiddleware(opts: MiddlewareOptions = {}) {
  const router = expressRouter();

  let entities = opts.include ?? getEntities();

  if (opts.exclude) {
    entities = entities.filter((entity) => !opts.exclude.includes(entity));
  }

  if (!entities.length) {
    throw new TypeError('no entities for the nukak express middleware');
  }

  const crudRouterOpts = {
    augmentQuery: opts.augmentQuery,
  };

  for (const entity of entities) {
    const path = kebabCase(entity.name);
    const subRouter = buildQuerierRouter(entity, crudRouterOpts);
    router.use('/' + path, subRouter);
  }

  return router;
}

export function buildQuerierRouter<E>(entity: Type<E>, opts: { augmentQuery?: AugmentQueryCallback }) {
  const router = expressRouter();

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
    const querier = await getQuerier();
    try {
      await querier.beginTransaction();
      await querier.updateOneById(entity, req.params.id, req.body);
      await querier.commitTransaction();
      res.json({ data: req.params.id });
    } catch (err: any) {
      await querier.rollbackTransaction();
      next(err);
    } finally {
      await querier.release();
    }
  });

  router.get('/one', async (req, res, next) => {
    const qm = extendQuery<E>(entity, req, opts.augmentQuery) as QueryOne<E>;
    const querier = await getQuerier();
    try {
      const data = await querier.findOne(entity, qm);
      res.json({ data });
    } catch (err: any) {
      next(err);
    } finally {
      await querier.release();
    }
  });

  router.get('/count', async (req, res, next) => {
    const qm = extendQuery<E>(entity, req, opts.augmentQuery);
    const querier = await getQuerier();
    try {
      const data = await querier.count(entity, qm);
      res.json({ data });
    } catch (err: any) {
      next(err);
    } finally {
      await querier.release();
    }
  });

  router.get('/:id', async (req, res, next) => {
    const qm = extendQuery<E>(entity, req, opts.augmentQuery) as QueryUnique<E>;
    const querier = await getQuerier();
    try {
      const data = await querier.findOneById(entity, req.params.id as unknown as IdValue<E>, qm);
      res.json({ data });
    } catch (err: any) {
      next(err);
    } finally {
      await querier.release();
    }
  });

  router.get('/', async (req, res, next) => {
    const qm = extendQuery<E>(entity, req, opts.augmentQuery);
    const querier = await getQuerier();
    try {
      const json: { data?: E[]; count?: number } = {};
      const findManyPromise = querier.findMany(entity, qm);
      if (req.query.count) {
        const countPromise = querier.count(entity, qm);
        const [data, count] = await Promise.all([findManyPromise, countPromise]);
        json.data = data;
        json.count = count;
      } else {
        json.data = await findManyPromise;
      }
      res.json(json);
    } catch (err: any) {
      next(err);
    } finally {
      await querier.release();
    }
  });

  router.delete('/:id', async (req, res, next) => {
    const querier = await getQuerier();
    try {
      await querier.beginTransaction();
      const data = await querier.deleteOneById(entity, req.params.id as unknown as IdValue<E>, {
        softDelete: !!req.query.softDelete,
      });
      await querier.commitTransaction();
      res.json({ data });
    } catch (err: any) {
      await querier.rollbackTransaction();
      next(err);
    } finally {
      querier.release();
    }
  });

  router.delete('/', async (req, res, next) => {
    const qm = extendQuery(entity, req, opts.augmentQuery);
    const querier = await getQuerier();
    try {
      await querier.beginTransaction();
      const data = await querier.deleteMany(entity, qm, { softDelete: !!req.query.softDelete });
      await querier.commitTransaction();
      res.json({ data });
    } catch (err: any) {
      await querier.rollbackTransaction();
      next(err);
    } finally {
      querier.release();
    }
  });

  return router;
}

function extendQuery<E>(entity: Type<E>, req: Request, augmentQuery?: AugmentQueryCallback) {
  const meta = getMeta(entity);
  const qm = parseQuery<E>(req.query);
  return augmentQuery ? augmentQuery(meta, qm, req) : qm;
}

type MiddlewareOptions = {
  include?: Type<any>[];
  exclude?: Type<any>[];
  augmentQuery?: AugmentQueryCallback;
};

type AugmentQueryCallback = <E>(meta: EntityMeta<E>, qm: Query<E>, req: Request) => Query<E>;
