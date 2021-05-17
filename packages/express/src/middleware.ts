import { Request, Response } from 'express-serve-static-core';
import { Router as expressRouter } from 'express';

import { getOptions, getQuerier } from '@uql/core/options';
import { Query, Type } from '@uql/core/type';
import { kebabCase } from '@uql/core/util';
import { getEntities } from '@uql/core/entity/decorator';
import { parseQuery } from './query.util';

export function entitiesMiddleware(opts: MiddlewareOptions = {}) {
  const router = expressRouter();
  const { logger } = getOptions();

  let entities = opts.include ?? getEntities();
  if (opts.exclude) {
    entities = entities.filter((entity) => !opts.exclude.includes(entity));
  }
  if (entities.length === 0) {
    logger('no entities for the uql express middleware');
  }

  const crudRouterOpts = {
    extendQuery: opts.extendQuery,
  };

  for (const entity of entities) {
    const path = kebabCase(entity.name);
    const subRouter = buildCrudRouter(entity, crudRouterOpts);
    router.use('/' + path, subRouter);
  }

  return router;
}

export function buildCrudRouter<E>(entity: Type<E>, opts: { extendQuery?: ExtendQuery }) {
  const router = expressRouter();

  router.post('/', async (req, res) => {
    const querier = await getQuerier();
    try {
      await querier.beginTransaction();
      const data = await querier.insertOne(entity, req.body);
      await querier.commitTransaction();
      res.json({ data });
    } catch (err) {
      await querier.rollbackTransaction();
      sendError(err, res);
    } finally {
      await querier.release();
    }
  });

  router.patch('/:id', async (req, res) => {
    const querier = await getQuerier();
    try {
      await querier.beginTransaction();
      await querier.updateOneById(entity, req.params.id, req.body);
      await querier.commitTransaction();
      res.json({ data: req.params.id });
    } catch (err) {
      await querier.rollbackTransaction();
      sendError(err, res);
    } finally {
      await querier.release();
    }
  });

  router.get('/one', async (req, res) => {
    const qm = assembleQuery<E>(entity, req, opts.extendQuery);
    const querier = await getQuerier();
    try {
      const data = await querier.findOne(entity, qm);
      res.json({ data });
    } catch (err) {
      sendError(err, res);
    } finally {
      await querier.release();
    }
  });

  router.get('/count', async (req, res) => {
    const qm = assembleQuery<E>(entity, req, opts.extendQuery);
    const querier = await getQuerier();
    try {
      const data = await querier.count(entity, qm.filter);
      res.json({ data });
    } catch (err) {
      sendError(err, res);
    } finally {
      await querier.release();
    }
  });

  router.get('/:id', async (req, res) => {
    const qm = assembleQuery<E>(entity, req, opts.extendQuery);
    const querier = await getQuerier();
    try {
      const data = await querier.findOneById(entity, req.params.id, qm);
      res.json({ data });
    } catch (err) {
      sendError(err, res);
    } finally {
      await querier.release();
    }
  });

  router.get('/', async (req, res) => {
    const qm = assembleQuery<E>(entity, req, opts.extendQuery);
    const querier = await getQuerier();
    try {
      const json: { data?: E[]; count?: number } = {};
      const findManyPromise = querier.findMany(entity, qm);
      if (req.query.count) {
        const countPromise = querier.count(entity, qm.filter);
        const [data, count] = await Promise.all([findManyPromise, countPromise]);
        json.data = data;
        json.count = count;
      } else {
        json.data = await findManyPromise;
      }
      res.json(json);
    } catch (err) {
      sendError(err, res);
    } finally {
      await querier.release();
    }
  });

  router.delete('/:id', async (req, res) => {
    const querier = await getQuerier();
    try {
      await querier.beginTransaction();
      const data = await querier.removeOneById(entity, req.params.id);
      await querier.commitTransaction();
      res.json({ data });
    } catch (err) {
      await querier.rollbackTransaction();
      sendError(err, res);
    } finally {
      querier.release();
    }
  });

  router.delete('/', async (req, res) => {
    const qm = assembleQuery(entity, req, opts.extendQuery);
    const querier = await getQuerier();
    try {
      await querier.beginTransaction();
      const data = await querier.removeMany(entity, qm.filter);
      await querier.commitTransaction();
      res.json({ data });
    } catch (err) {
      await querier.rollbackTransaction();
      sendError(err, res);
    } finally {
      querier.release();
    }
  });

  return router;
}

function assembleQuery<E>(entity: Type<E>, req: Request, extendQuery?: ExtendQuery) {
  const qm = parseQuery<E>(req.query);
  return extendQuery ? extendQuery(entity, qm, req) : qm;
}

function sendError(err: Error, res: Response) {
  // TODO proper error codes
  const code = 500;
  res.sendStatus(code).json({
    error: {
      message: err.message,
      code,
    },
  });
}

type MiddlewareOptions = {
  include?: Type<any>[];
  exclude?: Type<any>[];
  extendQuery?: ExtendQuery;
};

type ExtendQuery = <E>(entity: Type<E>, qm: Query<E>, req: Request) => Query<E>;
