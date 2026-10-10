import type { SelectTerm } from '../dialect/abstractSqlDialect.js';
import { AGGREGATE_VALUE_ALIAS, TOTAL_ALIAS } from '../dialect/aliases.js';
import type { AbstractSqlDialect } from '../dialect/index.js';
import { getMeta, namesKey } from '../entity/index.js';
import type {
  QueryContext,
  EntityData,
  EntityMeta,
  ExtraOptions,
  IdKey,
  Query,
  QueryAggMap,
  QueryAggregate,
  QueryAggregateResult,
  QueryBuildFn,
  QueryRaw,
  QueryConflictPaths,
  QueryPage,
  QueryGroupMap,
  QueryOptions,
  QuerySearch,
  QueryUpdateResult,
  RawRow,
  SavepointCommand,
  SqlQuerier,
  SqlStatement,
  TransactionOptions,
  Type,
  UpdatePayload,
} from '../type/index.js';
import { buildUpdateResult, chunk, clone, getInsertFieldKeys, insertShapeOf, isAutoIncrement } from '../util/index.js';
import { statementOf } from '../util/raw.js';
import type { BuildUpdateResultPayload } from '../util/sql.util.js';
import { UqlUsageError } from '../util/uqlError.js';
import { AbstractQuerier, type UpsertedId } from './abstractQuerier.js';
import { streamViaCursor } from './cursorStream.js';
import { enrichError } from './queryError.js';
import { rowReader } from './rowReader.js';

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
 * A group's row indexes split into statements of at most `maxRows` rows within the bind budget, payload order kept,
 * and a statement whose rows name no column into one per row, as `DEFAULT VALUES` writes. `DEFAULT` cells bind no
 * parameter, so fields-per-record is a safe upper bound. D1 allows 100 binds, which a couple of dozen rows reach.
 */
function chunkWithinLimits<E extends object>(
  meta: EntityMeta<E>,
  payload: EntityData<E>[],
  group: number[],
  maxBindValues: number,
  maxRows = Infinity,
): number[][] {
  const width = (indexes: number[]) =>
    getInsertFieldKeys(
      meta,
      indexes.map((index) => payload[index]),
    ).length;
  const groupWidth = width(group);
  if (!groupWidth) {
    return chunk(group, 1);
  }
  const chunks = chunk(group, Math.max(1, Math.min(maxRows, Math.floor(maxBindValues / groupWidth))));
  // A split can leave a chunk whose rows name no column; one chunk is the whole group, which names some.
  return chunks.length === 1 ? chunks : chunks.flatMap((indexes) => (width(indexes) ? [indexes] : chunk(indexes, 1)));
}

export abstract class AbstractSqlQuerier extends AbstractQuerier implements SqlQuerier {
  override hasOpenTransaction = false;
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
   * but can be higher on a cluster (e.g. Galera), and `buildUpdateResult` takes any other as 1.
   * Only called for `firstId` dialects.
   */
  protected async loadInsertIdIncrement(): Promise<number> {
    const [row] = await this.all<{ v: number | string }>`SELECT @@auto_increment_increment AS v`;
    return Number(row.v);
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

  all<T extends object = RawRow>(...statement: SqlStatement): Promise<T[]> {
    return this.query<T>(statementOf(statement));
  }

  run(...statement: SqlStatement): Promise<QueryUpdateResult> {
    return this.exec(statementOf(statement));
  }

  /** Refused before the driver fails it, or PGlite answers it and every read after it wrong. */
  private assertBindBudget(values: readonly unknown[] | undefined): void {
    const { maxBindValues, dialectName } = this.dialect;
    if (values && values.length > maxBindValues) {
      throw new UqlUsageError(
        `a statement binding ${values.length} values is past the ${maxBindValues} ${dialectName} takes; split the list it binds`,
      );
    }
  }

  /** The rows of a statement the dialect builds. */
  private query<T>(build: QueryBuildFn | QueryRaw): Promise<T[]> {
    return this.send(build, (sql, values) => this.internalAll<T>(sql, values));
  }

  /** Runs a statement the dialect builds. */
  private exec(build: QueryBuildFn | QueryRaw): Promise<QueryUpdateResult> {
    return this.send(build, (sql, values) => this.internalRun(sql, values));
  }

  /** Builds a statement and sends it on the connection, in turn, timed and its failure tagged with it. */
  private async send<T>(
    build: QueryBuildFn | QueryRaw,
    task: (sql: string, values: unknown[] | undefined) => Promise<T>,
  ): Promise<T> {
    const { sql, values } = this.dialect.compile(build);
    this.assertBindBudget(values);
    return this.serialize(async () => {
      await this.lazyConnect();
      return this.timed(sql, values, () => task(sql, values));
    });
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
    if (this.dialect.features.vectorTuningNeedsTransaction && !this.scopeHere()) {
      throw new UqlUsageError(
        `$candidates requires an open transaction on ${this.dialect.dialectName}; run the query inside pool.transaction(...)`,
      );
    }
    for (const statement of statements) {
      await this.internalRun(statement);
    }
  }

  protected override async internalFindMany<E extends object>(entity: Type<E>, q: Query<E>, opts?: QueryOptions) {
    return this.selectRows(entity, q, opts);
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
    const rows = await this.selectRows<E, E & { [TOTAL_ALIAS]?: unknown }>(entity, q, opts, TOTAL_ALIAS);
    const total = rows.length ? Number(rows[0][TOTAL_ALIAS]) : await this.countUnpaged(entity, q, opts);
    for (const row of rows) {
      delete row[TOTAL_ALIAS];
    }
    return [rows, total];
  }

  /** The rows a read of `entity` matches, each as its statement reads it. */
  private async selectRows<E extends object, T = E>(
    entity: Type<E>,
    q: Query<E>,
    opts?: QueryOptions,
    totalAlias?: string,
  ): Promise<T[]> {
    // Guarded rather than awaited unconditionally, here and in the stream below: an `await` on this
    // path defers a microtask on every read, which reorders the two statements `findManyAndCount`
    // issues concurrently. Keep the guard at any new call site.
    if (q.$candidates !== undefined) {
      await this.applyVectorTuning(entity, q);
    }
    return this.readRows<T>((ctx) => this.dialect.find(ctx, entity, q, opts, totalAlias));
  }

  /** The rows of a read the dialect builds, each as the terms it returns say. */
  private async readRows<T>(build: (ctx: QueryContext) => readonly SelectTerm[]): Promise<T[]> {
    let terms: readonly SelectTerm[] = [];
    const rows = await this.query<RawRow>((ctx) => {
      terms = build(ctx);
    });
    return rows.map(rowReader<T>(terms));
  }

  /**
   * The one read not going through `all`, so it checks its budget and connects on its own; its values go as
   * the context holds them, each normalized as it was bound. The tuning is guarded as `selectRows` says.
   */
  protected override async *internalFindManyStream<E extends object>(
    entity: Type<E>,
    q: Query<E>,
    opts?: QueryOptions,
  ) {
    const ctx = this.dialect.createContext();
    const read = rowReader<E>(this.dialect.find(ctx, entity, q, opts));
    this.assertBindBudget(ctx.values);
    if (q.$candidates !== undefined) {
      await this.applyVectorTuning(entity, q);
    }
    await this.lazyConnect();
    for await (const row of this.timedStream(ctx.sql, ctx.values, this.internalStream(ctx.sql, ctx.values))) {
      yield read(row);
    }
  }

  /**
   * A read's rows one at a time: paged through a server-side cursor where the engine has one, read whole
   * where it has none. A driver that streams on its own overrides this; a Node `Readable` it hands back
   * closes itself when the loop exits early.
   */
  protected async *internalStream(query: string, values?: unknown[]): AsyncIterable<RawRow> {
    if (!this.dialect.features.serverSideCursors) {
      yield* await this.internalAll<RawRow>(query, values);
      return;
    }
    yield* streamViaCursor<RawRow>(
      (sql, params) => this.internalAll<RawRow>(sql, params),
      query,
      values,
      !!this.scopeHere(),
    );
  }

  /**
   * Runs a statement whose one row carries a {@link AGGREGATE_VALUE_ALIAS} column. `Number` because `COUNT(*)` is BIGINT and
   * a caller supplying their own `types` replaces the decoding the pools do at the wire, and reads a `NULL`
   * as 0; no row is 0 too, since a catalog that does not know the table answers with none.
   */
  private async runCount(build: QueryBuildFn): Promise<number> {
    const [row] = await this.query<Record<typeof AGGREGATE_VALUE_ALIAS, number | null>>(build);
    return row ? Number(row[AGGREGATE_VALUE_ALIAS]) : 0;
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
    return this.readRows((ctx) => this.dialect.aggregate(ctx, entity, q, opts));
  }

  override async internalInsertMany<E extends object>(entity: Type<E>, rows: EntityData<E>[]) {
    const meta = getMeta(entity);
    // What comes back is one column's value, so nothing is read back for a composite: its rows
    // already carry every column of it. `sole` is what keeps every id path off such a key.
    const [idKey] = meta.ids;
    const sole = meta.ids.length === 1;
    const idField = sole ? meta.fields[idKey] : undefined;
    const generatedKey = !!idField && isAutoIncrement(idField, true);

    // Per group, not per batch: the two carry different columns - one names the key, one does not - so a budget
    // taken over their union would under-fill the statement that is missing one. Header ids are only sound where
    // every row of a statement left its key to the database, so a supplied id cannot void the others.
    const statements = partitionBySuppliedId(rows, idKey).flatMap((group) => {
      const idsReliable =
        sole &&
        (this.dialect.insertIdSource === 'returning' ||
          (generatedKey && group.every((index) => rows[index][idKey] === undefined)));
      const { maxBindValues, maxInsertRows } = this.dialect;
      return chunkWithinLimits(meta, rows, group, maxBindValues, maxInsertRows).map((indexes) => ({
        indexes,
        idsReliable,
      }));
    });
    // Inferring multiple ids from the single header id (MySQL) assumes a known stride; a clustered
    // server may set `auto_increment_increment` > 1, so probe it (once, cached) before inferring.
    if (
      this.dialect.insertIdSource === 'firstId' &&
      statements.some(({ indexes, idsReliable }) => idsReliable && indexes.length > 1)
    ) {
      this.#insertIdIncrement ??= await this.loadInsertIdIncrement();
    }
    const insert = async () => {
      for (const { indexes, idsReliable } of statements) {
        const statementRows = indexes.map((index) => rows[index]);
        const { ids = [] } = await this.exec((ctx) => this.dialect.insert(ctx, entity, statementRows));
        if (idsReliable) {
          for (let position = 0; position < indexes.length; position++) {
            rows[indexes[position]][idKey] ??= ids[position] as E[typeof idKey];
          }
        }
      }
    };
    await (statements.length > 1 ? this.atomically(insert) : insert());
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

  protected override async internalUpsertMany<E extends object>(
    entity: Type<E>,
    conflictPaths: QueryConflictPaths<E>,
    payload: E[],
    update?: UpdatePayload<E>,
  ): Promise<(UpsertedId<E> | undefined)[] | undefined> {
    if (!payload.length) {
      return [];
    }
    payload = clone(payload);
    const meta = getMeta(entity);
    // One statement per shape, each split again to fit the bind budget, less what its assignments bind once.
    // Grouping first is what makes that one figure: every row of a group carries the same columns. No row cap:
    // the one engine with one, SQL Server, upserts through a MERGE, whose source takes any number.
    const statements = groupByInsertShape(meta, payload).flatMap((group) => {
      const assigned = this.dialect.upsertAssignmentBinds(entity, conflictPaths, payload[group[0]], update);
      return chunkWithinLimits(meta, payload, group, this.dialect.maxBindValues - assigned);
    });
    if (statements.length === 1) {
      return this.runUpsert(entity, conflictPaths, payload, update);
    }
    // An upsert's assignment list is the statement's, so rows of different shapes go in statements of their own.
    return this.atomically(async () => {
      // Placed by index, since grouping by shape reorders the rows. A statement reporting fewer ids
      // than it wrote places none.
      const ids: (UpsertedId<E> | undefined)[] = new Array(payload.length);
      for (const indexes of statements) {
        const reported = await this.runUpsert(
          entity,
          conflictPaths,
          indexes.map((index) => payload[index]),
          update,
        );
        if (reported?.length === indexes.length) {
          for (let position = 0; position < indexes.length; position++) {
            ids[indexes[position]] = reported[position];
          }
        }
      }
      return ids;
    });
  }

  private async runUpsert<E extends object>(
    entity: Type<E>,
    conflictPaths: QueryConflictPaths<E>,
    payload: E[],
    update?: UpdatePayload<E>,
  ): Promise<(UpsertedId<E> | undefined)[] | undefined> {
    const meta = getMeta(entity);
    // Asked first: the statement fills an `onInsert` key into these rows whether it inserts them or not.
    const unnamed = payload.some((row) => !namesKey(meta, row));
    const { ids } = await this.exec((ctx) => this.dialect.upsert(ctx, entity, conflictPaths, payload, update));
    const ordered =
      payload.length === 1 ||
      (this.dialect.insertIdSource === 'returning' && this.dialect.features.orderedUpsertReturning);
    if (meta.ids.length === 1 && ordered && ids?.length === payload.length) {
      return ids;
    }
    // The statement's ids name its rows only in order and for every one. A MySQL batch reports a
    // weighted count (1=insert, 2=update) instead, CockroachDB and SQL Server answer out of order, and
    // `DO NOTHING` skips rows, so there the ids are read back by the conflict columns.
    return unnamed ? this.idsByConflict(entity, conflictPaths, payload) : undefined;
  }

  protected override async internalDeleteMany<E extends object>(
    entity: Type<E>,
    q: QuerySearch<E>,
    opts?: QueryOptions,
  ) {
    const { changes = 0 } = await this.exec((ctx) => this.dialect.delete(ctx, entity, q, opts));
    return changes;
  }

  protected override async openTransaction(opts?: TransactionOptions) {
    await this.lazyConnect();
    await this.internalBegin(opts);
    this.hasOpenTransaction = true;
  }

  /**
   * A `COMMIT` that fails can leave the transaction open (SQLite answers `SQLITE_BUSY` and keeps it), so the
   * flag stays for the rollback after it. A `ROLLBACK` always ends it: one the server refuses, a deadlock
   * victim's on SQL Server, left nothing open to roll back.
   */
  protected override async endTransaction(commit: boolean) {
    if (commit) {
      await this.internalCommit();
      this.hasOpenTransaction = false;
      return;
    }
    try {
      await this.internalRollback();
    } finally {
      this.hasOpenTransaction = false;
    }
  }

  protected override async savepoint(command: SavepointCommand, name: string): Promise<void> {
    const sql = this.dialect.savepointStatement(command, name);
    if (sql) {
      await this.runTransactionCommand(sql);
    }
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
