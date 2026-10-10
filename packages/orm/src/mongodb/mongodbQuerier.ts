import type {
  AggregationCursor,
  ClientSession,
  Document,
  FindCursor,
  MongoClient,
  OptionalUnlessRequiredId,
  UpdateFilter,
} from 'mongodb';
import { AGGREGATE_VALUE_ALIAS } from '../dialect/aliases.js';
import { hasRequiredJoin } from '../dialect/queryJoins.js';
import { fieldOf, getMeta, namesKey, soleIdOf } from '../entity/index.js';
import type { UpsertedId } from '../querier/abstractQuerier.js';
import { AbstractQuerier } from '../querier/index.js';
import type {
  EntityData,
  EntityMeta,
  ExtraOptions,
  IdValue,
  PrimaryKey,
  Query,
  QueryAggMap,
  QueryAggregate,
  QueryAggregateResult,
  QueryConflictPaths,
  QueryPage,
  QueryGroupMap,
  QueryOptions,
  QueryPager,
  QuerySearch,
  TransactionOptions,
  Type,
  UpdatePayload,
} from '../type/index.js';
import {
  clone,
  getKeys,
  getSoftDeleteValue,
  hasKeys,
  hasTriggers,
  populatesRelations,
  textSortOf,
  vectorCandidates,
  withoutSoftDeleteFilter,
  whereEach,
} from '../util/index.js';
import { UqlUsageError } from '../util/uqlError.js';

import type { ExtractedVectorSort, MongoAggregationPipelineEntry, MongoDialect } from './mongoDialect.js';
import type { MongoQuerier } from './mongoQuerier.js';

/**
 * `$limit: 0` asks for no rows, the way it does on every SQL dialect - but MongoDB reads `limit(0)`
 * as *unlimited*, so a read that passed it straight to the driver came back with the whole
 * collection. The reads answer it here instead, since no cursor can express it.
 */
function asksForNoRows(q: QueryPager): boolean {
  return q.$limit === 0;
}

/**
 * MongoDB runs no trigger within a write (Atlas Database Triggers fire after the commit), so a write to
 * an entity declaring one - a stamp included - would skip it silently. Refused instead, as a query naming
 * SQL is.
 */
function refuseTriggers(entity: Type<object>): void {
  if (hasTriggers(getMeta(entity))) {
    throw new UqlUsageError(
      `'${entity.name}' declares triggers, which MongoDB cannot run within a write: a write here would skip them. ` +
        'Keep the entity on a SQL engine, or drop its triggers and stamps.',
    );
  }
}

export class MongodbQuerier extends AbstractQuerier implements MongoQuerier {
  #session?: ClientSession;

  /** The open transaction's session, for a raw call through `db` to run inside it: `{ session: querier.session }`. */
  get session(): ClientSession | undefined {
    return this.#session;
  }

  constructor(
    readonly dialect: MongoDialect,
    readonly conn: MongoClient,
    override readonly extra?: ExtraOptions,
  ) {
    super(extra);
  }

  private async execute<T>(task: (session: ClientSession) => Promise<T>): Promise<T> {
    return this.serialize(async () => {
      return task(this.#session!);
    });
  }

  protected override async internalFindMany<E extends Document>(entity: Type<E>, q: Query<E>, opts?: QueryOptions) {
    if (asksForNoRows(q)) {
      return [];
    }
    return this.timed('internalFindMany', undefined, async () => {
      const cursor = this.readCursor(entity, q, opts);
      return this.dialect.normalizeIds(getMeta(entity), await this.execute(() => cursor.toArray()));
    });
  }

  protected override async *internalFindManyStream<E extends Document>(
    entity: Type<E>,
    q: Query<E>,
    opts?: QueryOptions,
  ) {
    if (asksForNoRows(q)) {
      return;
    }
    const meta = getMeta(entity);
    for await (const doc of this.timedStream('internalFindManyStream', undefined, this.readCursor(entity, q, opts))) {
      yield this.dialect.normalizeId(meta, doc);
    }
  }

  /**
   * The cursor a read runs on: the aggregation pipeline for a clause only a stage can express - a
   * lookup, a grouping, a vector search - and the plain `find` cursor for everything else. One routing
   * for a read and a stream alike, so both load the same relations.
   */
  private readCursor<E extends Document>(
    entity: Type<E>,
    q: Query<E>,
    opts?: QueryOptions,
  ): AggregationCursor<E> | FindCursor<E> {
    const vectorSort = this.dialect.extractVectorSort(q.$sort);
    const pipeline = vectorSort
      ? this.buildVectorPipeline(entity, q, vectorSort, opts)
      : this.readsThroughPipeline(entity, q) && this.dialect.aggregationPipeline(entity, q, opts);
    return pipeline
      ? this.collection(entity).aggregate<E>(pipeline, { session: this.#session })
      : this.buildFindCursor(entity, q, opts);
  }

  /**
   * Whether a read needs stages a `find` cursor cannot express: a lookup to populate, count, filter or
   * order by a relation, one to build a relation aggregate, and the grouping `$distinct` is.
   */
  private readsThroughPipeline<E extends Document>(entity: Type<E>, q: Query<E>): boolean {
    return (
      !!q.$distinct ||
      hasKeys(q.$count) ||
      populatesRelations(getMeta(entity), q.$populate) ||
      this.dialect.constrainsRelations(entity, q.$where) ||
      this.dialect.sortsRelations(entity, q.$sort) ||
      this.dialect.readsAggregates(entity, q) ||
      // A placement is a field the pipeline adds and orders by; a `find` cursor can add none.
      hasKeys(this.dialect.sortPlan(entity, q).fields) ||
      textSortOf(q.$sort) !== undefined
    );
  }

  private buildScalarProjection<E extends Document>(entity: Type<E>, q: Query<E>) {
    return this.dialect.select(entity, q.$select, q.$exclude);
  }

  /** Build a MongoDB FindCursor with filter, projection, sort, skip, and limit from the query. */
  private buildFindCursor<E extends Document>(entity: Type<E>, q: Query<E>, opts?: QueryOptions) {
    const cursor = this.collection(entity).find<E>({}, { session: this.#session });

    const filter = this.dialect.where(entity, q.$where, opts);
    if (hasKeys(filter)) {
      cursor.filter(filter);
    }
    const select = this.buildScalarProjection(entity, q);
    if (hasKeys(select)) {
      cursor.project(select);
    }
    const sort = this.dialect.sort(entity, q);
    if (hasKeys(sort)) {
      cursor.sort(sort);
    }
    if (q.$skip) {
      cursor.skip(q.$skip);
    }
    // Only a positive limit reaches the driver; `asksForNoRows` took the zero.
    if (q.$limit) {
      cursor.limit(q.$limit);
    }

    return cursor;
  }

  /**
   * Build an aggregation pipeline for vector similarity search.
   * `$vectorSearch` is always the first stage; `$where` is merged into its `filter`.
   */
  private buildVectorPipeline<E extends Document>(
    entity: Type<E>,
    q: Query<E>,
    vectorSort: ExtractedVectorSort<E>,
    opts?: QueryOptions,
  ): MongoAggregationPipelineEntry<Document>[] {
    const scoreAlias = vectorSort.vectorSearch.$project;
    return [
      this.dialect.buildVectorSearchStage(
        entity,
        vectorSort.vectorKey,
        vectorSort.vectorSearch,
        q.$where,
        q.$limit ?? 10,
        opts,
        vectorCandidates(q),
      ),
      // `$vectorSearch` has already applied `$limit`, so the pager is its own.
      ...this.dialect.readStages(entity, q, {
        sort: this.dialect.sortPlan(entity, { ...q, $sort: vectorSort.regularSort }),
        score: scoreAlias ? { field: scoreAlias, meta: 'vectorSearchScore' } : undefined,
      }),
    ];
  }

  protected override async internalAggregate<E extends Document, G extends QueryGroupMap<E>, A extends QueryAggMap<E>>(
    entity: Type<E>,
    q: QueryAggregate<E, G, A>,
    opts?: QueryOptions,
  ): Promise<QueryAggregateResult<E, G, A>[]> {
    return this.timed('internalAggregate', undefined, async () => {
      const pipeline = this.dialect.buildAggregateStages(entity, q, opts);
      const rows = await this.execute((session) =>
        this.collection(entity).aggregate<QueryAggregateResult<E, G, A>>(pipeline, { session }).toArray(),
      );
      return this.dialect.normalizeAggregateRows(entity, q, rows);
    });
  }

  /**
   * A `$required` relation drops parents that have no match, and `$distinct` collapses them, so both
   * totals have to be taken after the stage that does it - which only the read pipeline builds. Every
   * other query counts through {@link internalCount}, which needs no pipeline of its own.
   */
  protected override async internalFindManyAndCount<E extends Document>(
    entity: Type<E>,
    q: Query<E>,
    opts?: QueryOptions,
  ): Promise<[E[], number]> {
    if (!q.$distinct && !hasRequiredJoin(getMeta(entity), q)) {
      return super.internalFindManyAndCount(entity, q, opts);
    }
    const { $sort: _sort, $skip: _skip, $limit: _limit, ...unpaged } = q;
    const [founds, counted] = await Promise.all([
      this.internalFindMany(entity, q, opts),
      this.execute((session) =>
        this.collection(entity)
          .aggregate<Record<typeof AGGREGATE_VALUE_ALIAS, number>>(
            [...this.dialect.aggregationPipeline(entity, unpaged, opts), { $count: AGGREGATE_VALUE_ALIAS }],
            { session },
          )
          .toArray(),
      ),
    ]);
    return [founds, counted[0]?.[AGGREGATE_VALUE_ALIAS] ?? 0];
  }

  /** The pipeline `countDocuments` runs, spelled out so a relation condition gets its lookups and a page its stages. */
  protected override async internalCount<E extends Document>(entity: Type<E>, q: QueryPage<E>, opts?: QueryOptions) {
    if (asksForNoRows(q)) {
      return 0;
    }
    return this.timed('internalCount', undefined, async () => {
      const pipeline = [
        ...this.dialect.matchStages(entity, q.$where, opts),
        ...this.dialect.pagerStages(q),
        { $count: AGGREGATE_VALUE_ALIAS },
      ];
      const [counted] = await this.execute((session) =>
        this.collection(entity)
          .aggregate<Record<typeof AGGREGATE_VALUE_ALIAS, number>>(pipeline, { session })
          .toArray(),
      );
      return counted?.[AGGREGATE_VALUE_ALIAS] ?? 0;
    });
  }

  /**
   * The collection's metadata count, which the driver exposes as its own call and which takes no
   * filter - the reason {@link UniversalQuerier.estimatedCount} takes none either.
   */
  override async estimatedCount<E extends Document>(entity: Type<E>) {
    return this.timed('estimatedCount', undefined, async () =>
      this.execute((session) => this.collection(entity).estimatedDocumentCount({ session })),
    );
  }

  override async internalInsertMany<E extends Document>(entity: Type<E>, rows: EntityData<E>[]) {
    refuseTriggers(entity);
    return this.timed('internalInsertMany', undefined, async () => {
      const meta = getMeta(entity);
      const persistables = this.dialect.getPersistables(meta, rows, 'onInsert') as OptionalUnlessRequiredId<E>[];

      const { insertedIds } = await this.execute((session) =>
        this.collection(entity).insertMany(persistables, { session }),
      );

      const ids = Object.values(insertedIds).map((id) => this.dialect.fromWireId(id)) as IdValue<E>[];

      const idKey = soleIdOf(meta, 'insert');
      for (let index = 0; index < rows.length; index++) {
        rows[index][idKey] = ids[index];
      }
    });
  }

  override async internalUpdateMany<E extends Document>(
    entity: Type<E>,
    qm: QuerySearch<E>,
    payload: UpdatePayload<E>,
    opts?: QueryOptions,
  ) {
    refuseTriggers(entity);
    return this.timed('internalUpdateMany', undefined, async () => {
      const persistable = this.dialect.getPersistable(getMeta(entity), payload as E, 'onUpdate');
      const filter = this.dialect.where(entity, qm.$where, opts);
      const update = this.dialect.getUpdateFilter<E>(persistable);
      const { matchedCount } = await this.execute((session) =>
        this.collection(entity).updateMany(filter, update, { session }),
      );
      return matchedCount;
    });
  }

  /**
   * What an upsert writes, as SQL's does: a found document takes the payload and the `onUpdate` fills, and only
   * an inserted one the `onInsert` fills and the key, which is immutable, so in `$set` it would refuse every match.
   */
  private upsertUpdate<E extends Document>(meta: EntityMeta<E>, payload: E): UpdateFilter<E> {
    const updated: Document = this.dialect.getPersistable(meta, clone(payload), 'onUpdate');
    const inserted: Document = this.dialect.getPersistable(meta, clone(payload), 'onInsert');
    const insertOnly = Object.fromEntries(Object.entries(inserted).filter(([column]) => !(column in updated)));
    const update: Document = {};
    if (hasKeys(updated)) {
      update['$set'] = updated;
    }
    if (hasKeys(insertOnly)) {
      update['$setOnInsert'] = insertOnly;
    }
    return update;
  }

  private buildConflictFilter<E extends Document>(
    entity: Type<E>,
    conflictPaths: QueryConflictPaths<E>,
    item: EntityData<E>,
  ) {
    return this.dialect.where(
      entity,
      whereEach(getKeys(conflictPaths), (key) => item[key]),
    );
  }

  /**
   * An upsert whose conflicting document takes `update`, which no single call pairs with inserting the payload:
   * `$setOnInsert` and `$inc` on one field conflict. So the row inserts if absent, and a document it found,
   * a concurrent one included, then takes `update`.
   */
  private async upsertWithUpdate<E extends Document>(
    entity: Type<E>,
    conflictPaths: QueryConflictPaths<E>,
    row: E,
    update: UpdatePayload<E>,
  ) {
    const persistable = this.dialect.getPersistable(getMeta(entity), clone(row), 'onInsert');
    const res = await this.execute((session) =>
      this.collection(entity).findOneAndUpdate(
        this.buildConflictFilter(entity, conflictPaths, row),
        { $setOnInsert: persistable },
        { upsert: true, returnDocument: 'after', includeResultMetadata: true, session },
      ),
    );
    // `updatedExisting` is false where the document was inserted; an empty `update` leaves a found one
    // as it is, as `DO NOTHING` does.
    if (res.lastErrorObject?.['updatedExisting'] && hasKeys(update)) {
      await this.internalUpdateMany(entity, { $where: whereEach(getKeys(conflictPaths), (key) => row[key]) }, update);
    }
    return this.dialect.fromWireId(res.value?._id) as PrimaryKey | undefined;
  }

  protected override async internalUpsertMany<E extends Document>(
    entity: Type<E>,
    conflictPaths: QueryConflictPaths<E>,
    payload: E[],
    update?: UpdatePayload<E>,
  ) {
    refuseTriggers(entity);
    if (update) {
      const ids: (UpsertedId<E> | undefined)[] = [];
      for (const row of payload) {
        ids.push(await this.upsertWithUpdate(entity, conflictPaths, row, update));
      }
      return ids;
    }
    return this.timed('upsertMany', undefined, async () => {
      if (!payload.length) {
        return [];
      }
      const meta = getMeta(entity);
      // Asked before `getPersistable` fills an `onInsert` key into rows it may only update.
      const unnamed = payload.map((row) => !namesKey(meta, row));
      const operations = payload.map((item) => ({
        updateOne: {
          filter: this.buildConflictFilter(entity, conflictPaths, item),
          update: this.upsertUpdate(meta, item),
          upsert: true,
        },
      }));
      const res = await this.execute((session) => this.collection(entity).bulkWrite(operations, { session }));
      // `upsertedIds` names only the documents inserted, keyed by operation index, so each lands on
      // its own row; an updated document's `_id` is read back by the conflict fields instead.
      const reported = payload.map((_, index) => {
        const id = res.upsertedIds[index];
        return id === undefined ? undefined : (this.dialect.fromWireId(id) as PrimaryKey);
      });
      const unplaced = reported.some((id, index) => id === undefined && unnamed[index]);
      const found = unplaced ? await this.idsByConflict(entity, conflictPaths, payload) : [];
      return reported.map((id, index) => id ?? found[index]);
    });
  }

  protected override async internalDeleteMany<E extends Document>(
    entity: Type<E>,
    qm: QuerySearch<E>,
    opts: QueryOptions = {},
  ) {
    refuseTriggers(entity);
    return this.timed('internalDeleteMany', undefined, async () => {
      const meta = getMeta(entity);
      // Soft-delete (stamp) unless `hardDelete` is requested or the entity has no soft-delete field.
      const softDelete = opts.hardDelete ? undefined : meta.softDelete;
      if (!softDelete) {
        const filter = this.dialect.where(entity, qm.$where, {
          ...opts,
          filters: withoutSoftDeleteFilter(opts.filters),
        });
        const { deletedCount } = await this.execute((session) =>
          this.collection(entity).deleteMany(filter, { session }),
        );
        return deletedCount;
      }
      const field = fieldOf(meta, softDelete);
      // The mapped column, which reads filter on: a `@Field({ name })` mismatch would leave the row visible.
      const column = this.dialect.resolveColumnName(softDelete, field);
      const update = { $set: { [column]: getSoftDeleteValue(field) } } as UpdateFilter<E>;
      const filter = this.dialect.where(entity, qm.$where, opts);
      const { matchedCount } = await this.execute((session) =>
        this.collection(entity).updateMany(filter, update, { session }),
      );
      return matchedCount;
    });
  }

  override get hasOpenTransaction(): boolean {
    return !!this.#session?.inTransaction();
  }

  /** Every read and write goes through here, which makes it where a released querier is caught. */
  collection<E extends Document>(entity: Type<E>) {
    if (this.released) {
      throw new UqlUsageError('querier already released');
    }
    const { name } = getMeta(entity);
    return this.db.collection<E>(name!);
  }

  get db() {
    return this.conn.db();
  }

  protected override async openTransaction(_opts?: TransactionOptions) {
    this.logger.logInfo('startTransaction');
    await this.#session?.endSession();
    this.#session = this.conn.startSession();
    this.#session.startTransaction();
  }

  /**
   * The driver owns the transaction state here and settles it in its own `finally`, so a failed commit
   * or abort still leaves `inTransaction()` false and the querier releasable.
   */
  protected override async endTransaction(commit: boolean) {
    this.logger.logInfo(commit ? 'commitTransaction' : 'abortTransaction');
    await (commit ? this.#session?.commitTransaction() : this.#session?.abortTransaction());
  }

  override async internalRelease() {
    const session = this.#session;
    // Cleared first, so a failing `endSession` cannot leave the querier holding a session it already
    // tried to end.
    this.#session = undefined;
    await session?.endSession();
  }
}
