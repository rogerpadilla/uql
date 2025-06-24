import type {
  IdValue,
  Querier,
  Query,
  QueryConflictPaths,
  QueryOne,
  QueryOptions,
  QuerySearch,
  Repository,
  Type,
} from '../type/index.js';

export class GenericRepository<E> implements Repository<E> {
  constructor(
    readonly entity: Type<E>,
    readonly querier: Querier,
  ) {}

  findOneById(id: IdValue<E>, q?: QueryOne<E>) {
    return this.querier.findOneById(this.entity, id, q);
  }

  findOne(q: QueryOne<E>) {
    return this.querier.findOne(this.entity, q);
  }

  findMany(q: Query<E>) {
    return this.querier.findMany(this.entity, q);
  }

  findManyAndCount(q: Query<E>) {
    return this.querier.findManyAndCount(this.entity, q);
  }

  count(q?: QuerySearch<E>) {
    return this.querier.count(this.entity, q);
  }

  insertOne(payload: E) {
    return this.querier.insertOne(this.entity, payload);
  }

  upsertOne(conflictPaths: QueryConflictPaths<E>, payload: E) {
    return this.querier.upsertOne(this.entity, conflictPaths, payload);
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
