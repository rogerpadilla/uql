import { Type } from './utility';
import { Query, QueryCriteria, QueryOne } from './query';
import { Repository, UniversalRepository } from './repository';

export type UniversalQuerier = {
  insertMany?<E>(entity: Type<E>, payload: E[]): Promise<any>;

  insertOne<E>(entity: Type<E>, payload: E): Promise<any>;

  updateMany?<E>(entity: Type<E>, payload: E, qm: QueryCriteria<E>): Promise<any>;

  updateOneById<E>(entity: Type<E>, payload: E, id: any): Promise<any>;

  findMany<E>(entity: Type<E>, qm: Query<E>): Promise<any>;

  findOne<E>(entity: Type<E>, qm: QueryOne<E>): Promise<any>;

  findOneById<E>(entity: Type<E>, id: any, qo?: QueryOne<E>): Promise<any>;

  deleteMany<E>(entity: Type<E>, qm: QueryCriteria<E>): Promise<any>;

  deleteOneById<E>(entity: Type<E>, id: any): Promise<any>;

  count<E>(entity: Type<E>, qm?: QueryCriteria<E>): Promise<any>;

  getRepository<E>(entity: Type<E>): UniversalRepository<E>;
};

export interface Querier extends UniversalQuerier {
  insertMany<E>(entity: Type<E>, payload: E[]): Promise<any[]>;

  insertOne<E>(entity: Type<E>, payload: E): Promise<any>;

  updateMany<E>(entity: Type<E>, payload: E, qm: QueryCriteria<E>): Promise<number>;

  updateOneById<E>(entity: Type<E>, payload: E, id: any): Promise<number>;

  findMany<E>(entity: Type<E>, qm: Query<E>): Promise<E[]>;

  findOne<E>(entity: Type<E>, qm: QueryOne<E>): Promise<E>;

  findOneById<E>(entity: Type<E>, id: any, qo?: QueryOne<E>): Promise<E>;

  deleteMany<E>(entity: Type<E>, qm: QueryCriteria<E>): Promise<number>;

  deleteOneById<E>(entity: Type<E>, id: any): Promise<number>;

  count<E>(entity: Type<E>, qm?: QueryCriteria<E>): Promise<number>;

  readonly hasOpenTransaction: boolean;

  beginTransaction(): Promise<void>;

  commitTransaction(): Promise<void>;

  rollbackTransaction(): Promise<void>;

  release(): Promise<void>;

  getRepository<E>(entity: Type<E>): Repository<E>;
}
