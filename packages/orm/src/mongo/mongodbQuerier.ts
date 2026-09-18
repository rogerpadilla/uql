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
import { AbstractQuerier, enrichError } from '../querier/index.js';
import type {
  EntityData,
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
  QueryWhere,
  TransactionOptions,
  Type,
  UpdatePayload,
} from '../type/index.js';
import {
  clone,
  getKeys,
  getSoftDeleteValue,
  hasKeys,
  populatesRelations,
  throwNoPendingTransaction,
  throwPendingTransaction,
  vectorCandidates,
  withoutSoftDeleteFilter,
} from '../util/index.js';

import type { ExtractedVectorSort, MongoAggregationPipelineEntry, MongoDialect } from './mongoDialect.js';

/**
 * `$limit: 0` asks for no rows, the way it does on every SQL dialect - but MongoDB reads `limit(0)`
 * as *unlimited*, so a read that passed it straight to the driver came back with the whole
 * collection. The reads answer it here instead, since no cursor can express it.
 */
function asksForNoRows(q: QueryPager): boolean {
  return q.$limit === 0;
}

export class MongodbQuerier extends AbstractQuerier {
  private session?: ClientSession;

  constructor(
    readonly dialect: MongoDialect,
    readonly conn: MongoClient,
    override readonly extra?: ExtraOptions,
  ) {
    super(extra);
  }

  private async execute<T>(task: (session: ClientSession) => Promise<T>): Promise<T> {
    return this.serialize(async () => {
      return task(this.session!);
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
    const cursor = this.readCursor(entity, q, opts);
    try {
      for await (const doc of cursor) {
        const [normalized] = this.dialect.normalizeIds(meta, [doc]);
        yield normalized;
      }
    } catch (err) {
      throw enrichError(err, this.logger, 'internalFindManyStream');
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
    this.dialect.assertNoLock(q);
    const vectorSort = this.dialect.extractVectorSort(q.$sort);
    const pipeline = vectorSort
      ? this.buildVectorPipeline(entity, q, vectorSort, opts)
      : this.readsThroughPipeline(entity, q) && this.dialect.aggregationPipeline(entity, q, opts);
    return pipeline
      ? this.collection(entity).aggregate<E>(pipeline, { session: this.session })
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
      this.dialect.readsAggregates(entity, q)
    );
  }

  private buildScalarProjection<E extends Document>(entity: Type<E>, q: Query<E>) {
    return this.dialect.select(entity, q.$select, q.$exclude);
  }

  /** Build a MongoDB FindCursor with filter, projection, sort, skip, and limit from the query. */
  private buildFindCursor<E extends Document>(entity: Type<E>, q: Query<E>, opts?: QueryOptions) {
    const cursor = this.collection(entity).find<E>({}, { session: this.session });

    const filter = this.dialect.where(entity, q.$where, opts);
    if (hasKeys(filter)) {
      cursor.filter(filter);
    }
    const select = this.buildScalarProjection(entity, q);
    if (hasKeys(select)) {
      cursor.project(select);
    }
    const sort = this.dialect.sort(entity, q.$sort, q.$populate);
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
      // The score becomes a real field before anything reads it, so the lookups and the projection
      // that follow treat it like any other - and a query with no projection keeps its own columns.
      ...(scoreAlias ? [{ $addFields: { [scoreAlias]: { $meta: 'vectorSearchScore' } } }] : []),
      // `$vectorSearch` has already applied `$limit`, so the pager is its own.
      ...this.dialect.readStages(entity, q, {
        sort: this.dialect.sort(entity, vectorSort.regularSort, q.$populate),
        project: scoreAlias ? { [scoreAlias]: 1 } : undefined,
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
      return this.execute((session) =>
        this.collection(entity).aggregate<QueryAggregateResult<E, G, A>>(pipeline, { session }).toArray(),
      );
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

      await this.insertRelations(entity, rows);
    });
  }

  override async internalUpdateMany<E extends Document>(
    entity: Type<E>,
    qm: QuerySearch<E>,
    payload: UpdatePayload<E>,
    opts?: QueryOptions,
  ) {
    return this.timed('internalUpdateMany', undefined, async () => {
      const persistable = this.dialect.getPersistable(getMeta(entity), payload as E, 'onUpdate');
      const filter = this.dialect.where(entity, qm.$where, opts);
      // Maps JSON operators ($set/$unset/$push/$pull) onto their native MongoDB equivalents.
      const update = this.dialect.getUpdateFilter<E>(persistable);
      const { matchedCount } = await this.execute((session) =>
        this.collection(entity).updateMany(filter, update, { session }),
      );
      return matchedCount;
    });
  }

  /**
   * `_id` is immutable, so a key the payload names can only be written on the insert branch of an
   * upsert; in `$set` it would refuse every matched document. Everything else updates either way.
   */
  private upsertUpdate<E extends Document>(persistable: Partial<E>): UpdateFilter<E> {
    const { _id, ...rest } = persistable;
    const update: Document = {};
    if (hasKeys(rest)) {
      update['$set'] = rest;
    }
    if (_id !== undefined) {
      update['$setOnInsert'] = { _id };
    }
    return update;
  }

  private buildConflictFilter<E extends Document>(
    entity: Type<E>,
    conflictPaths: QueryConflictPaths<E>,
    item: EntityData<E>,
  ) {
    const where = getKeys(conflictPaths).reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = item[key];
      return acc;
    }, {}) as QueryWhere<E>;
    return this.dialect.where(entity, where);
  }

  protected override async internalUpsertOne<E extends Document>(
    entity: Type<E>,
    conflictPaths: QueryConflictPaths<E>,
    payload: EntityData<E>,
  ) {
    return this.timed('upsertOne', undefined, async () => {
      payload = clone(payload);

      const meta = getMeta(entity);
      const persistable = this.dialect.getPersistable(meta, payload, 'onInsert');
      const filter = this.buildConflictFilter(entity, conflictPaths, payload);
      const update = this.upsertUpdate(persistable);

      const res = await this.execute((session) =>
        this.collection(entity).findOneAndUpdate(filter, update, {
          upsert: true,
          returnDocument: 'after',
          includeResultMetadata: true,
          session,
        }),
      );

      // Read off the document as written, which carries its `_id` on either branch.
      const id = this.dialect.fromWireId(res?.value?._id) as PrimaryKey | undefined;
      // `updatedExisting` is false when a new document was inserted (upserted).
      const created = res?.lastErrorObject?.['updatedExisting'] === false;

      return { ids: [id], changes: id === undefined ? 0 : 1, created };
    });
  }

  protected override async internalUpsertMany<E extends Document>(
    entity: Type<E>,
    conflictPaths: QueryConflictPaths<E>,
    payload: EntityData<E>[],
  ) {
    return this.timed('upsertMany', undefined, async () => {
      if (!payload?.length) {
        return { changes: 0 };
      }

      const meta = getMeta(entity);
      // Asked before `getPersistable` fills an `onInsert` key into rows it may only update.
      const unnamed = payload.map((row) => !namesKey(meta, row));

      payload = clone(payload);

      const operations = payload.map((item) => {
        const persistable = this.dialect.getPersistable(meta, item, 'onInsert');
        const filter = this.buildConflictFilter(entity, conflictPaths, item);
        const update = this.upsertUpdate(persistable);

        return {
          updateOne: {
            filter,
            update,
            upsert: true,
          },
        };
      });

      const res = await this.execute((session) => this.collection(entity).bulkWrite(operations, { session }));

      const changes = res.upsertedCount + res.modifiedCount;
      // `upsertedIds` names only the documents inserted, keyed by operation index, so each lands on
      // its own row; an updated document's `_id` is read back by the conflict fields instead.
      const reported = payload.map((_, index) => {
        const id = res.upsertedIds[index];
        return id === undefined ? undefined : (this.dialect.fromWireId(id) as PrimaryKey);
      });
      const unplaced = reported.some((id, index) => id === undefined && unnamed[index]);
      const found = unplaced ? await this.idsByConflict(entity, conflictPaths, payload) : [];

      return { changes, ids: reported.map((id, index) => id ?? found[index]) };
    });
  }

  protected override async internalDeleteMany<E extends Document>(
    entity: Type<E>,
    qm: QuerySearch<E>,
    opts: QueryOptions = {},
  ) {
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
    return !!this.session?.inTransaction();
  }

  /** Every read and write goes through here, which makes it where a released querier is caught. */
  collection<E extends Document>(entity: Type<E>) {
    if (this.released) {
      throw new TypeError('querier already released');
    }
    const { name } = getMeta(entity);
    return this.db.collection<E>(name!);
  }

  get db() {
    return this.conn.db();
  }

  override async beginTransaction(_opts?: TransactionOptions) {
    return this.serialize(async () => {
      if (this.hasOpenTransaction) {
        throwPendingTransaction();
      }
      this.logger.logInfo('beginTransaction');
      await this.session?.endSession();
      this.session = this.conn.startSession();
      this.session.startTransaction();
    });
  }

  /**
   * The driver owns the transaction state here and settles it in its own `finally`, so a failed commit
   * or abort still leaves `inTransaction()` false and the querier releasable.
   */
  override async commitTransaction() {
    return this.serialize(async () => {
      if (!this.hasOpenTransaction) {
        throwNoPendingTransaction();
      }
      this.logger.logInfo('commitTransaction');
      await this.session?.commitTransaction();
    });
  }

  override async rollbackTransaction() {
    return this.serialize(async () => {
      if (!this.hasOpenTransaction) {
        return;
      }
      this.logger.logInfo('rollbackTransaction');
      await this.session?.abortTransaction();
    });
  }

  override async internalRelease() {
    const session = this.session;
    // Cleared first, so a failing `endSession` cannot leave the querier holding a session it already
    // tried to end.
    this.session = undefined;
    await session?.endSession();
  }
}
