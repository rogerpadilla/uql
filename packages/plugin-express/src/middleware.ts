import { Request, Response } from 'express-serve-static-core';
import * as express from 'express';

import { getOptions } from '@uql/core/options';
import { Query } from '@uql/core/type';
import { formatKebabCase } from '@uql/core/util';
import { getEntities } from '@uql/core/entity/decorator';
import { getQuerier } from '@uql/core/querier';
import { parseQuery } from './query.util';

export function entitiesMiddleware(opts: MiddlewareOptions = {}) {
  const router = express.Router();
  const options = getOptions();

  let entities = opts.include || getEntities();
  if (opts.exclude) {
    entities = entities.filter((entity) => !opts.exclude.includes(entity));
  }
  if (entities.length === 0) {
    options.logger('no entities for the uql express middleware');
  }

  const crudRouterOpts = {
    extendQuery: opts.extendQuery,
    autoCount: options.autoCount,
  };

  for (const type of entities) {
    const path = formatKebabCase(type.name);
    const subRouter = buildCrudRouter(type, crudRouterOpts);
    router.use('/' + path, subRouter);
  }

  return router;
}

export function buildCrudRouter<T>(type: { new (): T }, opts: { extendQuery?: ExtendQuery; autoCount?: boolean }) {
  const router = express.Router();

  router.post('/', async (req, res) => {
    const querier = await getQuerier();
    try {
      await querier.beginTransaction();
      const data = await querier.insertOne(type, req.body);
      await querier.commitTransaction();
      res.json({ data });
    } catch (err) {
      await querier.rollbackTransaction();
      sendError(err, res);
    } finally {
      await querier.release();
    }
  });

  router.put('/:id', async (req, res) => {
    const querier = await getQuerier();
    try {
      await querier.beginTransaction();
      await querier.updateOneById(type, req.params.id, req.body);
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
    const qm = assembleQuery<T>(type, req, opts.extendQuery);
    const querier = await getQuerier();
    try {
      const data = await querier.findOne(type, qm);
      res.json({ data });
    } catch (err) {
      sendError(err, res);
    } finally {
      await querier.release();
    }
  });

  router.get('/count', async (req, res) => {
    const qm = assembleQuery<T>(type, req, opts.extendQuery);
    const querier = await getQuerier();
    try {
      const data = await querier.count(type, qm.filter);
      res.json({ data });
    } catch (err) {
      sendError(err, res);
    } finally {
      await querier.release();
    }
  });

  router.get('/:id', async (req, res) => {
    const qm = assembleQuery<T>(type, req, opts.extendQuery);
    const querier = await getQuerier();
    try {
      const data = await querier.findOneById(type, req.params.id, qm);
      res.json({ data });
    } catch (err) {
      sendError(err, res);
    } finally {
      await querier.release();
    }
  });

  router.get('/', async (req, res) => {
    const qm = assembleQuery<T>(type, req, opts.extendQuery);
    const querier = await getQuerier();
    try {
      const json: { data?: T[]; count?: number } = {};
      const dataPromise = querier.find(type, qm);
      if (req.query.count || (opts.autoCount && req.query.count === undefined)) {
        const [data, count] = await Promise.all([dataPromise, querier.count(type, qm.filter)]);
        json.data = data;
        json.count = count;
      } else {
        json.data = await dataPromise;
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
      const data = await querier.removeOneById(type, req.params.id);
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
    const qm = assembleQuery(type, req, opts.extendQuery);
    const querier = await getQuerier();
    try {
      await querier.beginTransaction();
      const data = await querier.remove(type, qm.filter);
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

function assembleQuery<T>(type: { new (): T }, req: Request, extendQuery?: ExtendQuery) {
  const qm = parseQuery<T>(req.query);
  return extendQuery ? extendQuery(type, qm, req) : qm;
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
  include?: { new (): any }[];
  exclude?: { new (): any }[];
  extendQuery?: ExtendQuery;
};

type ExtendQuery = <T>(type: { new (): T }, qm: Query<T>, req: Request) => Query<T>;
