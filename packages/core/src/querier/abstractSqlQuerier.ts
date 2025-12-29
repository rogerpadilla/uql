import type { AbstractSqlDialect } from '../dialect/index.js';
import { getMeta } from '../entity/index.js';
import type {
  Query,
  QueryConflictPaths,
  QueryOptions,
  QuerySearch,
  QueryUpdateResult,
  SqlQuerier,
  Type,
} from '../type/index.js';
import { clone, unflatObjects } from '../util/index.js';
import { AbstractQuerier } from './abstractQuerier.js';
import { Serialized } from './decorator/index.js';

export abstract class AbstractSqlQuerier extends AbstractQuerier implements SqlQuerier {
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
    const ctx = this.dialect.createContext();
    this.dialect.find(ctx, entity, q);
    const res = await this.all<E>(ctx.sql, ctx.values);
    const founds = unflatObjects(res);
    await this.fillToManyRelations(entity, founds, q.$select);
    return founds;
  }

  override async count<E>(entity: Type<E>, q: QuerySearch<E> = {}) {
    const ctx = this.dialect.createContext();
    this.dialect.count(ctx, entity, q);
    const res = await this.all<{ count: number }>(ctx.sql, ctx.values);
    return Number(res[0].count);
  }

  override async insertMany<E>(entity: Type<E>, payload: E[]) {
    if (!payload?.length) {
      return [];
    }
    payload = clone(payload);
    const ctx = this.dialect.createContext();
    this.dialect.insert(ctx, entity, payload);
    const { ids } = await this.run(ctx.sql, ctx.values);
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
    const ctx = this.dialect.createContext();
    this.dialect.update(ctx, entity, q, payload);
    const { changes } = await this.run(ctx.sql, ctx.values);
    await this.updateRelations(entity, q, payload);
    return changes;
  }

  override async upsertOne<E>(entity: Type<E>, conflictPaths: QueryConflictPaths<E>, payload: E) {
    payload = clone(payload);
    const ctx = this.dialect.createContext();
    this.dialect.upsert(ctx, entity, conflictPaths, payload);
    return this.run(ctx.sql, ctx.values);
  }

  override async deleteMany<E>(entity: Type<E>, q: QuerySearch<E>, opts?: QueryOptions) {
    const meta = getMeta(entity);
    const findCtx = this.dialect.createContext();
    this.dialect.find(findCtx, entity, { ...q, $select: [meta.id] });
    const founds = await this.all<E>(findCtx.sql, findCtx.values);
    if (!founds.length) {
      return 0;
    }
    const ids = founds.map((it) => it[meta.id]);
    const deleteCtx = this.dialect.createContext();
    this.dialect.delete(deleteCtx, entity, { $where: ids }, opts);
    const { changes } = await this.run(deleteCtx.sql, deleteCtx.values);
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
