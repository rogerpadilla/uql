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
  protected abstract internalAll<T>(query: string): Promise<T[]>;

  /**
   * internal insert/update/delete/ddl query.
   */
  protected abstract internalRun(query: string): Promise<QueryUpdateResult>;

  @Serialized()
  async all<T>(query: string): Promise<T[]> {
    return this.internalAll<T>(query);
  }

  @Serialized()
  async run(query: string): Promise<QueryUpdateResult> {
    return this.internalRun(query);
  }

  override async findMany<E>(entity: Type<E>, q: Query<E>) {
    const query = this.dialect.find(entity, q);
    const res = await this.all<E>(query);
    const founds = unflatObjects(res);
    await this.fillToManyRelations(entity, founds, q.$select);
    return founds;
  }

  override async count<E>(entity: Type<E>, q: QuerySearch<E> = {}) {
    const query = this.dialect.count(entity, q);
    const res = await this.all<{ count: number }>(query);
    return Number(res[0].count);
  }

  override async insertMany<E>(entity: Type<E>, payload: E[]) {
    if (!payload?.length) {
      return [];
    }
    payload = clone(payload);
    const query = this.dialect.insert(entity, payload);
    const { ids } = await this.run(query);
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
    const query = this.dialect.update(entity, q, payload);
    const { changes } = await this.run(query);
    await this.updateRelations(entity, q, payload);
    return changes;
  }

  override async upsertOne<E>(entity: Type<E>, conflictPaths: QueryConflictPaths<E>, payload: E) {
    payload = clone(payload);
    const query = this.dialect.upsert(entity, conflictPaths, payload);
    return this.run(query);
  }

  override async deleteMany<E>(entity: Type<E>, q: QuerySearch<E>, opts?: QueryOptions) {
    const meta = getMeta(entity);
    // TODO: select ID should be automatic unless specified to be ommited
    const findQuery = await this.dialect.find(entity, { ...q, $select: [meta.id] });
    const founds = await this.all<E>(findQuery);
    if (!founds.length) {
      return 0;
    }
    const ids = founds.map((it) => it[meta.id]);
    const query = this.dialect.delete(entity, { $where: ids }, opts);
    const { changes } = await this.run(query);
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
