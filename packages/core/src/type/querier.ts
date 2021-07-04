import { Type } from './utility';
import { Query, QueryCriteria, QueryOne, QueryOptions, QuerySearch } from './query';
import { Repository, UniversalRepository } from './repository';
import { FieldValue } from './entity';

export type UniversalQuerier = {
  count<E>(entity: Type<E>, qm?: QuerySearch<E>): Promise<any>;

  findOneById<E>(entity: Type<E>, id: FieldValue<E>, qo?: QueryOne<E>): Promise<any>;

  findOne<E>(entity: Type<E>, qm: QueryOne<E>): Promise<any>;

  findManyAndCount<E>(entity: Type<E>, qm: Query<E>): Promise<any>;

  findMany<E>(entity: Type<E>, qm: Query<E>): Promise<any>;

  insertOne<E>(entity: Type<E>, payload: E): Promise<any>;

  insertMany?<E>(entity: Type<E>, payload: E[]): Promise<any>;

  updateOneById<E>(entity: Type<E>, id: FieldValue<E>, payload: E): Promise<any>;

  updateMany?<E>(entity: Type<E>, qm: QueryCriteria<E>, payload: E): Promise<any>;

  deleteOneById<E>(entity: Type<E>, id: FieldValue<E>, opts?: QueryOptions): Promise<any>;

  deleteMany<E>(entity: Type<E>, qm: QueryCriteria<E>, opts?: QueryOptions): Promise<any>;

  getRepository<E>(entity: Type<E>): UniversalRepository<E>;
};

export interface Querier extends UniversalQuerier {
  count<E>(entity: Type<E>, qm?: QuerySearch<E>): Promise<number>;

  findOneById<E>(entity: Type<E>, id: FieldValue<E>, qo?: QueryOne<E>): Promise<E>;

  findOne<E>(entity: Type<E>, qm: QueryOne<E>): Promise<E>;

  findManyAndCount<E>(entity: Type<E>, qm: Query<E>): Promise<[E[], number]>;

  findMany<E>(entity: Type<E>, qm: Query<E>): Promise<E[]>;

  insertOne<E>(entity: Type<E>, payload: E): Promise<any>;

  insertMany<E>(entity: Type<E>, payload: E[]): Promise<any[]>;

  updateOneById<E>(entity: Type<E>, id: FieldValue<E>, payload: E): Promise<number>;

  updateMany<E>(entity: Type<E>, qm: QueryCriteria<E>, payload: E): Promise<number>;

  deleteOneById<E>(entity: Type<E>, id: FieldValue<E>, opts?: QueryOptions): Promise<number>;

  deleteMany<E>(entity: Type<E>, qm: QueryCriteria<E>, opts?: QueryOptions): Promise<number>;

  getRepository<E>(entity: Type<E>): Repository<E>;

  readonly hasOpenTransaction: boolean;

  beginTransaction(): Promise<void>;

  commitTransaction(): Promise<void>;

  rollbackTransaction(): Promise<void>;

  release(): Promise<void>;
}
