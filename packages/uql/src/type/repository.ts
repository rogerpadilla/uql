import { EntityMeta } from './entity';
import { Querier } from './querier';
import { Query, QueryFilter, QueryOne } from './query';

export interface IsomorphicRepository<T, ID = any> {
  readonly meta: EntityMeta<T>;
  insertOne(body: T): Promise<any>;
  updateOneById(id: ID, body: T): Promise<any>;
  saveOne(body: T): Promise<any>;
  find(qm: Query<T>): Promise<any>;
  findOne(qm: Query<T>): Promise<any>;
  findOneById(id: ID, qo?: QueryOne<T>): Promise<any>;
  remove(filter: QueryFilter<T>): Promise<any>;
  removeOneById(id: ID): Promise<any>;
  count(filter: QueryFilter<T>): Promise<any>;
}

export interface ServerRepository<T, ID = any> extends IsomorphicRepository<T, ID> {
  insertOne(body: T, querier?: Querier<ID>): Promise<ID>;
  updateOneById(id: ID, body: T, querier?: Querier<ID>): Promise<number>;
  saveOne(body: T, querier?: Querier<ID>): Promise<ID>;
  find(qm: Query<T>, querier?: Querier<ID>): Promise<T[]>;
  findOne(qm: Query<T>, querier?: Querier<ID>): Promise<T>;
  findOneById(id: ID, qo?: QueryOne<T>, querier?: Querier<ID>): Promise<T>;
  remove(filter: QueryFilter<T>, querier?: Querier<ID>): Promise<number>;
  removeOneById(id: ID, querier?: Querier<ID>): Promise<number>;
  count(filter: QueryFilter<T>, querier?: Querier<ID>): Promise<number>;
}

export type CustomRepositoryConstructor<T, ID = any> = new () => IsomorphicRepository<T, ID>;

export type GenericRepositoryConstructor<T, ID = any> = new (type: { new (): T }) => IsomorphicRepository<T, ID>;
