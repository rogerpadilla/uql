import { Query, QueryFilter, QueryOne } from './query';

export type UniversalRepository<E> = {
  insertMany?(body: E[]): Promise<any>;

  insertOne(body: E): Promise<any>;

  updateMany?(filter: QueryFilter<E>, body: E): Promise<any>;

  updateOneById(id: any, body: E): Promise<any>;

  findMany(qm: Query<E>): Promise<any>;

  findOne(qm: Query<E>): Promise<any>;

  findOneById(id: any, qo?: QueryOne<E>): Promise<any>;

  deleteMany(filter: QueryFilter<E>): Promise<any>;

  deleteOneById(id: any): Promise<any>;

  count(filter?: QueryFilter<E>): Promise<any>;
};

export interface Repository<E> extends UniversalRepository<E> {
  insertMany(body: E[]): Promise<any[]>;

  insertOne(body: E): Promise<any>;

  updateMany(filter: QueryFilter<E>, body: E): Promise<number>;

  updateOneById(id: any, body: E): Promise<number>;

  findMany(qm: Query<E>): Promise<E[]>;

  findOne(qm: Query<E>): Promise<E>;

  findOneById(id: any, qo?: QueryOne<E>): Promise<E>;

  deleteMany(filter: QueryFilter<E>): Promise<number>;

  deleteOneById(id: any): Promise<number>;

  count(filter?: QueryFilter<E>): Promise<number>;
}
