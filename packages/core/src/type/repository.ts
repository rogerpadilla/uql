import { FieldValue } from './entity';
import { Query, QueryCriteria, QueryOne, QueryOptions } from './query';

export type UniversalRepository<E> = {
  insertMany?(payload: E[]): Promise<any>;

  insertOne(payload: E): Promise<any>;

  updateMany?(payload: E, qm: QueryCriteria<E>): Promise<any>;

  updateOneById(payload: E, id: FieldValue<E>): Promise<any>;

  findMany(qm: Query<E>): Promise<any>;

  findOne(qm: QueryOne<E>): Promise<any>;

  findOneById(id: FieldValue<E>, qo?: QueryOne<E>): Promise<any>;

  deleteMany(qm: QueryCriteria<E>, opts?: QueryOptions): Promise<any>;

  deleteOneById(id: FieldValue<E>, opts?: QueryOptions): Promise<any>;

  count(qm: QueryCriteria<E>): Promise<any>;
};

export interface Repository<E> extends UniversalRepository<E> {
  insertMany(payload: E[]): Promise<any[]>;

  insertOne(payload: E): Promise<any>;

  updateMany(payload: E, qm: QueryCriteria<E>): Promise<number>;

  updateOneById(payload: E, id: FieldValue<E>): Promise<number>;

  findMany(qm: Query<E>): Promise<E[]>;

  findOne(qm: QueryOne<E>): Promise<E>;

  findOneById(id: FieldValue<E>, qm?: QueryOne<E>): Promise<E>;

  deleteMany(qm: QueryCriteria<E>, opts?: QueryOptions): Promise<number>;

  deleteOneById(id: FieldValue<E>, opts?: QueryOptions): Promise<number>;

  count(qm: QueryCriteria<E>): Promise<number>;
}
