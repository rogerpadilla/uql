import { Query, QueryFilter, QueryOne, QueryOptions } from './query';

export type UniversalRepository<E, ID = any> = {
  insertMany?(body: E[]): Promise<any>;

  insertOne(body: E): Promise<any>;

  updateMany?(filter: QueryFilter<E>, body: E): Promise<any>;

  updateOneById(id: ID, body: E): Promise<any>;

  findMany(qm: Query<E>): Promise<any>;

  findOne(qm: Query<E>): Promise<any>;

  findOneById(id: ID, qo?: QueryOne<E>): Promise<any>;

  removeMany(filter: QueryFilter<E>): Promise<any>;

  removeOneById(id: ID): Promise<any>;

  count(filter?: QueryFilter<E>): Promise<any>;
};

export interface Repository<E, ID = any> extends UniversalRepository<E, ID> {
  insertMany(body: E[]): Promise<ID[]>;

  insertOne(body: E): Promise<ID>;

  updateMany(filter: QueryFilter<E>, body: E): Promise<number>;

  updateOneById(id: ID, body: E): Promise<number>;

  findMany(qm: Query<E>, opts?: QueryOptions): Promise<E[]>;

  findOne(qm: Query<E>, opts?: QueryOptions): Promise<E>;

  findOneById(id: ID, qo?: QueryOne<E>, opts?: QueryOptions): Promise<E>;

  removeMany(filter: QueryFilter<E>): Promise<number>;

  removeOneById(id: ID): Promise<number>;

  count(filter?: QueryFilter<E>): Promise<number>;
}
