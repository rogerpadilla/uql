import { Type } from './class';
import { Query, QueryFilter, QueryOne, QueryOptions } from './query';

/**
 * Use a class to be able to detect instances at runtime (via instanceof).
 */
export type Querier<ID = any> = {
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
};
