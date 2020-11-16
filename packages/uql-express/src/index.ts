import { Request } from 'express-serve-static-core';
import * as express from 'express';

import { getUqlOptions, log } from 'uql/config';
import { getServerRepository } from 'uql/container';
import { getEntities } from 'uql/entity/decorator';
import { Query } from 'uql/type';
import { formatKebabCase } from 'uql/util';
import { parseQuery } from './query.util';

export function entitiesMiddleware(opts: MiddlewareOptions = {}) {
  const router = express.Router();

  let entities = opts.include || getEntities();
  if (opts.exclude) {
    entities = entities.filter((entity) => !opts.exclude.includes(entity));
  }
  if (entities.length === 0) {
    log('no entities for the uql express middleware', 'warn');
  }

  for (const type of entities) {
    const path = formatKebabCase(type.name);
    const subRouter = buildCrudRouter(type as { new (): object }, opts.extendQuery);
    router.use('/' + path, subRouter);
  }

  return router;
}

export function buildCrudRouter<T>(type: { new (): T }, extendQuery?: ExtendQuery) {
  const opts = getUqlOptions();

  const router = express.Router();

  router.post('/', async (req, res) => {
    const data = await getServerRepository(type).insertOne(req.body);
    res.json({ data });
  });

  router.put('/:id', async (req, res) => {
    await getServerRepository(type).updateOneById(req.params.id, req.body);
    res.json({ data: req.params.id });
  });

  router.get('/one', async (req, res) => {
    const qm = assembleQuery<T>(type, req, extendQuery);
    const data = await getServerRepository(type).findOne(qm);
    res.json({ data });
  });

  router.get('/count', async (req, res) => {
    const qm = assembleQuery<T>(type, req, extendQuery);
    const data = await getServerRepository(type).count(qm.filter);
    res.json({ data });
  });

  router.get('/:id', async (req, res) => {
    const qm = assembleQuery<T>(type, req, extendQuery);
    const data = await getServerRepository(type).findOneById(req.params.id, qm);
    res.json({ data });
  });

  router.get('/', async (req, res) => {
    const qm = assembleQuery<T>(type, req, extendQuery);
    const repository = getServerRepository(type);
    const json: { data?: T[]; count?: number } = {};
    const dataPromise = repository.find(qm);
    if (req.query.count || (opts.autoCount && req.query.count === undefined)) {
      const [data, count] = await Promise.all([dataPromise, repository.count(qm.filter)]);
      json.data = data;
      json.count = count;
    } else {
      json.data = await dataPromise;
    }
    res.json(json);
  });

  router.delete('/:id', async (req, res) => {
    const data = await getServerRepository(type).removeOneById(req.params.id);
    res.json({ data });
  });

  router.delete('/', async (req, res) => {
    const qm = assembleQuery(type, req, extendQuery);
    const data = await getServerRepository(type).remove(qm.filter);
    res.json({ data });
  });

  return router;
}

function assembleQuery<T>(type: { new (): T }, req: Request, extendQuery?: ExtendQuery) {
  const qm = parseQuery<T>(req.query);
  if (extendQuery) {
    return extendQuery(type, qm, req);
  }
  return qm;
}

type MiddlewareOptions = {
  include?: { new (): unknown }[];
  exclude?: { new (): unknown }[];
  extendQuery?: ExtendQuery;
};

type ExtendQuery = <T>(type: { new (): T }, qm: Query<T>, req: Request) => Query<T>;
