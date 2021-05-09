import { Query, QueryFilter, QueryOne, QueryOptions } from './query';

/**
 * Use a class to be able to detect instances at runtime (via instanceof).
 */
export type Querier<ID = any> = {
  insert<E>(entity: { new (): E }, body: E[]): Promise<ID[]>;

  insertOne<E>(entity: { new (): E }, body: E): Promise<ID>;

  update<E>(entity: { new (): E }, filter: QueryFilter<E>, body: E): Promise<number>;

  updateOneById<E>(entity: { new (): E }, id: ID, body: E): Promise<number>;

  find<E>(entity: { new (): E }, qm: Query<E>, opts?: QueryOptions): Promise<E[]>;

  findOne<E>(entity: { new (): E }, qm: Query<E>, opts?: QueryOptions): Promise<E>;

  findOneById<E>(entity: { new (): E }, id: ID, qo?: QueryOne<E>, opts?: QueryOptions): Promise<E>;

  remove<E>(entity: { new (): E }, filter: QueryFilter<E>): Promise<number>;

  removeOneById<E>(entity: { new (): E }, id: ID): Promise<number>;

  count<E>(entity: { new (): E }, filter?: QueryFilter<E>): Promise<number>;

  query(query: string): Promise<any>;

  readonly hasOpenTransaction: boolean;

  beginTransaction(): Promise<void>;

  commitTransaction(): Promise<void>;

  rollbackTransaction(): Promise<void>;

  release(): Promise<void>;
};
