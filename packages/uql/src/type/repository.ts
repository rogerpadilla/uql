import { EntityMeta } from './entity';
import { QuerierContract } from './querier';
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

export interface Repository<T, ID = any> extends IsomorphicRepository<T, ID> {
  insertOne(body: T, querier?: QuerierContract<ID>): Promise<ID>;
  updateOneById(id: ID, body: T, querier?: QuerierContract<ID>): Promise<number>;
  saveOne(body: T, querier?: QuerierContract<ID>): Promise<ID>;
  find(qm: Query<T>, querier?: QuerierContract<ID>): Promise<T[]>;
  findOne(qm: Query<T>, querier?: QuerierContract<ID>): Promise<T>;
  findOneById(id: ID, qo?: QueryOne<T>, querier?: QuerierContract<ID>): Promise<T>;
  remove(filter: QueryFilter<T>, querier?: QuerierContract<ID>): Promise<number>;
  removeOneById(id: ID, querier?: QuerierContract<ID>): Promise<number>;
  count(filter: QueryFilter<T>, querier?: QuerierContract<ID>): Promise<number>;
}

export type GenericRepositoryClass<T, ID = any> = new (type: { new (): T }) => IsomorphicRepository<T, ID>;
