import type { InsertIdStrategy } from '../dialect/dialectConfig.js';
import type { AbstractSqlDialect } from '../dialect/index.js';
import { getMeta } from '../entity/index.js';
import type {
  ExtraOptions,
  IdValue,
  Query,
  QueryAggregate,
  QueryConflictPaths,
  QueryOptions,
  QuerySearch,
  QueryUpdateResult,
  RawRow,
  SqlQuerier,
  TransactionOptions,
  Type,
  UpdatePayload,
} from '../type/index.js';
import { buildUpdateResult, clone, obtainAttrsPaths, unflatObject, unflatObjects } from '../util/index.js';
import type { BuildUpdateResultPayload } from '../util/sql.util.js';
import { AbstractQuerier } from './abstractQuerier.js';
import { Log, Serialized } from './decorator/index.js';

export abstract class AbstractSqlQuerier extends AbstractQuerier implements SqlQuerier {
  private hasPendingTransaction?: boolean;

  constructor(
    readonly dialect: AbstractSqlDialect,
    override readonly extra?: ExtraOptions,
  ) {
    super(extra);
  }

  /**
   * internal read query.
   */
  protected abstract internalAll<T>(query: string, values?: unknown[]): Promise<T[]>;

  /**
   * internal insert/update/delete/ddl query.
   */
  protected abstract internalRun(query: string, values?: unknown[]): Promise<QueryUpdateResult>;

  /**
   * Build a QueryUpdateResult with affected changes and calculated IDs.
   */
  protected buildUpdateResult(payload: BuildUpdateResultPayload): QueryUpdateResult {
    return buildUpdateResult({
      insertIdStrategy: this.dialect.insertIdStrategy,
      ...payload,
    });
  }

  /**
   * Hook for subclasses (e.g. pool queriers) to establish a connection.
   * Called before every query but outside the `@Log()` timer.
   */
  protected async lazyConnect(): Promise<void> {}

  @Serialized()
  async all<T>(query: string, values?: unknown[]): Promise<T[]> {
    await this.lazyConnect();
    return this.timedAll<T>(query, values);
  }

  @Log()
  private async timedAll<T>(query: string, values?: unknown[]): Promise<T[]> {
    return this.internalAll<T>(query, values);
  }

  @Serialized()
  async run(query: string, values?: unknown[]): Promise<QueryUpdateResult> {
    await this.lazyConnect();
    return this.timedRun(query, values);
  }

  @Log()
  private async timedRun(query: string, values?: unknown[]): Promise<QueryUpdateResult> {
    return this.internalRun(query, values);
  }

  protected override async internalFindMany<E extends object>(entity: Type<E>, q: Query<E>) {
    const ctx = this.dialect.createContext();
    this.dialect.find(ctx, entity, q);
    const res = await this.all<RawRow>(ctx.sql, ctx.values);
    const founds = unflatObjects<E>(res);
    await this.fillToManyRelations(entity, founds, q.$select!);
    return founds;
  }

  protected override async *internalFindManyStream<E extends object>(entity: Type<E>, q: Query<E>) {
    const ctx = this.dialect.createContext();
    this.dialect.find(ctx, entity, q);
    let attrsPaths: Record<string, string[]> | undefined;
    for await (const row of this.internalStream<RawRow>(ctx.sql, ctx.values)) {
      attrsPaths ??= obtainAttrsPaths(row);
      yield unflatObject<E>(row, attrsPaths);
    }
  }

  /**
   * Internal streaming query — returns an async iterable of raw rows.
   * Default implementation falls back to `internalAll()` then yields each row.
   * Drivers with native cursor/streaming APIs (SQLite, Pg) should override this.
   */
  protected async *internalStream<T>(query: string, values?: unknown[]): AsyncIterable<T> {
    const rows = await this.internalAll<T>(query, values);
    yield* rows;
  }

  protected override async internalCount<E extends object>(entity: Type<E>, q: QuerySearch<E> = {}) {
    const ctx = this.dialect.createContext();
    this.dialect.count(ctx, entity, q);
    const res = await this.all<{ count: number }>(ctx.sql, ctx.values);
    return Number(res[0].count);
  }

  protected override async internalAggregate<E extends object>(entity: Type<E>, q: QueryAggregate<E>) {
    const ctx = this.dialect.createContext();
    this.dialect.aggregate(ctx, entity, q);
    return this.all<Record<string, unknown>>(ctx.sql, ctx.values);
  }

  override async internalInsertMany<E extends object>(entity: Type<E>, payload: E[]) {
    if (!payload?.length) {
      return [];
    }
    payload = clone(payload);
    const ctx = this.dialect.createContext();
    this.dialect.insert(ctx, entity, payload);
    const { ids = [] } = await this.run(ctx.sql, ctx.values);
    const meta = getMeta(entity);
    const idKey = meta.id!;
    const payloadIds = payload.map((it, index) => {
      const id = ids[index] as E[typeof idKey];
      it[idKey] ??= id;
      return it[idKey];
    });
    await this.insertRelations(entity, payload);
    return payloadIds as IdValue<E>[];
  }

  override async internalUpdateMany<E extends object>(entity: Type<E>, q: QuerySearch<E>, payload: UpdatePayload<E>) {
    payload = clone(payload);
    const ctx = this.dialect.createContext();
    this.dialect.update(ctx, entity, q, payload);
    const { changes = 0 } = await this.run(ctx.sql, ctx.values);
    await this.updateRelations(entity, q, payload);
    return changes;
  }

  override async upsertOne<E extends object>(entity: Type<E>, conflictPaths: QueryConflictPaths<E>, payload: E) {
    return this.upsertMany(entity, conflictPaths, [payload]);
  }

  override async upsertMany<E extends object>(entity: Type<E>, conflictPaths: QueryConflictPaths<E>, payload: E[]) {
    if (!payload?.length) {
      return { changes: 0 };
    }
    payload = clone(payload);
    const ctx = this.dialect.createContext();
    this.dialect.upsert(ctx, entity, conflictPaths, payload);
    return this.run(ctx.sql, ctx.values);
  }

  protected override async internalDeleteMany<E extends object>(
    entity: Type<E>,
    q: QuerySearch<E>,
    opts?: QueryOptions,
  ) {
    const meta = getMeta(entity);
    const findCtx = this.dialect.createContext();
    this.dialect.find(findCtx, entity, { ...q, $select: { [meta.id!]: true } } as Query<E>);
    const founds = await this.all<E>(findCtx.sql, findCtx.values);
    if (!founds.length) {
      return 0;
    }
    const ids = founds.map((it) => it[meta.id!]);
    const deleteCtx = this.dialect.createContext();
    this.dialect.delete(deleteCtx, entity, { $where: ids }, opts);
    const { changes = 0 } = await this.run(deleteCtx.sql, deleteCtx.values);
    await this.deleteRelations(entity, ids, opts);
    return changes;
  }

  override get hasOpenTransaction() {
    return !!this.hasPendingTransaction;
  }

  @Serialized()
  override async beginTransaction(opts?: TransactionOptions) {
    if (this.hasPendingTransaction) {
      throw TypeError('pending transaction');
    }
    await this.lazyConnect();
    const statements = this.dialect.getBeginTransactionStatements(opts?.isolationLevel);
    for (const sql of statements) {
      await this.internalRun(sql);
    }
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
