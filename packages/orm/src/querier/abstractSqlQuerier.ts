import type { SelectTerm } from '../dialect/abstractSqlDialect.js';
import { AGGREGATE_VALUE_ALIAS, TOTAL_ALIAS } from '../dialect/aliases.js';
import type { AbstractSqlDialect } from '../dialect/index.js';
import { getMeta } from '../entity/index.js';
import { soleId } from '../entity/metadata/definition.js';
import type {
  QueryContext,
  EntityData,
  EntityMeta,
  ExtraOptions,
  IdKey,
  PrimaryKey,
  Query,
  QueryAggregate,
  QueryBuildFn,
  FieldKey,
  QuerySql,
  QueryConflictPaths,
  QueryPage,
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
import {
  buildUpdateResult,
  chunk,
  clone,
  getInsertFieldKeys,
  insertShapeOf,
  isAutoIncrement,
  upsertKeepsOwnKey,
} from '../util/index.js';
import { statementOf } from '../util/sql.js';
import type { SqlExecution } from '../util/sql.util.js';
import { UqlUsageError } from '../util/uqlError.js';
import { AbstractQuerier, type UpsertedId, type WritesReturning } from './abstractQuerier.js';
import { streamViaCursor } from './cursorStream.js';
import { enrichError, failedIndexOf } from './queryError.js';
import { rowReader } from './rowReader.js';

/** A statement as it is sent: its SQL and the values it binds. */
export type BoundStatement = {
  readonly sql: string;
  readonly values: unknown[];
};

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

  /** Runs one statement on the driver: what it read, how many rows it changed, and any id its header reports. */
  protected abstract execute(sql: string, values?: unknown[]): Promise<SqlExecution>;

  /** What a write reports: the rows it changed, and their ids, inferred from a header's first id where the dialect reads them so. */
  private updateResultOf(result: SqlExecution): Required<QueryUpdateResult> {
    return buildUpdateResult({
      ...result,
      insertIdSource: this.dialect.insertIdSource,
      insertIdIncrement: this.#insertIdIncrement,
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
    this.assertActive();
  }

  all<T extends object = RawRow>(...statement: SqlStatement): Promise<T[]> {
    return this.rowsOf<T>(statementOf(statement));
  }

  run(...statement: SqlStatement): Promise<QueryUpdateResult> {
    return this.changesOf(statementOf(statement));
  }

  /**
   * Runs `statements` as one request, all or none, joining an open transaction: what a driver taking a list as one
   * declares. Called for two or more.
   */
  protected executeBatch?(statements: readonly BoundStatement[]): Promise<SqlExecution[]>;

  /**
   * The one path every statement takes, alone or as a list answering a result each, all or none: one request where
   * the driver has {@link executeBatch}, a failure tagged with the statement it names; else in turn, in a transaction
   * where `atomic` (a split write) asks for one, opened before the queue is taken, which its `BEGIN` waits on.
   */
  protected runStatements(statements: readonly BoundStatement[], atomic = false): Promise<readonly SqlExecution[]> {
    const executeBatch = statements.length > 1 ? this.executeBatch?.bind(this) : undefined;
    if (!executeBatch) {
      const inTurn = () => this.inTurn(statements);
      return atomic ? this.atomically(inTurn) : inTurn();
    }
    const sql = statements.map((statement) => statement.sql).join('; ');
    const values = statements.flatMap((statement) => statement.values);
    return this.onConnection(() =>
      this.timed(sql, values, () =>
        executeBatch(statements).catch((error: unknown) => {
          const statement = statements[failedIndexOf(error) ?? -1];
          throw statement ? enrichError(error, this.logger, statement.sql, statement.values) : error;
        }),
      ),
    );
  }

  /** Runs `statements` one after another on the connection, each timed. */
  private inTurn(statements: readonly BoundStatement[]): Promise<SqlExecution[]> {
    return this.onConnection(async () => {
      const results: SqlExecution[] = [];
      for (const { sql, values } of statements) {
        results.push(await this.timed(sql, values, () => this.execute(sql, values)));
      }
      return results;
    });
  }

  /** Runs `task` on the connection, connected, after everything queued before it. */
  private onConnection<T>(task: () => Promise<T>): Promise<T> {
    return this.serialize(() => this.lazyConnect().then(task));
  }

  /** The statement `build` writes, refused past the bind budget before the driver fails it. */
  private bound(build: QueryBuildFn | QuerySql): BoundStatement {
    const { sql, values } = this.dialect.compile(build);
    this.assertBindBudget(values);
    return { sql, values };
  }

  /** Refused before the driver fails it, or PGlite answers it and every read after it wrong. */
  private assertBindBudget(values: readonly unknown[] | undefined): void {
    const { maxBindValues, engineName } = this.dialect;
    if (values && values.length > maxBindValues) {
      throw new UqlUsageError(
        `a statement binding ${values.length} values is past the ${maxBindValues} ${engineName} takes; split the list it binds`,
      );
    }
  }

  /** The rows of the statement `build` writes, as the caller types them. */
  private async rowsOf<T>(build: QueryBuildFn | QuerySql): Promise<T[]> {
    const [{ rows }] = await this.runStatements([this.bound(build)]);
    return rows as T[];
  }

  /** What the write `build` writes reports. */
  private async changesOf(build: QueryBuildFn | QuerySql): Promise<Required<QueryUpdateResult>> {
    const [result] = await this.runStatements([this.bound(build)]);
    return this.updateResultOf(result);
  }

  /** The `SET`s tuning an ANN index for the query, leading its read: none without a vector search or an ANN index. */
  private vectorTuning<E>(entity: Type<E>, q: Query<E>): readonly BoundStatement[] {
    if (q.$candidates === undefined) {
      return [];
    }
    return this.dialect.vectorTuningStatements(getMeta(entity), q).map((sql) => ({ sql, values: [] }));
  }

  /** Whether `tuning` applies only inside a transaction, as a `SET LOCAL` does: a read opens one, or joins the open one. */
  private tunedInTransaction(tuning: readonly BoundStatement[]): boolean {
    return tuning.length > 0 && this.dialect.features.vectorTuningNeedsTransaction;
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

  /**
   * The rows a read of `entity` matches, each as its statement reads it, the vector search's tuning leading it, in a
   * transaction of its own where the tuning needs one and none is open.
   */
  private selectRows<E extends object, T = E>(
    entity: Type<E>,
    q: Query<E>,
    opts?: QueryOptions,
    totalAlias?: string,
  ): Promise<T[]> {
    const tuning = this.vectorTuning(entity, q);
    const build = (ctx: QueryContext) => this.dialect.find(ctx, entity, q, opts, totalAlias);
    return this.readRows<T>(build, tuning, this.tunedInTransaction(tuning));
  }

  /** The rows of a statement the dialect builds, each as the terms it returns say, after the `leading` ones. */
  private async readRows<T>(
    build: (ctx: QueryContext) => readonly SelectTerm[],
    leading: readonly BoundStatement[] = [],
    atomic = false,
  ): Promise<T[]> {
    let terms: readonly SelectTerm[] = [];
    const statement = this.bound((ctx) => {
      terms = build(ctx);
    });
    const results = await this.runStatements([...leading, statement], atomic);
    return results[leading.length].rows.map(rowReader<T>(terms));
  }

  /**
   * The one read not going through `runStatements`: it holds the connection for its loop, so it checks its budget
   * and connects on its own, its values going as the context holds them, each normalized as it was bound. Tuning
   * that needs a transaction is refused outside one, which would otherwise stay open for the whole loop.
   */
  protected override async *internalFindManyStream<E extends object>(
    entity: Type<E>,
    q: Query<E>,
    opts?: QueryOptions,
  ) {
    const tuning = this.vectorTuning(entity, q);
    if (this.tunedInTransaction(tuning) && !this.scopeHere()) {
      throw new UqlUsageError(
        `a streamed $candidates needs an open transaction on ${this.dialect.engineName}; run the stream inside pool.transaction(...)`,
      );
    }
    const ctx = this.dialect.createContext();
    const read = rowReader<E>(this.dialect.find(ctx, entity, q, opts));
    this.assertBindBudget(ctx.values);
    await this.lazyConnect();
    for (const { sql } of tuning) {
      await this.timed(sql, undefined, () => this.execute(sql));
    }
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
      yield* (await this.execute(query, values)).rows;
      return;
    }
    yield* streamViaCursor<RawRow>(
      async (sql, params) => (await this.execute(sql, params)).rows,
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
    const [row] = await this.rowsOf<Record<typeof AGGREGATE_VALUE_ALIAS, number | null>>(build);
    return row ? Number(row[AGGREGATE_VALUE_ALIAS]) : 0;
  }

  protected override async internalCount<E extends object>(entity: Type<E>, q: QueryPage<E>, opts?: QueryOptions) {
    return this.runCount((ctx) => this.dialect.count(ctx, entity, q, opts));
  }

  override async estimatedCount<E extends object>(entity: Type<E>) {
    return this.runCount((ctx) => this.dialect.estimatedCount(ctx, entity));
  }

  protected override async internalAggregate<E extends object>(
    entity: Type<E>,
    q: QueryAggregate<E>,
    opts?: QueryOptions,
  ): Promise<RawRow[]> {
    return this.readRows<RawRow>((ctx) => this.dialect.aggregate(ctx, entity, q, opts));
  }

  override async internalInsertMany<E extends object>(entity: Type<E>, rows: EntityData<E>[]) {
    const meta = getMeta(entity);
    // What comes back is one column's value, so nothing is read back for a composite: its rows
    // already carry every column of it. `sole` is what keeps every id path off such a key.
    const [idKey] = meta.ids;
    const sole = soleId(meta);
    const generatedKey = !!sole && isAutoIncrement(sole.field, true);

    // Per group, not per batch: the two carry different columns - one names the key, one does not - so a budget
    // taken over their union would under-fill the statement that is missing one. Header ids are only sound where
    // every row of a statement left its key to the database, so a supplied id cannot void the others.
    const statements = partitionBySuppliedId(rows, idKey).flatMap((group) => {
      const idsReliable =
        !!sole &&
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
    const results = await this.runStatements(
      statements.map(({ indexes }) => {
        const statementRows = indexes.map((index) => rows[index]);
        return this.bound((ctx) => this.dialect.insert(ctx, entity, statementRows));
      }),
      statements.length > 1,
    );
    results.forEach((result, at) => {
      const { indexes, idsReliable } = statements[at];
      if (idsReliable) {
        const { ids } = this.updateResultOf(result);
        indexes.forEach((index, position) => {
          rows[index][idKey] ??= ids[position] as E[typeof idKey];
        });
      }
    });
  }

  override async internalUpdateMany<E extends object>(
    entity: Type<E>,
    q: QuerySearch<E>,
    payload: UpdatePayload<E>,
    opts?: QueryOptions,
  ) {
    const { changes } = await this.changesOf((ctx) => this.dialect.update(ctx, entity, q, payload, opts));
    return changes;
  }

  /** `UPDATE` and `DELETE` with a `RETURNING` read as a read's rows are, where the engine has it. */
  protected override get writesReturning(): WritesReturning | undefined {
    return this.dialect.features.writeReturning ? this.#returningWrites : undefined;
  }

  readonly #returningWrites: WritesReturning = {
    update: (entity, q, payload, opts, keys) =>
      this.reportedRows(entity, keys, (ctx) => this.dialect.update(ctx, entity, q, payload, opts)),
    delete: (entity, q, opts, keys) =>
      this.reportedRows(entity, keys, (ctx) => this.dialect.delete(ctx, entity, q, opts)),
  };

  /** The rows the write `build` renders reports, `RETURNING` the fields `keys` names. */
  private reportedRows<E extends object>(
    entity: Type<E>,
    keys: readonly FieldKey<E>[],
    build: (ctx: QueryContext) => void,
  ): Promise<E[]> {
    return this.readRows((ctx) => {
      build(ctx);
      return this.dialect.returning(ctx, entity, keys);
    });
  }

  protected override async internalUpsertMany<E extends object>(
    entity: Type<E>,
    conflictPaths: QueryConflictPaths<E>,
    payload: E[],
    update?: UpdatePayload<E>,
  ): Promise<(UpsertedId<E> | undefined)[]> {
    if (!payload.length) {
      return [];
    }
    payload = clone(payload);
    const meta = getMeta(entity);
    // One statement per shape, each split again to fit the bind budget, less what its assignments bind once.
    // Grouping first is what makes that one figure: every row of a group carries the same columns. No row cap:
    // the one engine with one, SQL Server, upserts through a MERGE, whose source takes any number.
    const groups = groupByInsertShape(meta, payload).flatMap((group) => {
      const { binds, assigns } = this.dialect.upsertAssignments(entity, conflictPaths, payload[group[0]], update);
      const chunks = chunkWithinLimits(meta, payload, group, this.dialect.maxBindValues - binds);
      // `reports`: the statement answers each row's id in order, which spares the read back.
      return chunks.map((indexes) => ({
        indexes,
        reports: assigns && this.dialect.upsertReportsIds(meta, indexes.length),
      }));
    });
    // Asked first: the statement fills an `onInsert` key into these rows whether it inserts them or not.
    const kept = payload.map((row) => upsertKeepsOwnKey(meta, conflictPaths, row));
    const statements = groups.map(({ indexes }) =>
      this.bound((ctx) =>
        this.dialect.upsert(
          ctx,
          entity,
          conflictPaths,
          indexes.map((index) => payload[index]),
          update,
        ),
      ),
    );
    const results = await this.runStatements(statements, groups.length > 1);
    // Placed by index, since grouping by shape reorders the rows. A statement reporting fewer ids than it
    // wrote places none.
    const ids: (UpsertedId<E> | undefined)[] = new Array(payload.length);
    groups.forEach(({ indexes, reports }, group) => {
      const reported = reports ? this.reportedIds(results[group]) : [];
      if (reported.length === indexes.length) {
        indexes.forEach((index, position) => {
          ids[index] = reported[position];
        });
      }
    });
    // Where the statement cannot report every row's id in order (see `upsertReportsIds`), or assigns a found row
    // nothing, `DO NOTHING`, which skips it, the ids are read back by the conflict columns.
    return this.withUnreportedIds(entity, conflictPaths, payload, ids, kept);
  }

  /** The ids an upsert reports of its rows: its `RETURNING` rows' in order, or its one row's in the header. */
  private reportedIds(result: SqlExecution): (PrimaryKey | undefined)[] {
    if (result.rows.length) {
      return this.updateResultOf(result).ids;
    }
    return result.id ? [result.id] : [];
  }

  protected override async internalDeleteMany<E extends object>(
    entity: Type<E>,
    q: QuerySearch<E>,
    opts?: QueryOptions,
  ) {
    const { changes } = await this.changesOf((ctx) => this.dialect.delete(ctx, entity, q, opts));
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
    for (const sql of this.dialect.getBeginTransactionStatements(opts)) {
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
      await this.execute(sql);
    } catch (err) {
      throw enrichError(err, this.logger, sql);
    }
  }
}
