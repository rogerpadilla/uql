import * as express from 'express';
import { Request } from 'express-serve-static-core';

import { Query } from 'uql/type';
import { buildQuery, formatKebabCase } from 'uql/util';
import { getServerRepository } from 'uql/repository/container';
import { getEntities } from 'uql/entity';

export function entitiesMiddleware(opts: MiddlewareOptions = {}) {
  const router = express.Router();

  let entities = opts.include || getEntities();
  if (opts.exclude) {
    entities = entities.filter((entity) => !opts.exclude.includes(entity));
  }
  if (entities.length === 0) {
    console.warn('No entities for the uql express middleware');
  }

  for (const type of entities) {
    const path = formatKebabCase(type.name);
    const subRouter = buildCrudRouter(type as { new (): object }, opts.extendQuery);
    router.use('/' + path, subRouter);
  }

  return router;
}

export function buildCrudRouter<T>(type: { new (): T }, extendQuery?: ExtendQuery) {
  const router = express.Router();

  router.post('/', async (req, res) => {
    const id = await getServerRepository(type).insertOne(req.body);
    res.json({ data: id });
  });

  router.put('/:id', async (req, res) => {
    await getServerRepository(type).updateOneById(req.params.id, req.body);
    res.json({ data: req.params.id });
  });

  router.get('/one', async (req, res) => {
    const qm = assembleQuery<T>(type, req, extendQuery);
    const model = await getServerRepository(type).findOne(qm);
    res.json({ data: model });
  });

  router.get('/:id', async (req, res) => {
    const qm = assembleQuery<T>(type, req, extendQuery);
    const model = await getServerRepository(type).findOneById(req.params.id, qm);
    res.json({ data: model });
  });

  router.get('/', async (req, res) => {
    const qm = assembleQuery<T>(type, req, extendQuery);
    const models = await getServerRepository(type).find(qm);
    res.json({ data: models });
  });

  router.delete('/:id', async (req, res) => {
    const affectedRows = await getServerRepository(type).removeOneById(req.params.id);
    res.json({ data: affectedRows });
  });

  router.delete('/', async (req, res) => {
    const qm = assembleQuery(type, req, extendQuery);
    const affectedRows = await getServerRepository(type).remove(qm.filter);
    res.json({ data: affectedRows });
  });

  return router;
}

function assembleQuery<T>(type: { new (): T }, req: Request, extendQuery?: ExtendQuery) {
  const qm = buildQuery<T>(req.query);
  if (extendQuery) {
    return extendQuery(type, qm, req);
  }
  return qm;
}

type MiddlewareOptions = {
  include?: { new (): any }[];
  exclude?: { new (): any }[];
  extendQuery?: ExtendQuery;
};

type ExtendQuery = <T>(type: { new (): T }, qm: Query<T>, req: Request) => Query<T>;
