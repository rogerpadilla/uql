import { getEntityMeta } from 'uql/decorator';
import { Query, QueryFilter, QueryOne, QueryOptions } from './query';

/**
 * Use a class to be able to detect instances at runtime (via instanceof).
 */
export abstract class Querier<ID = any> {
  abstract insert<T>(type: { new (): T }, body: T[], opts?: QueryOptions): Promise<ID[]>;

  async insertOne<T>(type: { new (): T }, body: T, opts?: QueryOptions) {
    const ids = await this.insert(type, [body], opts);
    return ids[0];
  }

  abstract update<T>(type: { new (): T }, filter: QueryFilter<T>, body: T): Promise<number>;

  updateOneById<T>(type: { new (): T }, id: ID, body: T) {
    const meta = getEntityMeta(type);
    return this.update(type, { [meta.id.property]: id }, body);
  }

  abstract find<T>(type: { new (): T }, qm: Query<T>, opts?: QueryOptions): Promise<T[]>;

  async findOne<T>(type: { new (): T }, qm: Query<T>, opts?: QueryOptions) {
    qm.limit = 1;
    const rows = await this.find(type, qm, opts);
    return rows ? rows[0] : undefined;
  }

  async findOneById<T>(type: { new (): T }, id: ID, qo: QueryOne<T>, opts?: QueryOptions) {
    const meta = getEntityMeta(type);
    return this.findOne(type, { ...qo, filter: { [meta.id.property]: id } }, opts);
  }

  abstract remove<T>(type: { new (): T }, filter: QueryFilter<T>): Promise<number>;

  removeOneById<T>(type: { new (): T }, id: ID) {
    const meta = getEntityMeta(type);
    return this.remove(type, { [meta.id.property]: id });
  }

  abstract count<T>(type: { new (): T }, filter?: QueryFilter<T>): Promise<number>;

  abstract query(query: string): Promise<any>;

  abstract readonly hasOpenTransaction: boolean;

  abstract beginTransaction(): Promise<void>;

  abstract commitTransaction(): Promise<void>;

  abstract rollbackTransaction(): Promise<void>;

  abstract release(): Promise<void>;
}

export interface QuerierPoolOptions {
  host?: string;
  user?: string;
  password?: string;
  database?: string;
  port?: number;
}

export interface QuerierPoolConnection {
  query(query: string): Promise<any>;
  release(): void | Promise<void>;
}

export interface QuerierPool<T extends Querier = Querier> {
  getQuerier(): Promise<T>;
  end(): Promise<void>;
}
