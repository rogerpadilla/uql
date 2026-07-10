import type { AbstractSqlDialect } from '../dialect/index.js';
import { getMeta } from '../entity/index.js';
import type {
  ExtraOptions,
  IdValue,
  Query,
  QueryAggregate,
  QueryAggregateResult,
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
import {
  buildUpdateResult,
  clone,
  getInsertFieldKeys,
  getRelationRequestSummary,
  isAutoIncrement,
  obtainAttrsPaths,
  throwNoPendingTransaction,
  throwPendingTransaction,
  unflatObject,
  unflatObjects,
  withoutSoftDeleteFilter,
} from '../util/index.js';
import type { BuildUpdateResultPayload } from '../util/sql.util.js';
import { AbstractQuerier } from './abstractQuerier.js';
import { Log, Serialized } from './decorator/index.js';

export abstract class AbstractSqlQuerier extends AbstractQuerier implements SqlQuerier {
  private hasPendingTransaction?: boolean;
  /** Cached `auto_increment_increment` stride; see {@link loadInsertIdIncrement}. */
  #insertIdIncrement?: number;

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
      insertIdSource: this.dialect.insertIdSource,
      insertIdIncrement: this.#insertIdIncrement,
      ...payload,
    });
  }

  /**
   * The `auto_increment_increment` stride used to infer the ids of a multi-row insert from the
   * single id the driver reports (MySQL, which has no `RETURNING`). It is 1 on a standalone server
   * but can be higher on a cluster (e.g. Galera). Only called for `firstId` dialects.
   */
  protected async loadInsertIdIncrement(): Promise<number> {
    const rows = await this.all<{ v: number | string }>('SELECT @@auto_increment_increment AS v');
    const value = Number(rows[0]?.v);
    return Number.isInteger(value) && value > 0 ? value : 1;
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
    return this.internalAll<T>(query, this.dialect.normalizeValues(values));
  }

  @Serialized()
  async run(query: string, values?: unknown[]): Promise<QueryUpdateResult> {
    await this.lazyConnect();
    return this.timedRun(query, values);
  }

  @Log()
  private async timedRun(query: string, values?: unknown[]): Promise<QueryUpdateResult> {
    return this.internalRun(query, this.dialect.normalizeValues(values));
  }

  protected override async internalFindMany<E extends object>(entity: Type<E>, q: Query<E>, opts?: QueryOptions) {
    const ctx = this.dialect.createContext();
    this.dialect.find(ctx, entity, q, opts);
    const res = await this.all<RawRow>(ctx.sql, ctx.values);
    const founds = unflatObjects<E>(res).map((row) => this.hydrateJsonFields(entity, row));
    await this.fillToManyRelations(entity, founds, q.$populate);
    return founds;
  }

  protected override async *internalFindManyStream<E extends object>(
    entity: Type<E>,
    q: Query<E>,
    opts?: QueryOptions,
  ) {
    const meta = getMeta(entity);
    const { toManyKeys } = getRelationRequestSummary(meta, q.$populate);
    if (toManyKeys.length) {
      throw new TypeError(
        `findManyStream does not load to-many relations (${toManyKeys.join(', ')}). Use findMany so fillToManyRelations can run, or omit those keys from the stream query.`,
      );
    }
    const ctx = this.dialect.createContext();
    this.dialect.find(ctx, entity, q, opts);
    const normalizedParams = this.dialect.normalizeValues(ctx.values);
    let attrsPaths: Record<string, string[]> | undefined;
    for await (const row of this.internalStream<RawRow>(ctx.sql, normalizedParams)) {
      attrsPaths ??= obtainAttrsPaths(row);
      yield this.hydrateJsonFields(entity, unflatObject<E>(row, attrsPaths));
    }
  }

  /**
   * Internal streaming query - returns an async iterable of raw rows.
   * Default implementation falls back to `internalAll()` then yields each row.
   * Drivers with native cursor/streaming APIs (SQLite, Pg) should override this.
   */
  protected async *internalStream<T>(query: string, values?: unknown[]): AsyncIterable<T> {
    const rows = await this.internalAll<T>(query, this.dialect.normalizeValues(values));
    yield* rows;
  }

  private hydrateJsonFields<E extends object>(entity: Type<E>, dto: E): E {
    this.hydrateJsonFieldsRecursive(entity, dto, new WeakSet<object>());
    return dto;
  }

  private hydrateJsonFieldsRecursive<E extends object>(entity: Type<E>, dto: E, visited: WeakSet<object>) {
    if (!dto || typeof dto !== 'object' || visited.has(dto)) {
      return;
    }
    visited.add(dto);

    const meta = getMeta(entity);
    const row = dto as Record<string, unknown>;

    for (const key in meta.fields) {
      const field = meta.fields[key];
      if (!field || (field.type !== 'json' && field.type !== 'jsonb')) {
        continue;
      }
      const value = row[key];
      if (typeof value !== 'string') {
        continue;
      }
      try {
        row[key] = JSON.parse(value);
      } catch {
        // Keep the original value when the driver returns non-JSON text.
      }
    }

    for (const key in meta.relations) {
      const rel = meta.relations[key];
      const relEntity = rel?.entity?.();
      if (!relEntity) {
        continue;
      }
      const value = row[key];
      if (Array.isArray(value)) {
        for (const it of value) {
          this.hydrateJsonFieldsRecursive(relEntity, it, visited);
        }
        continue;
      }
      if (value && typeof value === 'object') {
        this.hydrateJsonFieldsRecursive(relEntity, value, visited);
      }
    }
  }

  protected override async internalCount<E extends object>(
    entity: Type<E>,
    q: QuerySearch<E> = {},
    opts?: QueryOptions,
  ) {
    const ctx = this.dialect.createContext();
    this.dialect.count(ctx, entity, q, opts);
    const res = await this.all<{ count: number }>(ctx.sql, ctx.values);
    return Number(res[0].count);
  }

  protected override async internalAggregate<E extends object, Q extends QueryAggregate<E>>(
    entity: Type<E>,
    q: Q,
    opts?: QueryOptions,
  ): Promise<QueryAggregateResult<E, Q['$group']>[]> {
    const ctx = this.dialect.createContext();
    this.dialect.aggregate(ctx, entity, q, opts);
    // biome-ignore lint/suspicious/noExplicitAny: raw DB rows satisfy QueryAggregateResult at runtime but TS can't verify
    return this.all<any>(ctx.sql, ctx.values);
  }

  override async internalInsertMany<E extends object>(entity: Type<E>, payload: E[]) {
    if (!payload?.length) {
      return [];
    }
    payload = clone(payload);
    const meta = getMeta(entity);
    const idKey = meta.id!;
    const idField = meta.fields[idKey];
    // RETURNING-based IDs are exact per row. Header-derived IDs (LAST_INSERT_ID /
    // lastInsertRowid arithmetic) are only sound when the primary key is database-generated
    // and no record supplies an explicit ID (a mixed batch shifts the positional mapping and
    // MySQL stops guaranteeing consecutive values); otherwise generated IDs stay `undefined`.
    const idsReliable =
      this.dialect.insertIdSource === 'returning' ||
      (!!idField && isAutoIncrement(idField, true) && payload.every((it) => it[idKey] === undefined));
    // Inferring multiple ids from the single header id (MySQL) assumes a known stride; a clustered
    // server may set `auto_increment_increment` > 1, so probe it (once, cached) before inferring.
    if (idsReliable && payload.length > 1 && this.dialect.insertIdSource === 'firstId') {
      this.#insertIdIncrement ??= await this.loadInsertIdIncrement();
    }
    // `DEFAULT` cells bind no parameter, so fields-per-record is a safe upper bound per row.
    const fieldsPerRecord = getInsertFieldKeys(meta, payload).length || 1;
    const chunkSize = Math.max(1, Math.floor(this.dialect.maxBindValues / fieldsPerRecord));
    const payloadIds: IdValue<E>[] = [];
    for (let start = 0; start < payload.length; start += chunkSize) {
      const chunk = payload.slice(start, start + chunkSize);
      const ctx = this.dialect.createContext();
      this.dialect.insert(ctx, entity, chunk);
      const { ids = [] } = await this.run(ctx.sql, ctx.values);
      chunk.forEach((it, index) => {
        if (idsReliable) {
          it[idKey] ??= ids[index] as E[typeof idKey];
        }
        payloadIds.push(it[idKey]);
      });
    }
    await this.insertRelations(entity, payload);
    return payloadIds;
  }

  override async internalUpdateMany<E extends object>(
    entity: Type<E>,
    q: QuerySearch<E>,
    payload: UpdatePayload<E>,
    opts?: QueryOptions,
  ) {
    payload = clone(payload);
    const ctx = this.dialect.createContext();
    this.dialect.update(ctx, entity, q, payload, opts);
    const { changes = 0 } = await this.run(ctx.sql, ctx.values);
    await this.updateRelations(entity, q, payload, opts);
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
    // A hard delete also targets already-soft-deleted rows, so drop the soft-delete filter when finding ids.
    const findOpts = opts?.hardDelete ? { ...opts, filters: withoutSoftDeleteFilter(opts.filters) } : opts;
    const findCtx = this.dialect.createContext();
    this.dialect.find(findCtx, entity, { ...q, $select: { [meta.id!]: true } } as Query<E>, findOpts);
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
      throwPendingTransaction();
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
      throwNoPendingTransaction();
    }
    await this.internalRun(this.dialect.commitTransactionCommand);
    this.hasPendingTransaction = false;
  }

  @Serialized()
  override async rollbackTransaction() {
    if (!this.hasPendingTransaction) {
      throwNoPendingTransaction();
    }
    await this.internalRun(this.dialect.rollbackTransactionCommand);
    this.hasPendingTransaction = false;
  }
}
