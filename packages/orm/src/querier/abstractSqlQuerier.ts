import { AGGREGATE_VALUE_ALIAS, TOTAL_ALIAS } from '../dialect/aliases.js';
import { decodeColumn } from '../dialect/hydrateColumn.js';
import type { AbstractSqlDialect } from '../dialect/index.js';
import { getMeta, namesKey } from '../entity/index.js';
import { COUNT_RESULT_KEY } from '../type/index.js';
import type {
  EntityData,
  EntityMeta,
  ExtraOptions,
  IdKey,
  Query,
  QueryAggMap,
  QueryAggregate,
  QueryAggregateResult,
  QueryBuildFn,
  QueryConflictPaths,
  QueryPage,
  QueryGroupMap,
  PrimaryKey,
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
  insertShapeOf,
  isAutoIncrement,
  isRecord,
  obtainAttrsPaths,
  throwNoPendingTransaction,
  throwPendingTransaction,
  unflatObject,
  unflatObjects,
} from '../util/index.js';
import type { BuildUpdateResultPayload } from '../util/sql.util.js';
import { UqlUsageError } from '../util/uqlError.js';
import { AbstractQuerier } from './abstractQuerier.js';
import { streamViaCursor } from './cursorStream.js';
import { enrichError } from './queryError.js';

/**
 * Row indexes split by whether the row names its key, the one thing that changes what an insert can
 * report; coarser than {@link groupByInsertShape} on purpose, since an insert fills a missing column with `DEFAULT`.
 */
function partitionBySuppliedId<E extends object>(payload: EntityData<E>[], idKey: IdKey<E>): number[][] {
  const supplied: number[] = [];
  const generated: number[] = [];
  for (let index = 0; index < payload.length; index++) {
    (payload[index][idKey] === undefined ? generated : supplied).push(index);
  }
  return supplied.length && generated.length ? [supplied, generated] : [supplied.length ? supplied : generated];
}

/**
 * Row indexes grouped by the columns their rows carry, payload order kept within each group.
 *
 * Deliberately finer than {@link partitionBySuppliedId}: an upsert's `DO UPDATE SET` is one
 * assignment list for the whole statement, so rows of different shapes cannot share one at all.
 */
function groupByInsertShape<E extends object>(meta: EntityMeta<E>, payload: EntityData<E>[]): number[][] {
  const groups = new Map<string, number[]>();
  for (let index = 0; index < payload.length; index++) {
    const shape = insertShapeOf(meta, payload[index]);
    const group = groups.get(shape);
    if (group) {
      group.push(index);
    } else {
      groups.set(shape, [index]);
    }
  }
  return [...groups.values()];
}

/**
 * A group's row indexes split into statements within the dialect's bind budget, payload order kept.
 * `DEFAULT` cells bind no parameter, so fields-per-record is a safe upper bound. Every multi-row
 * write splits on this: D1 allows 100 binds, which a couple of dozen rows reach.
 */
function chunkByBindBudget<E extends object>(
  meta: EntityMeta<E>,
  payload: EntityData<E>[],
  group: number[],
  maxBindValues: number,
): number[][] {
  const fieldsPerRecord = getInsertFieldKeys(
    meta,
    group.map((index) => payload[index]),
  ).length;
  const size = Math.max(1, Math.floor(maxBindValues / (fieldsPerRecord || 1)));
  const chunks: number[][] = [];
  for (let start = 0; start < group.length; start += size) {
    chunks.push(group.slice(start, start + size));
  }
  return chunks;
}

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
      throw new UqlUsageError('querier already released');
    }
  }

  async all<T>(query: string, values?: readonly unknown[]): Promise<T[]> {
    return this.serialize(async () => {
      await this.lazyConnect();
      return this.timed(query, values, () => this.internalAll<T>(query, this.dialect.normalizeValues(values)));
    });
  }

  async run(query: string, values?: readonly unknown[]): Promise<QueryUpdateResult> {
    return this.serialize(async () => {
      await this.lazyConnect();
      return this.timed(query, values, () => this.internalRun(query, this.dialect.normalizeValues(values)));
    });
  }

  /** The rows of a statement the dialect builds. */
  private query<T>(build: QueryBuildFn): Promise<T[]> {
    const ctx = this.dialect.createContext();
    build(ctx);
    return this.all<T>(ctx.sql, ctx.values);
  }

  /** Runs a statement the dialect builds. */
  private exec(build: QueryBuildFn): Promise<QueryUpdateResult> {
    const ctx = this.dialect.createContext();
    build(ctx);
    return this.run(ctx.sql, ctx.values);
  }

  /**
   * Runs the `SET`s tuning an ANN index for the query on its connection, refusing where they would apply to
   * nothing: a `SET LOCAL` outside a transaction.
   */
  private async applyVectorTuning<E>(entity: Type<E>, q: Query<E>): Promise<void> {
    // Resolved before the transaction check, so the refusal fires only where the tuning would have
    // meant something: a query with no vector search, or on a field carrying no ANN index, has
    // nothing to set and no reason to demand a transaction for it.
    const statements = this.dialect.vectorTuningStatements(getMeta(entity), q);
    if (!statements.length) {
      return;
    }
    if (this.dialect.features.vectorTuningNeedsTransaction && !this.hasOpenTransaction) {
      throw new UqlUsageError(
        `$candidates requires an open transaction on ${this.dialect.dialectName}; run the query inside pool.transaction(...)`,
      );
    }
    for (const statement of statements) {
      await this.internalRun(statement);
    }
  }

  protected override async internalFindMany<E extends object>(entity: Type<E>, q: Query<E>, opts?: QueryOptions) {
    return this.hydrateRows(entity, await this.selectRows(entity, q, opts));
  }

  /** Every row `q` matches past its page, deduplicated where it reads `$distinct`. */
  private countUnpaged<E extends object>(entity: Type<E>, q: Query<E>, opts?: QueryOptions): Promise<number> {
    return q.$distinct
      ? this.runCount((ctx) => this.dialect.countDistinct(ctx, entity, q, opts))
      : this.internalCount(entity, { $where: q.$where }, opts);
  }

  /**
   * The page and its unpaged total in one statement, a window column on each row, and a count of its own for
   * an empty page. A window counts before `DISTINCT`, and the Postgres family refuses one beside a `$lock`,
   * so those count apart.
   */
  protected override async internalFindManyAndCount<E extends object>(
    entity: Type<E>,
    q: Query<E>,
    opts?: QueryOptions,
  ): Promise<[E[], number]> {
    const { rowLocks } = this.dialect.features;
    if (q.$distinct || (q.$lock && !(rowLocks && rowLocks.withWindow))) {
      return Promise.all([this.internalFindMany(entity, q, opts), this.countUnpaged(entity, q, opts)]);
    }
    const rows = await this.selectRows(entity, q, opts, TOTAL_ALIAS);
    const total = rows.length ? Number(rows[0][TOTAL_ALIAS]) : await this.countUnpaged(entity, q, opts);
    for (const row of rows) {
      delete row[TOTAL_ALIAS];
    }
    return [this.hydrateRows(entity, rows), total];
  }

  private async selectRows<E extends object>(
    entity: Type<E>,
    q: Query<E>,
    opts?: QueryOptions,
    totalAlias?: string,
  ): Promise<RawRow[]> {
    // Guarded rather than awaited unconditionally, here and in the stream below: an `await` on this
    // path defers a microtask on every read, which reorders the two statements `findManyAndCount`
    // issues concurrently. Keep the guard at any new call site.
    if (q.$candidates !== undefined) {
      await this.applyVectorTuning(entity, q);
    }
    return this.query<RawRow>((ctx) => this.dialect.find(ctx, entity, q, opts, totalAlias));
  }

  private hydrateRows<E extends object>(entity: Type<E>, rows: RawRow[]): E[] {
    const founds = unflatObjects<E>(rows);
    this.hydrateAll(entity, founds);
    return founds;
  }

  protected override async *internalFindManyStream<E extends object>(
    entity: Type<E>,
    q: Query<E>,
    opts?: QueryOptions,
  ) {
    // Guarded for the reason `selectRows` above spells out.
    if (q.$candidates !== undefined) {
      await this.applyVectorTuning(entity, q);
    }
    const meta = getMeta(entity);
    // The one path not going through `all`/`run`, so it connects on its own.
    await this.lazyConnect();
    // No `normalizeValues` here, unlike `all`/`run`: those also take raw SQL, while every value a
    // context holds was normalized as it was bound.
    const ctx = this.dialect.createContext();
    this.dialect.find(ctx, entity, q, opts);
    const fields = this.dialect.hydratableFields(entity);
    let attrsPaths: Record<string, string[]> | undefined;
    try {
      for await (const row of this.internalStream<RawRow>(ctx.sql, ctx.values)) {
        attrsPaths ??= obtainAttrsPaths(row);
        const found = unflatObject<E>(row, attrsPaths);
        this.hydrateFields(meta, fields, found);
        yield found;
      }
    } catch (err) {
      throw enrichError(err, this.logger, ctx.sql, ctx.values);
    }
  }

  /**
   * A read's rows one at a time: paged through a server-side cursor where the engine has one, read whole
   * where it has none. A driver that streams on its own overrides this.
   */
  protected async *internalStream<T>(query: string, values?: unknown[]): AsyncIterable<T> {
    if (!this.dialect.features.serverSideCursors) {
      yield* await this.internalAll<T>(query, values);
      return;
    }
    yield* streamViaCursor<T>(
      (sql, params) => this.internalAll<T>(sql, params),
      query,
      values,
      this.hasOpenTransaction,
    );
  }

  /**
   * Turn what a driver returned back into the types the entity declares, for every row and everything
   * populated under them. Which columns, and as what, is `hydratableFields`, resolved once for all the
   * rows; the per-cell decode is `decodeColumn`. Both live with the dialect, because a `sparsevec` is
   * only sparse on Postgres.
   */
  private hydrateAll<E extends object>(entity: Type<E>, dtos: readonly E[]): void {
    const meta = getMeta(entity);
    const fields = this.dialect.hydratableFields(entity);
    for (const dto of dtos) {
      this.hydrateFields(meta, fields, dto);
    }
  }

  /**
   * One row of {@link hydrateAll}. A related row arrives as its parent's statement read it: a to-one
   * joined and unflattened, there only when its key is, since an unmatched join still fills a computed
   * column or a to-many's empty array; a to-many as a JSON array, which a driver may hand over as text.
   * Each is an object of its own, so the walk reaches none twice.
   */
  private hydrateFields<E extends object>(
    meta: EntityMeta<E>,
    fields: ReturnType<AbstractSqlDialect['hydratableFields']>,
    dto: E,
  ): void {
    const row = dto as Record<string, unknown>;
    for (const [key, kind] of fields) {
      const value = row[key];
      if (value != null) {
        row[key] = decodeColumn(value, kind);
      }
    }
    // A tally read inside the statement comes back as its driver reads a COUNT, which on some is text.
    const counts = row[COUNT_RESULT_KEY];
    if (isRecord(counts)) {
      for (const relKey in counts) {
        counts[relKey] = Number(counts[relKey]);
      }
    }

    // The value is read before the relation's target is resolved: a query that populated nothing
    // still walks every relation the entity declares, and `rel.entity()` is a call per row per
    // relation that only the populated ones need.
    for (const key in meta.relations) {
      const value = row[key];
      if (!value) continue;
      const rel = meta.relations[key];
      if (!rel) continue;
      const relEntity = rel.entity();
      if (typeof value === 'string' || Array.isArray(value)) {
        // A to-many's rows, as flat as a statement's own.
        const rows = unflatObjects<object>(typeof value === 'string' ? JSON.parse(value) : value);
        row[key] = rows;
        this.hydrateAll(relEntity, rows);
      } else if (isRecord(value)) {
        const relMeta = getMeta(relEntity);
        if (value[relMeta.ids[0]] == null) {
          delete row[key];
        } else {
          this.hydrateFields(relMeta, this.dialect.hydratableFields(relEntity), value);
        }
      }
    }
  }

  /**
   * Runs a statement whose one row carries a {@link AGGREGATE_VALUE_ALIAS} column. `Number` because `COUNT(*)` is BIGINT and
   * a caller supplying their own `types` replaces the decoding the pools do at the wire; `?? 0` because
   * a catalog that does not know the table answers with no row, which is nothing counted.
   */
  private async runCount(build: QueryBuildFn): Promise<number> {
    const [row] = await this.query<Record<typeof AGGREGATE_VALUE_ALIAS, number | null>>(build);
    return Number(row?.[AGGREGATE_VALUE_ALIAS] ?? 0);
  }

  protected override async internalCount<E extends object>(entity: Type<E>, q: QueryPage<E>, opts?: QueryOptions) {
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
    const rows = await this.query<QueryAggregateResult<E, G, A>>((ctx) => this.dialect.aggregate(ctx, entity, q, opts));
    const hydratable = this.dialect.hydratableAggregates(entity, q);
    for (const row of rows) {
      const cells: Record<string, unknown> = row;
      for (const [alias, kind] of hydratable) {
        if (cells[alias] != null) {
          cells[alias] = decodeColumn(cells[alias], kind);
        }
      }
    }
    return rows;
  }

  override async internalInsertMany<E extends object>(entity: Type<E>, rows: EntityData<E>[]) {
    const meta = getMeta(entity);
    // What comes back is one column's value, so nothing is read back for a composite: its rows
    // already carry every column of it. `sole` is what keeps every id path off such a key.
    const [idKey] = meta.ids;
    const sole = meta.ids.length === 1;
    const idField = sole ? meta.fields[idKey] : undefined;
    const generatedKey = !!idField && isAutoIncrement(idField, true);

    for (const group of partitionBySuppliedId(rows, idKey)) {
      // Header ids are only sound where every row of this statement left its key to the database, so
      // the batch is split on that alone, and a supplied id cannot void the others.
      const idsReliable =
        sole &&
        (this.dialect.insertIdSource === 'returning' ||
          (generatedKey && group.every((index) => rows[index][idKey] === undefined)));
      // Inferring multiple ids from the single header id (MySQL) assumes a known stride; a clustered
      // server may set `auto_increment_increment` > 1, so probe it (once, cached) before inferring.
      if (idsReliable && group.length > 1 && this.dialect.insertIdSource === 'firstId') {
        this.#insertIdIncrement ??= await this.loadInsertIdIncrement();
      }
      // Per group, not per batch: the two carry different columns - one names the key, one does not -
      // so a budget taken over their union would under-fill the statement that is missing one.
      for (const indexes of chunkByBindBudget(meta, rows, group, this.dialect.maxBindValues)) {
        const chunk = indexes.map((index) => rows[index]);
        const { ids = [] } = await this.exec((ctx) => this.dialect.insert(ctx, entity, chunk));
        if (idsReliable) {
          for (let position = 0; position < indexes.length; position++) {
            rows[indexes[position]][idKey] ??= ids[position] as E[typeof idKey];
          }
        }
      }
    }
    await this.insertRelations(entity, rows);
  }

  override async internalUpdateMany<E extends object>(
    entity: Type<E>,
    q: QuerySearch<E>,
    payload: UpdatePayload<E>,
    opts?: QueryOptions,
  ) {
    const { changes = 0 } = await this.exec((ctx) => this.dialect.update(ctx, entity, q, payload, opts));
    return changes;
  }

  protected override async internalUpsertOne<E extends object>(
    entity: Type<E>,
    conflictPaths: QueryConflictPaths<E>,
    payload: EntityData<E>,
  ) {
    return this.internalUpsertMany(entity, conflictPaths, [payload]);
  }

  protected override async internalUpsertMany<E extends object>(
    entity: Type<E>,
    conflictPaths: QueryConflictPaths<E>,
    payload: EntityData<E>[],
  ): Promise<QueryUpdateResult> {
    if (!payload?.length) {
      return { changes: 0 };
    }
    payload = clone(payload);
    const meta = getMeta(entity);
    // One statement per shape, each split again to stay inside the bind budget. Grouping first is
    // what makes the budget arithmetic right: every row of a group carries the same columns, so the
    // `DO UPDATE SET` resolves to non-binding `EXCLUDED` references rather than inlined values.
    const statements = groupByInsertShape(meta, payload).flatMap((group) =>
      chunkByBindBudget(meta, payload, group, this.dialect.maxBindValues),
    );
    if (statements.length === 1) {
      return this.runUpsert(entity, conflictPaths, payload);
    }
    // An upsert's assignment list is the statement's, so rows of different shapes go in statements
    // of their own, together in a transaction (`transaction` is re-entrant).
    return this.transaction(async () => {
      let changes = 0;
      // Placed by index, since grouping by shape reorders the rows. A statement reporting fewer ids
      // than it wrote places none.
      const ids: (PrimaryKey | undefined)[] = new Array(payload.length);
      for (const indexes of statements) {
        const { changes: written = 0, ids: reported } = await this.runUpsert(
          entity,
          conflictPaths,
          indexes.map((index) => payload[index]),
        );
        changes += written;
        if (reported?.length === indexes.length) {
          for (let position = 0; position < indexes.length; position++) {
            ids[indexes[position]] = reported[position];
          }
        }
      }
      // No `created`: it speaks for a single statement, and there were several.
      return { changes, ids };
    });
  }

  private async runUpsert<E extends object>(
    entity: Type<E>,
    conflictPaths: QueryConflictPaths<E>,
    payload: EntityData<E>[],
  ): Promise<QueryUpdateResult> {
    const meta = getMeta(entity);
    // Asked first: the statement fills an `onInsert` key into these rows whether it inserts them or not.
    const unnamed = meta.ids.length === 1 && payload.some((row) => !namesKey(meta, row));
    const result = await this.exec((ctx) => this.dialect.upsert(ctx, entity, conflictPaths, payload));
    const ordered =
      payload.length === 1 ||
      (this.dialect.insertIdSource === 'returning' && this.dialect.features.orderedUpsertReturning);
    if (ordered && result.ids?.length === payload.length) {
      return result;
    }
    // The statement's ids name its rows only in order and for every one. A MySQL batch reports a
    // weighted count (1=insert, 2=update) instead, CockroachDB and SQL Server answer out of order, and
    // `DO NOTHING` skips rows, so there the ids are read back by the conflict columns.
    const { changes } = result;
    const created = payload.length === 1 ? result.created : undefined;
    return unnamed
      ? { changes, created, ids: await this.idsByConflict(entity, conflictPaths, payload) }
      : { changes, created };
  }

  protected override async internalDeleteMany<E extends object>(
    entity: Type<E>,
    q: QuerySearch<E>,
    opts?: QueryOptions,
  ) {
    const { changes = 0 } = await this.exec((ctx) => this.dialect.delete(ctx, entity, q, opts));
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
      await this.internalBegin(opts);
      this.hasPendingTransaction = true;
    });
  }

  /**
   * Only an end that succeeded ends the transaction. A `COMMIT` that fails can leave it open (SQLite
   * answers `SQLITE_BUSY` and keeps it), so the flag has to stay set for the `catch` in
   * {@link AbstractQuerier.transaction} or {@link AbstractQuerier.release} to roll it back.
   */
  override async commitTransaction() {
    return this.serialize(async () => {
      if (!this.hasPendingTransaction) {
        throwNoPendingTransaction();
      }
      await this.internalCommit();
      this.hasPendingTransaction = false;
    });
  }

  override async rollbackTransaction() {
    return this.serialize(async () => {
      if (this.hasPendingTransaction) {
        await this.internalRollback();
        this.hasPendingTransaction = false;
      }
    });
  }

  /**
   * How this driver opens, commits and rolls back: the dialect's statements, unless its transactions
   * are objects rather than statements - Hrana's session handle, `mssql`'s `Transaction` - in which
   * case it overrides all three. The bookkeeping around them stays above, written once.
   */
  protected async internalBegin(opts?: TransactionOptions): Promise<void> {
    for (const sql of this.dialect.getBeginTransactionStatements(opts?.isolationLevel)) {
      await this.runTransactionCommand(sql);
    }
  }

  protected internalCommit(): Promise<void> {
    return this.runTransactionCommand(this.dialect.commitTransactionCommand);
  }

  protected internalRollback(): Promise<void> {
    return this.runTransactionCommand(this.dialect.rollbackTransactionCommand);
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
