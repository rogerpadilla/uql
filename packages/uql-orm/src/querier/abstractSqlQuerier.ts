import { decodeColumn } from '../dialect/hydrateColumn.js';
import type { AbstractSqlDialect } from '../dialect/index.js';
import { getMeta } from '../entity/index.js';
import type {
  ExtraOptions,
  IdValue,
  Query,
  QueryAggMap,
  QueryAggregate,
  QueryAggregateResult,
  QueryConflictPaths,
  QueryGroupMap,
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
  cascadesOnDelete,
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

import { enrichError } from './queryError.js';

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
   * Called before every query but outside the timing window.
   */
  protected async lazyConnect(): Promise<void> {}

  async all<T>(query: string, values?: unknown[]): Promise<T[]> {
    return this.serialize(async () => {
      await this.lazyConnect();
      return this.timed(query, values, () => this.internalAll<T>(query, this.dialect.normalizeValues(values)));
    });
  }

  async run(query: string, values?: unknown[]): Promise<QueryUpdateResult> {
    return this.serialize(async () => {
      await this.lazyConnect();
      return this.timed(query, values, () => this.internalRun(query, this.dialect.normalizeValues(values)));
    });
  }

  /**
   * `$lock` outside a transaction is always a bug, and a silent one. Every engine accepts
   * `SELECT ... FOR UPDATE` in autocommit and then releases the lock as the statement commits,
   * before the caller has seen a row: the SQL is correct, nothing is omitted, and no layer below
   * this one can tell. The dialect cannot check it either, being stateless and shared by every
   * connection of the pool, so this is the only place it can be caught.
   *
   * The capability check runs first on purpose: "this engine has no row locks" is the more
   * actionable answer, and on SQLite it is the answer either way.
   */
  protected assertLockable<E>(entity: Type<E>, q: Query<E>): void {
    if (!q.$lock) {
      return;
    }
    this.dialect.assertLockSupported(entity, q);
    if (!this.hasOpenTransaction) {
      throw new TypeError('$lock requires an open transaction');
    }
  }

  protected override async internalFindMany<E extends object>(entity: Type<E>, q: Query<E>, opts?: QueryOptions) {
    this.assertLockable(entity, q);
    const ctx = this.dialect.createContext();
    this.dialect.find(ctx, entity, q, opts);
    const res = await this.all<RawRow>(ctx.sql, ctx.values);
    const founds = unflatObjects<E>(res).map((row) => this.hydrateFields(entity, row));
    await this.fillToManyRelations(entity, founds, q.$populate);
    return founds;
  }

  protected override async *internalFindManyStream<E extends object>(
    entity: Type<E>,
    q: Query<E>,
    opts?: QueryOptions,
  ) {
    this.assertLockable(entity, q);
    const meta = getMeta(entity);
    const { toManyKeys } = getRelationRequestSummary(meta, q.$populate);
    if (toManyKeys.length) {
      throw new TypeError(
        `findManyStream does not load to-many relations (${toManyKeys.join(', ')}). Use findMany so fillToManyRelations can run, or omit those keys from the stream query.`,
      );
    }
    // The one path that does not go through `all`/`run`, so it connects on its own: streaming first on
    // a freshly acquired querier used to reach `getConn()` with nothing acquired.
    await this.lazyConnect();
    const ctx = this.dialect.createContext();
    this.dialect.find(ctx, entity, q, opts);
    const normalizedParams = this.dialect.normalizeValues(ctx.values);
    let attrsPaths: Record<string, string[]> | undefined;
    try {
      for await (const row of this.internalStream<RawRow>(ctx.sql, normalizedParams)) {
        attrsPaths ??= obtainAttrsPaths(row);
        yield this.hydrateFields(entity, unflatObject<E>(row, attrsPaths));
      }
    } catch (err) {
      throw enrichError(err, this.logger, ctx.sql, normalizedParams);
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

  /**
   * Turn what a driver returned back into the types the entity declares, for the row and everything
   * populated under it. Which columns, and as what, is `hydratableFields`; the per-cell decode is
   * `decodeColumn`. Both live with the dialect, because a `sparsevec` is only sparse on Postgres.
   *
   * `visited` guards a populated graph that points back at itself; it defaults rather than living in
   * a separate entry-point wrapper, because the wrapper's whole body was seeding it.
   */
  private hydrateFields<E extends object>(entity: Type<E>, dto: E, visited = new WeakSet<object>()): E {
    if (!dto || typeof dto !== 'object' || visited.has(dto)) {
      return dto;
    }
    visited.add(dto);

    const meta = getMeta(entity);
    const row = dto as Record<string, unknown>;

    for (const [key, kind] of this.dialect.hydratableFields(entity)) {
      const value = row[key];
      if (value != null) {
        row[key] = decodeColumn(value, kind);
      }
    }

    for (const key in meta.relations) {
      const rel = meta.relations[key];
      if (!rel) continue;
      const relEntity = rel.entity();
      const value = row[key];
      if (Array.isArray(value)) {
        for (const it of value) {
          this.hydrateFields(relEntity, it, visited);
        }
        continue;
      }
      if (value && typeof value === 'object') {
        this.hydrateFields(relEntity, value, visited);
      }
    }
    return dto;
  }

  protected override async internalCount<E extends object>(
    entity: Type<E>,
    q: QuerySearch<E> = {},
    opts?: QueryOptions,
  ) {
    const ctx = this.dialect.createContext();
    this.dialect.count(ctx, entity, q, opts);
    const res = await this.all<{ count: number }>(ctx.sql, ctx.values);
    // `COUNT(*)` is BIGINT, which the pools decode at the wire - but a caller who supplies their own
    // `types` replaces that, and the signature promises a number here regardless.
    return Number(res[0].count);
  }

  protected override async internalAggregate<E extends object, G extends QueryGroupMap<E>, A extends QueryAggMap<E>>(
    entity: Type<E>,
    q: QueryAggregate<E, G, A>,
    opts?: QueryOptions,
  ): Promise<QueryAggregateResult<E, G, A>[]> {
    const ctx = this.dialect.createContext();
    this.dialect.aggregate(ctx, entity, q, opts);
    // biome-ignore lint/suspicious/noExplicitAny: raw DB rows satisfy QueryAggregateResult at runtime but TS can't verify
    const res = await this.all<any>(ctx.sql, ctx.values);
    const hydratable = this.dialect.hydratableAggregates(entity, q);
    for (const row of res) {
      for (const [alias, kind] of hydratable) {
        if (row[alias] != null) {
          row[alias] = decodeColumn(row[alias], kind);
        }
      }
    }
    return res;
  }

  override async internalInsertMany<E extends object>(entity: Type<E>, payload: E[]) {
    if (!payload?.length) {
      return [];
    }
    payload = clone(payload);
    const meta = getMeta(entity);
    const idKey = meta.id;
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
    const result = await this.run(ctx.sql, ctx.values);
    // On a `firstId` dialect (MySQL: no `RETURNING`), a multi-row upsert's `affectedRows` is a
    // per-row weighted sum (1=insert, 2=update, 0=no-op), not a row count, so `buildUpdateResult`'s
    // header-derived `ids`/`firstId`/`created` can't be trusted the moment more than one row is
    // involved (verified: a 1-insert-1-update batch reports `changes: 3`, which would otherwise
    // infer 3 sequential ids for only 2 real rows). A single-row batch (`upsertOne`) is unambiguous.
    if (this.dialect.insertIdSource !== 'returning' && payload.length > 1) {
      return { changes: result.changes };
    }
    return result;
  }

  protected override async internalDeleteMany<E extends object>(
    entity: Type<E>,
    q: QuerySearch<E>,
    opts?: QueryOptions,
  ) {
    const meta = getMeta(entity);

    // Resolving the ids first is what makes the two hard cases work at all: a cascade needs its
    // parents' ids to find their children, and no engine but MySQL accepts `ORDER BY`/`LIMIT` on a
    // DELETE, so a paged delete has to name the rows it settled on. A plain predicate needs neither,
    // and there the round trip buys nothing: the statement can say what the caller already said.
    const hasPagination = q.$sort !== undefined || q.$limit !== undefined || q.$skip !== undefined;
    if (!hasPagination && !cascadesOnDelete(meta)) {
      const ctx = this.dialect.createContext();
      this.dialect.delete(ctx, entity, q, opts);
      const { changes = 0 } = await this.run(ctx.sql, ctx.values);
      return changes;
    }

    // A hard delete also targets already-soft-deleted rows, so drop the soft-delete filter when finding ids.
    const findOpts = opts?.hardDelete ? { ...opts, filters: withoutSoftDeleteFilter(opts.filters) } : opts;
    const findCtx = this.dialect.createContext();
    this.dialect.find(findCtx, entity, { ...q, $select: { [meta.id]: true } } as Query<E>, findOpts);
    const founds = await this.all<E>(findCtx.sql, findCtx.values);
    if (!founds.length) {
      return 0;
    }
    const ids = founds.map((it) => it[meta.id]);
    // Children first: they hold the foreign key, so deleting the parent ahead of them is rejected
    // outright by any schema that declares the constraint without `ON DELETE CASCADE`.
    await this.deleteRelations(entity, ids, opts);
    const deleteCtx = this.dialect.createContext();
    this.dialect.delete(deleteCtx, entity, { $where: ids }, opts);
    const { changes = 0 } = await this.run(deleteCtx.sql, deleteCtx.values);
    return changes;
  }

  override get hasOpenTransaction() {
    return !!this.hasPendingTransaction;
  }

  override async beginTransaction(opts?: TransactionOptions) {
    return this.serialize(async () => {
      if (this.hasPendingTransaction) {
        throwPendingTransaction();
      }
      await this.lazyConnect();
      for (const sql of this.dialect.getBeginTransactionStatements(opts?.isolationLevel)) {
        try {
          await this.internalRun(sql);
        } catch (err) {
          throw enrichError(err, this.logger, sql);
        }
      }
      this.hasPendingTransaction = true;
    });
  }

  override async commitTransaction() {
    return this.serialize(async () => {
      if (!this.hasPendingTransaction) {
        throwNoPendingTransaction();
      }
      try {
        await this.internalRun(this.dialect.commitTransactionCommand);
      } catch (err) {
        throw enrichError(err, this.logger, this.dialect.commitTransactionCommand);
      }
      this.hasPendingTransaction = false;
    });
  }

  override async rollbackTransaction() {
    return this.serialize(async () => {
      if (!this.hasPendingTransaction) {
        throwNoPendingTransaction();
      }
      try {
        await this.internalRun(this.dialect.rollbackTransactionCommand);
      } catch (err) {
        throw enrichError(err, this.logger, this.dialect.rollbackTransactionCommand);
      }
      this.hasPendingTransaction = false;
    });
  }
}
