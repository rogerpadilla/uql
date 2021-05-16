import { Type } from './class';
import { Query, QueryFilter, QueryOne, QueryOptions } from './query';

export type UniversalQuerier<ID = any> = {
  insert?<E>(entity: Type<E>, body: E[]): Promise<any>;

  insertOne<E>(entity: Type<E>, body: E): Promise<any>;

  update?<E>(entity: Type<E>, filter: QueryFilter<E>, body: E): Promise<any>;

  updateOneById<E>(entity: Type<E>, id: ID, body: E): Promise<any>;

  find<E>(entity: Type<E>, qm: Query<E>): Promise<any>;

  findOne<E>(entity: Type<E>, qm: Query<E>): Promise<any>;

  findOneById<E>(entity: Type<E>, id: ID, qo?: QueryOne<E>): Promise<any>;

  remove<E>(entity: Type<E>, filter: QueryFilter<E>): Promise<any>;

  removeOneById<E>(entity: Type<E>, id: ID): Promise<any>;

  count<E>(entity: Type<E>, filter?: QueryFilter<E>): Promise<any>;
};

export interface Querier<ID = any> extends UniversalQuerier<ID> {
  insert<E>(entity: Type<E>, body: E[]): Promise<ID[]>;

  insertOne<E>(entity: Type<E>, body: E): Promise<ID>;

  update<E>(entity: Type<E>, filter: QueryFilter<E>, body: E): Promise<number>;

  updateOneById<E>(entity: Type<E>, id: ID, body: E): Promise<number>;

  find<E>(entity: Type<E>, qm: Query<E>, opts?: QueryOptions): Promise<E[]>;

  findOne<E>(entity: Type<E>, qm: Query<E>, opts?: QueryOptions): Promise<E>;

  findOneById<E>(entity: Type<E>, id: ID, qo?: QueryOne<E>, opts?: QueryOptions): Promise<E>;

  remove<E>(entity: Type<E>, filter: QueryFilter<E>): Promise<number>;

  removeOneById<E>(entity: Type<E>, id: ID): Promise<number>;

  count<E>(entity: Type<E>, filter?: QueryFilter<E>): Promise<number>;

  query(query: string): Promise<any>;

  readonly hasOpenTransaction: boolean;

  beginTransaction(): Promise<void>;

  commitTransaction(): Promise<void>;

  rollbackTransaction(): Promise<void>;

  release(): Promise<void>;
}
