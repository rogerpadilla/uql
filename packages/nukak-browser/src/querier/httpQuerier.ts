import { getMeta } from 'nukak/entity';
import type {
  IdValue,
  Query,
  QueryCriteria,
  QueryOne,
  QueryOptions,
  QueryProject,
  QuerySearch,
  Type,
} from 'nukak/type';
import { kebabCase } from 'nukak/util';
import type { RequestOptions, RequestFindOptions, ClientQuerier, ClientRepository } from '../type/index.js';
import { get, post, patch, remove } from '../http/index.js';
import { stringifyQuery } from './querier.util.js';
import { GenericClientRepository } from './genericClientRepository.js';

export class HttpQuerier implements ClientQuerier {
  constructor(readonly basePath: string) {}

  findOneById<E>(entity: Type<E>, id: IdValue<E>, project?: QueryProject<E>, opts?: RequestOptions) {
    const qm = { $project: project } satisfies Query<E>;
    const basePath = this.getBasePath(entity);
    const qs = stringifyQuery(qm);
    return get<E>(`${basePath}/${id}${qs}`, opts);
  }

  findOne<E>(entity: Type<E>, qm: QueryOne<E>, project?: QueryProject<E>, opts?: RequestOptions) {
    const q = { ...qm, $project: project } satisfies Query<E>;
    const basePath = this.getBasePath(entity);
    const qs = stringifyQuery(q);
    return get<E>(`${basePath}/one${qs}`, opts);
  }

  findMany<E>(entity: Type<E>, qm: QueryCriteria<E>, project?: QueryProject<E>, opts?: RequestFindOptions) {
    const data: Query<E> & Pick<typeof opts, 'count'> = { ...qm, $project: project };
    if (opts?.count) {
      data.count = true;
    }
    const basePath = this.getBasePath(entity);
    const qs = stringifyQuery(data);
    return get<E[]>(`${basePath}${qs}`, opts);
  }

  findManyAndCount<E>(entity: Type<E>, qm: QueryCriteria<E>, project?: QueryProject<E>, opts?: RequestFindOptions) {
    return this.findMany(entity, qm, project, { ...opts, count: true });
  }

  count<E>(entity: Type<E>, qm: QuerySearch<E>, opts?: RequestOptions) {
    const basePath = this.getBasePath(entity);
    const qs = stringifyQuery(qm);
    return get<number>(`${basePath}/count${qs}`, opts);
  }

  insertOne<E>(entity: Type<E>, payload: E, opts?: RequestOptions) {
    const basePath = this.getBasePath(entity);
    return post<any>(basePath, payload, opts);
  }

  updateOneById<E>(entity: Type<E>, id: IdValue<E>, payload: E, opts?: RequestOptions) {
    const basePath = this.getBasePath(entity);
    return patch<typeof id>(`${basePath}/${id}`, payload, opts);
  }

  saveOne<E>(entity: Type<E>, payload: E, opts?: RequestOptions) {
    const meta = getMeta(entity);
    const id = payload[meta.id];
    if (id) {
      return this.updateOneById(entity, id, payload, opts).then(() => ({ data: id }));
    }
    return this.insertOne(entity, payload, opts);
  }

  deleteOneById<E>(entity: Type<E>, id: IdValue<E>, opts: QueryOptions & RequestOptions = {}) {
    const basePath = this.getBasePath(entity);
    const qs = opts.softDelete ? stringifyQuery({ softDelete: opts.softDelete }) : '';
    return remove<typeof id>(`${basePath}/${id}${qs}`, opts);
  }

  deleteMany<E>(entity: Type<E>, qm: QuerySearch<E>, opts: QueryOptions & RequestOptions = {}) {
    const basePath = this.getBasePath(entity);
    const qs = stringifyQuery(opts.softDelete ? { ...qm, softDelete: opts.softDelete } : qm);
    return remove<IdValue<E>[]>(`${basePath}${qs}`, opts);
  }

  getRepository<E>(entity: Type<E>): ClientRepository<E> {
    return new GenericClientRepository(entity, this);
  }

  getBasePath<E>(entity: Type<E>) {
    return this.basePath + '/' + kebabCase(entity.name);
  }
}
