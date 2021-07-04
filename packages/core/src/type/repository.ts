import { FieldValue } from './entity';
import { Query, QueryCriteria, QueryOne, QueryOptions, QuerySearch } from './query';

export type UniversalRepository<E> = {
  count(qm: QuerySearch<E>): Promise<any>;

  findOneById(id: FieldValue<E>, qo?: QueryOne<E>): Promise<any>;

  findOne(qm: QueryOne<E>): Promise<any>;

  findMany(qm: Query<E>): Promise<any>;

  findManyAndCount(qm: Query<E>): Promise<any>;

  deleteOneById(id: FieldValue<E>, opts?: QueryOptions): Promise<any>;

  deleteMany(qm: QueryCriteria<E>, opts?: QueryOptions): Promise<any>;

  insertOne(payload: E): Promise<any>;

  insertMany?(payload: E[]): Promise<any>;

  updateOneById(id: FieldValue<E>, payload: E): Promise<any>;

  updateMany?(qm: QueryCriteria<E>, payload: E): Promise<any>;
};

export interface Repository<E> extends UniversalRepository<E> {
  count(qm: QueryCriteria<E>): Promise<number>;

  findOneById(id: FieldValue<E>, qm?: QueryOne<E>): Promise<E>;

  findOne(qm: QueryOne<E>): Promise<E>;

  findMany(qm: Query<E>): Promise<E[]>;

  findManyAndCount(qm: Query<E>): Promise<[E[], number]>;

  insertOne(payload: E): Promise<any>;

  insertMany(payload: E[]): Promise<any[]>;

  updateOneById(id: FieldValue<E>, payload: E): Promise<number>;

  updateMany(qm: QueryCriteria<E>, payload: E): Promise<number>;

  deleteOneById(id: FieldValue<E>, opts?: QueryOptions): Promise<number>;

  deleteMany(qm: QueryCriteria<E>, opts?: QueryOptions): Promise<number>;
}
