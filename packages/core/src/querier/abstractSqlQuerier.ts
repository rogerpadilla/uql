import type { AbstractSqlDialect } from '../dialect/index.js';
import { getMeta } from '../entity/index.js';
import type { Query, QueryConflictPaths, QueryOptions, QuerySearch, QueryUpdateResult, Type } from '../type/index.js';
import { clone, unflatObjects } from '../util/index.js';
import { AbstractQuerier } from './abstractQuerier.js';
import { Serialized } from './decorator/index.js';

export abstract class AbstractSqlQuerier extends AbstractQuerier {
  private hasPendingTransaction?: boolean;

  constructor(readonly dialect: AbstractSqlDialect) {
    super();
  }

  /**
   * internal read query.
   */
  protected abstract internalAll<T>(query: string, values?: unknown[]): Promise<T[]>;

  /**
   * internal insert/update/delete/ddl query.
   */
  protected abstract internalRun(query: string, values?: unknown[]): Promise<QueryUpdateResult>;

  @Serialized()
  async all<T>(query: string, values?: unknown[]): Promise<T[]> {
    return this.internalAll<T>(query, values);
  }

  @Serialized()
  async run(query: string, values?: unknown[]): Promise<QueryUpdateResult> {
    return this.internalRun(query, values);
  }

  override async findMany<E>(entity: Type<E>, q: Query<E>) {
    const values: unknown[] = [];
    const query = this.dialect.find(entity, q, undefined, values);
    const res = await this.all<E>(query, values);
    const founds = unflatObjects(res);
    await this.fillToManyRelations(entity, founds, q.$select);
    return founds;
  }

  override async count<E>(entity: Type<E>, q: QuerySearch<E> = {}) {
    const values: unknown[] = [];
    const query = this.dialect.count(entity, q, undefined, values);
    const res = await this.all<{ count: number }>(query, values);
    return Number(res[0].count);
  }

  override async insertMany<E>(entity: Type<E>, payload: E[]) {
    if (!payload?.length) {
      return [];
    }
    payload = clone(payload);
    const values: unknown[] = [];
    const query = this.dialect.insert(entity, payload, undefined, values);
    const { ids } = await this.run(query, values);
    const meta = getMeta(entity);
    const payloadIds = payload.map((it, index) => {
      it[meta.id as string] ??= ids[index];
      return it[meta.id];
    });
    await this.insertRelations(entity, payload);
    return payloadIds;
  }

  override async updateMany<E>(entity: Type<E>, q: QuerySearch<E>, payload: E) {
    payload = clone(payload);
    const values: unknown[] = [];
    const query = this.dialect.update(entity, q, payload, undefined, values);
    const { changes } = await this.run(query, values);
    await this.updateRelations(entity, q, payload);
    return changes;
  }

  override async upsertOne<E>(entity: Type<E>, conflictPaths: QueryConflictPaths<E>, payload: E) {
    payload = clone(payload);
    const values: unknown[] = [];
    const query = this.dialect.upsert(entity, conflictPaths, payload, values);
    return this.run(query, values);
  }

  override async deleteMany<E>(entity: Type<E>, q: QuerySearch<E>, opts?: QueryOptions) {
    const meta = getMeta(entity);
    const values: unknown[] = [];
    // TODO: select ID should be automatic unless specified to be ommited
    const findQuery = this.dialect.find(entity, { ...q, $select: [meta.id] }, undefined, values);
    const founds = await this.all<E>(findQuery, values);
    if (!founds.length) {
      return 0;
    }
    const ids = founds.map((it) => it[meta.id]);
    const valuesDelete: unknown[] = [];
    const query = this.dialect.delete(entity, { $where: ids }, opts, valuesDelete);
    const { changes } = await this.run(query, valuesDelete);
    await this.deleteRelations(entity, ids, opts);
    return changes;
  }

  override get hasOpenTransaction() {
    return this.hasPendingTransaction;
  }

  @Serialized()
  override async beginTransaction() {
    if (this.hasPendingTransaction) {
      throw TypeError('pending transaction');
    }
    await this.internalRun(this.dialect.beginTransactionCommand);
    this.hasPendingTransaction = true;
  }

  @Serialized()
  override async commitTransaction() {
    if (!this.hasPendingTransaction) {
      throw TypeError('not a pending transaction');
    }
    await this.internalRun(this.dialect.commitTransactionCommand);
    this.hasPendingTransaction = false;
  }

  @Serialized()
  override async rollbackTransaction() {
    if (!this.hasPendingTransaction) {
      throw TypeError('not a pending transaction');
    }
    await this.internalRun(this.dialect.rollbackTransactionCommand);
    this.hasPendingTransaction = false;
  }
}
