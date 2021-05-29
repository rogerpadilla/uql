import { Type } from './utility';
import { Query, QueryFilter, QueryOne } from './query';

export type UniversalQuerier = {
  insertMany?<E>(entity: Type<E>, body: E[]): Promise<any>;

  insertOne<E>(entity: Type<E>, body: E): Promise<any>;

  updateMany?<E>(entity: Type<E>, filter: QueryFilter<E>, body: E): Promise<any>;

  updateOneById<E>(entity: Type<E>, id: any, body: E): Promise<any>;

  findMany<E>(entity: Type<E>, qm: Query<E>): Promise<any>;

  findOne<E>(entity: Type<E>, qm: Query<E>): Promise<any>;

  findOneById<E>(entity: Type<E>, id: any, qo?: QueryOne<E>): Promise<any>;

  removeMany<E>(entity: Type<E>, filter: QueryFilter<E>): Promise<any>;

  removeOneById<E>(entity: Type<E>, id: any): Promise<any>;

  count<E>(entity: Type<E>, filter?: QueryFilter<E>): Promise<any>;
};

export interface Querier extends UniversalQuerier {
  insertMany<E>(entity: Type<E>, body: E[]): Promise<any[]>;

  insertOne<E>(entity: Type<E>, body: E): Promise<any>;

  updateMany<E>(entity: Type<E>, filter: QueryFilter<E>, body: E): Promise<number>;

  updateOneById<E>(entity: Type<E>, id: any, body: E): Promise<number>;

  findMany<E>(entity: Type<E>, qm: Query<E>): Promise<E[]>;

  findOne<E>(entity: Type<E>, qm: Query<E>): Promise<E>;

  findOneById<E>(entity: Type<E>, id: any, qo?: QueryOne<E>): Promise<E>;

  removeMany<E>(entity: Type<E>, filter: QueryFilter<E>): Promise<number>;

  removeOneById<E>(entity: Type<E>, id: any): Promise<number>;

  count<E>(entity: Type<E>, filter?: QueryFilter<E>): Promise<number>;

  readonly hasOpenTransaction: boolean;

  beginTransaction(): Promise<void>;

  commitTransaction(): Promise<void>;

  rollbackTransaction(): Promise<void>;

  release(): Promise<void>;
}
