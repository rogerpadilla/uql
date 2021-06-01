import { Query, QueryCriteria, QueryOne } from './query';

export type UniversalRepository<E> = {
  insertMany?(body: E[]): Promise<any>;

  insertOne(body: E): Promise<any>;

  updateMany?(body: E, qm: QueryCriteria<E>): Promise<any>;

  updateOneById(body: E, id: any): Promise<any>;

  findMany(qm: Query<E>): Promise<any>;

  findOne(qm: QueryOne<E>): Promise<any>;

  findOneById(id: any, qo?: QueryOne<E>): Promise<any>;

  deleteMany(qm: QueryCriteria<E>): Promise<any>;

  deleteOneById(id: any): Promise<any>;

  count(qm: QueryCriteria<E>): Promise<any>;
};

export interface Repository<E> extends UniversalRepository<E> {
  insertMany(body: E[]): Promise<any[]>;

  insertOne(body: E): Promise<any>;

  updateMany(body: E, qm: QueryCriteria<E>): Promise<number>;

  updateOneById(body: E, id: any): Promise<number>;

  findMany(qm: Query<E>): Promise<E[]>;

  findOne(qm: QueryOne<E>): Promise<E>;

  findOneById(id: any, qm?: QueryOne<E>): Promise<E>;

  deleteMany(qm: QueryCriteria<E>): Promise<number>;

  deleteOneById(id: any): Promise<number>;

  count(qm: QueryCriteria<E>): Promise<number>;
}
