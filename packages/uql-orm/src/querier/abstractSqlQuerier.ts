import { COUNT_ALIAS, TOTAL_ALIAS } from '../dialect/aliases.js';
import { decodeColumn } from '../dialect/hydrateColumn.js';
import type { AbstractSqlDialect } from '../dialect/index.js';
import { getMeta, idOf, soleIdOf } from '../entity/index.js';
import type {
  EntityData,
  ExtraOptions,
  IdValue,
  Query,
  QueryAggMap,
  QueryAggregate,
  QueryAggregateResult,
  QueryBuildFn,
  QueryConflictPaths,
  QueryFilter,
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
  hasKeys,
  idOnlyQuery,
  isAutoIncrement,
  isPagedQuery,
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
   * Hook for subclasses (e.g. pool queriers) to establish a connection. Called before every query and
   * before `BEGIN`, outside the timing window, which makes it the one place a released querier is
   * caught for every SQL backend.
   */
  protected async lazyConnect(): Promise<void> {
    if (this.released) {
      throw new TypeError('querier already released');
    }
  }

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

  /**
   * Run the `SET`s that tune an ANN index for this query, and refuse the ones that would not apply.
   *
   * Same shape as {@link assertLockable} and for the same reason: a `SET LOCAL` outside a transaction
   * is accepted, applies to nothing, and leaves the query running at the engine's default recall -
   * correct SQL, silently untuned. Only the querier knows whether a transaction is open.
   *
   * The statements go through `internalRun`, sharing this querier's single connection with the query
   * they precede; `SET LOCAL` then expires with the transaction, so nothing is left behind.
   */
  private async applyVectorTuning<E>(entity: Type<E>, q: Query<E>): Promise<void> {
    // Resolved before the transaction check, so the refusal fires only where the tuning would have
    // meant something: a query with no vector search, or on a field carrying no ANN index, has
    // nothing to set and no reason to demand a transaction for it.
    const statements = this.dialect.vectorTuningStatements(getMeta(entity), q);
    if (!statements.length) {
      return;
    }
    if (this.dialect.vectorTuningNeedsTransaction && !this.hasOpenTransaction) {
      throw new TypeError(
        `$candidates requires an open transaction on ${this.dialect.dialectName}; run the query inside pool.transaction(...)`,
      );
    }
    for (const statement of statements) {
      await this.internalRun(statement);
    }
  }

  protected override async internalFindMany<E extends object>(entity: Type<E>, q: Query<E>, opts?: QueryOptions) {
    return this.hydrateRows(entity, q, await this.selectRows(entity, q, opts));
  }

  /**
   * One statement for both: the page carries its own unpaged total in an extra column. An empty page
   * has no row to carry it, which is the one case still needing a count of its own - a `$skip` past
   * the end, or a filter nothing matched.
   *
   * A `$required` relation needs no special case: the window counts what the INNER JOIN left, which
   * is exactly the total a caller of a filtered read is asking for. A `$lock` is the one clause an
   * engine may refuse to have in the same statement, which {@link AbstractSqlDialect.supportsWindowWithRowLock}
   * answers; where it does, the total comes from a count of its own. A `$distinct` read needs one
   * too, and a deduplicating one: see {@link AbstractSqlDialect.countDistinct}.
   */
  /**
   * How to count when the total cannot ride along in the read's own `COUNT(*) OVER ()` column, or
   * `undefined` when it can. Two clauses rule the window out: `$distinct`, because a window counts
   * before the deduplication and so overstates the page, and `$lock` on an engine that refuses the
   * pair outright. Both then cost a second statement; only the counting differs.
   */
  private countedSeparately<E extends object>(
    entity: Type<E>,
    q: Query<E>,
    opts?: QueryOptions,
  ): QueryBuildFn | undefined {
    if (q.$distinct) {
      return (ctx) => this.dialect.countDistinct(ctx, entity, q, opts);
    }
    if (q.$lock && !this.dialect.supportsWindowWithRowLock) {
      return (ctx) => this.dialect.count(ctx, entity, q, opts);
    }
    return undefined;
  }

  protected override async internalFindManyAndCount<E extends object>(
    entity: Type<E>,
    q: Query<E>,
    opts?: QueryOptions,
  ): Promise<[E[], number]> {
    const separately = this.countedSeparately(entity, q, opts);
    if (separately) {
      return Promise.all([this.internalFindMany(entity, q, opts), this.runCount(separately)]);
    }
    const rows = await this.selectRows(entity, q, opts, TOTAL_ALIAS);
    const total = rows.length ? Number(rows[0][TOTAL_ALIAS]) : await this.internalCount(entity, q, opts);
    for (const row of rows) {
      delete row[TOTAL_ALIAS];
    }
    return [await this.hydrateRows(entity, q, rows), total];
  }

  private async selectRows<E extends object>(
    entity: Type<E>,
    q: Query<E>,
    opts?: QueryOptions,
    totalAlias?: string,
  ): Promise<RawRow[]> {
    this.assertLockable(entity, q);
    // Guarded rather than awaited unconditionally, here and in the stream below: an `await` on this
    // path defers a microtask on every read, which reorders the two statements `findManyAndCount`
    // issues concurrently. Keep the guard at any new call site.
    if (q.$candidates !== undefined) {
      await this.applyVectorTuning(entity, q);
    }
    const ctx = this.dialect.createContext();
    this.dialect.find(ctx, entity, q, opts, totalAlias);
    return this.all<RawRow>(ctx.sql, ctx.values);
  }

  private async hydrateRows<E extends object>(entity: Type<E>, q: Query<E>, rows: RawRow[]): Promise<E[]> {
    const founds = unflatObjects<E>(rows).map((row) => this.hydrateFields(entity, row));
    await this.fillToManyRelations(entity, founds, q.$populate);
    return founds;
  }

  protected override async *internalFindManyStream<E extends object>(
    entity: Type<E>,
    q: Query<E>,
    opts?: QueryOptions,
  ) {
    this.assertLockable(entity, q);
    // Guarded for the reason `selectRows` above spells out.
    if (q.$candidates !== undefined) {
      await this.applyVectorTuning(entity, q);
    }
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
   * `visited` guards a populated graph that points back at itself, and makes a node two paths reach
   * decode once. Only a relation can lead the walk back somewhere it has been, so an entity that
   * declares none skips the guard rather than allocating a set per row to hold a single object -
   * which cost more than the decoding it guards, on a flat read.
   */
  private hydrateFields<E extends object>(entity: Type<E>, dto: E, visited?: WeakSet<object>): E {
    if (!dto || typeof dto !== 'object' || visited?.has(dto)) {
      return dto;
    }

    const meta = getMeta(entity);
    const row = dto as Record<string, unknown>;

    for (const [key, kind] of this.dialect.hydratableFields(entity)) {
      const value = row[key];
      if (value != null) {
        row[key] = decodeColumn(value, kind);
      }
    }

    // Allocated only where the walk can continue: an entity declaring no relation cannot lead back
    // to a node already decoded, and the loop below is a no-op for it anyway.
    if (hasKeys(meta.relations)) {
      visited ??= new WeakSet();
    }
    visited?.add(dto);

    // The value is read before the relation's target is resolved: a query that populated nothing
    // still walks every relation the entity declares, and `rel.entity()` is a call per row per
    // relation that only the populated ones need.
    for (const key in meta.relations) {
      const value = row[key];
      if (!value || typeof value !== 'object') continue;
      const rel = meta.relations[key];
      if (!rel) continue;
      const relEntity = rel.entity();
      if (Array.isArray(value)) {
        for (const it of value) {
          this.hydrateFields(relEntity, it, visited);
        }
        continue;
      }
      this.hydrateFields(relEntity, value, visited);
    }
    return dto;
  }

  /**
   * Runs a statement whose one row carries a {@link COUNT_ALIAS} column. `Number` because `COUNT(*)` is BIGINT and
   * a caller supplying their own `types` replaces the decoding the pools do at the wire; `?? 0` because
   * a catalog that does not know the table answers with no row, which is nothing counted.
   */
  private async runCount(build: QueryBuildFn): Promise<number> {
    const ctx = this.dialect.createContext();
    build(ctx);
    const res = await this.all<Record<typeof COUNT_ALIAS, number | null>>(ctx.sql, ctx.values);
    return Number(res[0]?.[COUNT_ALIAS] ?? 0);
  }

  protected override async internalCount<E extends object>(
    entity: Type<E>,
    q: QueryFilter<E> = {},
    opts?: QueryOptions,
  ) {
    return this.runCount((ctx) => this.dialect.count(ctx, entity, q, opts));
  }

  override async estimatedCount<E extends object>(entity: Type<E>) {
    return this.runCount((ctx) => this.dialect.estimatedCount(ctx, entity));
  }

  protected override async internalAggregate<E extends object, G extends QueryGroupMap<E>, A extends QueryAggMap<E>>(
    entity: Type<E>,
    q: QueryAggregate<E, G, A>,
    opts?: QueryOptions,
  ): Promise<QueryAggregateResult<E, G, A>[]> {
    const ctx = this.dialect.createContext();
    this.dialect.aggregate(ctx, entity, q, opts);
    // oxlint-disable-next-line typescript/no-explicit-any -- raw DB rows satisfy QueryAggregateResult at runtime but TS can't verify
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

  override async internalInsertMany<E extends object>(entity: Type<E>, payload: EntityData<E>[]) {
    if (!payload?.length) {
      return [];
    }
    payload = clone(payload);
    const meta = getMeta(entity);
    // A composite key is supplied whole by the caller, so nothing is generated and nothing comes
    // back: the rows insert, and their ids are `undefined` for the reason MySQL's are below - there
    // is no id to report. `idOf` names such a row for the caller that wants one.
    const [idKey] = meta.ids;
    const sole = meta.ids.length === 1;
    const idField = sole ? meta.fields[idKey] : undefined;
    // RETURNING-based IDs are exact per row. Header-derived IDs (LAST_INSERT_ID /
    // lastInsertRowid arithmetic) are only sound when the primary key is database-generated
    // and no record supplies an explicit ID (a mixed batch shifts the positional mapping and
    // MySQL stops guaranteeing consecutive values); otherwise generated IDs stay `undefined`.
    const idsReliable =
      sole &&
      (this.dialect.insertIdSource === 'returning' ||
        (!!idField && isAutoIncrement(idField, true) && payload.every((it) => it[idKey] === undefined)));
    // Inferring multiple ids from the single header id (MySQL) assumes a known stride; a clustered
    // server may set `auto_increment_increment` > 1, so probe it (once, cached) before inferring.
    if (idsReliable && payload.length > 1 && this.dialect.insertIdSource === 'firstId') {
      this.#insertIdIncrement ??= await this.loadInsertIdIncrement();
    }
    // `DEFAULT` cells bind no parameter, so fields-per-record is a safe upper bound per row.
    const fieldsPerRecord = getInsertFieldKeys(meta, payload).length || 1;
    const chunkSize = Math.max(1, Math.floor(this.dialect.maxBindValues / fieldsPerRecord));
    const payloadIds: (IdValue<E> | undefined)[] = [];
    for (let start = 0; start < payload.length; start += chunkSize) {
      const chunk = payload.slice(start, start + chunkSize);
      const ctx = this.dialect.createContext();
      this.dialect.insert(ctx, entity, chunk);
      const { ids = [] } = await this.run(ctx.sql, ctx.values);
      chunk.forEach((it, index) => {
        if (idsReliable) {
          it[idKey] ??= ids[index] as E[typeof idKey];
        }
        payloadIds.push(sole ? it[idKey] : undefined);
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
    // Settled first for the reason `internalDeleteMany` settles: `ORDER BY`/`LIMIT` on an UPDATE is
    // MySQL's alone, so a paged update has to name the rows it picked.
    let target = q;
    if (isPagedQuery(q)) {
      const ids = await this.settleIds(entity, q, opts);
      if (!ids.length) {
        return 0;
      }
      target = { $where: ids };
    }
    const ctx = this.dialect.createContext();
    this.dialect.update(ctx, entity, target, payload, opts);
    const { changes = 0 } = await this.run(ctx.sql, ctx.values);
    await this.updateRelations(entity, target, payload, opts);
    return changes;
  }

  /** The ids matching `q`, in `q`'s own order and page, so a write can name the rows it settled on. */
  private async settleIds<E extends object>(entity: Type<E>, q: QuerySearch<E>, opts?: QueryOptions) {
    const meta = getMeta(entity);
    const ctx = this.dialect.createContext();
    this.dialect.find(ctx, entity, idOnlyQuery(meta, q), opts);
    const founds = await this.all<E>(ctx.sql, ctx.values);
    return founds.map((found) => idOf(meta, found));
  }

  override async upsertOne<E extends object>(
    entity: Type<E>,
    conflictPaths: QueryConflictPaths<E>,
    payload: EntityData<E>,
  ) {
    return this.upsertMany(entity, conflictPaths, [payload]);
  }

  override async upsertMany<E extends object>(
    entity: Type<E>,
    conflictPaths: QueryConflictPaths<E>,
    payload: EntityData<E>[],
  ) {
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
    if (!isPagedQuery(q) && !cascadesOnDelete(meta)) {
      const ctx = this.dialect.createContext();
      this.dialect.delete(ctx, entity, q, opts);
      const { changes = 0 } = await this.run(ctx.sql, ctx.values);
      return changes;
    }

    // A hard delete also targets already-soft-deleted rows, so drop the soft-delete filter when finding ids.
    const findOpts = opts?.hardDelete ? { ...opts, filters: withoutSoftDeleteFilter(opts.filters) } : opts;
    const ids = await this.settleIds(entity, q, findOpts);
    if (!ids.length) {
      return 0;
    }
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
        await this.runTransactionCommand(sql);
      }
      this.hasPendingTransaction = true;
    });
  }

  override async commitTransaction() {
    return this.serialize(async () => {
      if (!this.hasPendingTransaction) {
        throwNoPendingTransaction();
      }
      await this.endTransactionWith(this.dialect.commitTransactionCommand);
    });
  }

  override async rollbackTransaction() {
    return this.serialize(async () => {
      if (this.hasPendingTransaction) {
        await this.endTransactionWith(this.dialect.rollbackTransactionCommand);
      }
    });
  }

  /**
   * Only a statement that succeeded ends the transaction. A `COMMIT` that fails can leave it open
   * (SQLite answers `SQLITE_BUSY` and keeps it), so the flag has to stay set for the `catch` in
   * {@link AbstractQuerier.transaction} or {@link AbstractQuerier.release} to roll it back.
   */
  private async endTransactionWith(command: string) {
    await this.runTransactionCommand(command);
    this.hasPendingTransaction = false;
  }

  /** Transaction statements skip `timed()`, so they attach their own query context to a failure. */
  private async runTransactionCommand(sql: string) {
    try {
      await this.internalRun(sql);
    } catch (err) {
      throw enrichError(err, this.logger, sql);
    }
  }
}
