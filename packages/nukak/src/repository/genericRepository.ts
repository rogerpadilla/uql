import type {
  IdValue,
  Querier,
  QueryOptions,
  Repository,
  Type,
  QueryProject,
  QuerySearch,
  QueryCriteria,
  QueryOneCriteria,
} from '../type/index.js';

export class GenericRepository<E> implements Repository<E> {
  constructor(
    readonly entity: Type<E>,
    readonly querier: Querier,
  ) {}

  findOneById<P extends QueryProject<E>>(id: IdValue<E>, project?: P) {
    return this.querier.findOneById(this.entity, id, project);
  }

  findOne<P extends QueryProject<E>>(qm: QueryOneCriteria<E>, project?: P) {
    return this.querier.findOne(this.entity, qm, project);
  }

  findMany<P extends QueryProject<E>>(qm: QueryCriteria<E>, project?: P) {
    return this.querier.findMany(this.entity, qm, project);
  }

  findManyAndCount<P extends QueryProject<E>>(qm: QueryCriteria<E>, project?: P) {
    return this.querier.findManyAndCount(this.entity, qm, project);
  }

  count(qm?: QuerySearch<E>) {
    return this.querier.count(this.entity, qm);
  }

  insertOne(payload: E) {
    return this.querier.insertOne(this.entity, payload);
  }

  insertMany(payload: E[]) {
    return this.querier.insertMany(this.entity, payload);
  }

  updateOneById(id: IdValue<E>, payload: E) {
    return this.querier.updateOneById(this.entity, id, payload);
  }

  updateMany(qm: QuerySearch<E>, payload: E) {
    return this.querier.updateMany(this.entity, qm, payload);
  }

  saveOne(payload: E) {
    return this.querier.saveOne(this.entity, payload);
  }

  saveMany(payload: E[]) {
    return this.querier.saveMany(this.entity, payload);
  }

  deleteOneById(id: IdValue<E>, opts?: QueryOptions) {
    return this.querier.deleteOneById(this.entity, id, opts);
  }

  deleteMany(qm: QuerySearch<E>, opts?: QueryOptions) {
    return this.querier.deleteMany(this.entity, qm, opts);
  }
}
