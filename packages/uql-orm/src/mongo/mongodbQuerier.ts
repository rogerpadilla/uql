import type { ClientSession, Document, Filter, MongoClient, OptionalUnlessRequiredId, UpdateFilter } from 'mongodb';
import { getMeta } from '../entity/index.js';
import { AbstractQuerier, enrichError } from '../querier/index.js';
import type {
  EntityMeta,
  ExtraOptions,
  IdValue,
  PrimaryKey,
  Query,
  QueryAggMap,
  QueryAggregate,
  QueryAggregateResult,
  QueryConflictPaths,
  QueryGroupMap,
  QueryOptions,
  QuerySearch,
  QueryWhere,
  TransactionOptions,
  Type,
  UpdatePayload,
} from '../type/index.js';
import {
  clone,
  getKeys,
  getRelationRequestSummary,
  getSoftDeleteValue,
  hasKeys,
  throwNoPendingTransaction,
  throwPendingTransaction,
  withoutSoftDeleteFilter,
} from '../util/index.js';

import type { ExtractedVectorSort, MongoDialect } from './mongoDialect.js';

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
    return this.timed('internalFindMany', undefined, async () => {
      const meta = getMeta(entity);
      const vectorSort = this.dialect.extractVectorSort(q.$sort);

      let documents: E[];

      if (vectorSort) {
        const pipeline = this.buildVectorPipeline(entity, q, vectorSort, opts);
        documents = await this.runPipeline(entity, meta, pipeline);
        // to-many relations need their own query, exactly as in the non-vector path
        await this.fillToManyRelations(entity, documents, q.$populate);
      } else {
        const relationSummary = getRelationRequestSummary(meta, q.$populate);

        // A relation condition needs `$lookup`, so it forces the aggregation path just like populating
        // one does; a plain `find` cursor cannot express it.
        if (relationSummary.requestedKeys.length || this.dialect.constrainsRelations(entity, q.$where)) {
          const pipeline = this.dialect.aggregationPipeline(entity, q, relationSummary, opts);
          documents = await this.runPipeline(entity, meta, pipeline);
          await this.fillToManyRelations(entity, documents, q.$populate);
        } else {
          const cursor = this.buildFindCursor(entity, q, opts);
          documents = await this.execute(() => cursor.toArray());
          documents = this.dialect.normalizeIds(meta, documents) || [];
        }
      }

      return documents;
    });
  }

  protected override async *internalFindManyStream<E extends Document>(
    entity: Type<E>,
    q: Query<E>,
    opts?: QueryOptions,
  ) {
    const meta = getMeta(entity);
    const { joinableKeys, toManyKeys } = getRelationRequestSummary(meta, q.$populate);
    if (joinableKeys.length || toManyKeys.length) {
      const parts: string[] = [];
      if (joinableKeys.length) parts.push(`joinable: ${joinableKeys.join(', ')}`);
      if (toManyKeys.length) parts.push(`toMany: ${toManyKeys.join(', ')}`);
      throw new TypeError(
        `findManyStream does not load relations on MongoDB (${parts.join('; ')}). Use findMany with $populate (or legacy relation keys in $select) so aggregation and fill logic can run.`,
      );
    }
    const cursor = this.buildFindCursor(entity, q, opts);

    try {
      for await (const doc of cursor) {
        const [normalized] = this.dialect.normalizeIds(meta, [doc]) || [doc];
        yield normalized;
      }
    } catch (err) {
      throw enrichError(err, this.logger, 'internalFindManyStream');
    }
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
    const sort = this.dialect.sort(entity, q.$sort);
    if (hasKeys(sort)) {
      cursor.sort(sort);
    }
    if (q.$skip) {
      cursor.skip(q.$skip);
    }
    if (q.$limit) {
      cursor.limit(q.$limit);
    }

    return cursor;
  }

  /** Execute an aggregation pipeline and normalize `_id` → `id`. */
  private async runPipeline<E extends Document>(
    entity: Type<E>,
    meta: EntityMeta<E>,
    pipeline: Record<string, unknown>[],
  ): Promise<E[]> {
    const documents = await this.execute((session) =>
      this.collection(entity).aggregate<E>(pipeline, { session }).toArray(),
    );
    return this.dialect.normalizeIds(meta, documents) || [];
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
  ): Record<string, unknown>[] {
    const pipeline: Record<string, unknown>[] = [];

    pipeline.push(
      this.dialect.buildVectorSearchStage(
        entity,
        vectorSort.vectorKey,
        vectorSort.vectorSearch,
        q.$where,
        q.$limit ?? 10,
        opts,
      ),
    );

    const meta = getMeta(entity);
    const relationSummary = getRelationRequestSummary(meta, q.$populate);
    const scoreAlias = vectorSort.vectorSearch.$project;

    // With relations, the score is captured with `$addFields` before the lookups and no scalar
    // `$project` is emitted: projecting here would drop both the join keys and the joined documents,
    // which is why `$populate` used to come back empty under a vector sort.
    if (relationSummary.requestedKeys.length) {
      if (scoreAlias) {
        pipeline.push({ $addFields: { [scoreAlias]: { $meta: 'vectorSearchScore' } } });
      }
      pipeline.push(...(this.dialect.relationStages(entity, q, relationSummary) as Record<string, unknown>[]));
    } else if (scoreAlias) {
      const select = q.$select || q.$exclude ? this.buildScalarProjection(entity, q) : {};
      pipeline.push({
        $project: {
          ...select,
          [scoreAlias]: { $meta: 'vectorSearchScore' },
        },
      });
    } else if ((q.$select && hasKeys(q.$select)) || (q.$exclude && hasKeys(q.$exclude))) {
      pipeline.push({ $project: this.buildScalarProjection(entity, q) });
    }

    // Secondary sort for non-vector fields
    const regularSort = this.dialect.sort(entity, vectorSort.regularSort);
    if (hasKeys(regularSort)) {
      pipeline.push({ $sort: regularSort });
    }

    return pipeline;
  }

  protected override async internalAggregate<E extends Document, G extends QueryGroupMap<E>, A extends QueryAggMap<E>>(
    entity: Type<E>,
    q: QueryAggregate<E, G, A>,
    opts?: QueryOptions,
  ): Promise<QueryAggregateResult<E, G, A>[]> {
    return this.timed('internalAggregate', undefined, async () => {
      const pipeline = this.dialect.buildAggregateStages(entity, q, opts);
      // biome-ignore lint/suspicious/noExplicitAny: aggregate result type matches QueryAggregateResult at runtime but TS can't verify
      return this.execute((session) => this.collection(entity).aggregate<any>(pipeline, { session }).toArray());
    });
  }

  protected override async internalCount<E extends Document>(
    entity: Type<E>,
    qm: QuerySearch<E> = {},
    opts?: QueryOptions,
  ) {
    return this.timed('internalCount', undefined, async () => {
      if (this.dialect.constrainsRelations(entity, qm.$where)) {
        const { stages, filter } = this.dialect.whereWithRelations(entity, qm.$where, opts);
        const [counted] = await this.execute((session) =>
          this.collection(entity)
            .aggregate<{ n: number }>([...stages, { $match: filter }, { $count: 'n' }], { session })
            .toArray(),
        );
        return counted?.n ?? 0;
      }
      const filter = this.dialect.where(entity, qm.$where, opts);
      return this.execute((session) =>
        this.collection(entity).countDocuments(filter, {
          session,
        }),
      );
    });
  }

  /**
   * The `_id`s a search matches. Writes need this whenever the `$where` constrains a relation, since a
   * MongoDB `updateMany`/`deleteMany` filter cannot host a `$lookup` - reads never pay this cost.
   */
  private async matchedIds<E extends Document>(entity: Type<E>, where: QueryWhere<E> | undefined, opts?: QueryOptions) {
    const meta = getMeta(entity);
    const { stages, filter } = this.dialect.whereWithRelations(entity, where, opts);
    const founds = await this.execute((session) =>
      this.collection(entity)
        .aggregate<Document>([...stages, { $match: filter }, { $project: { _id: true } }], { session })
        .toArray(),
    );
    return (this.dialect.normalizeIds(meta, founds as E[]) || []).map((found) => found[meta.id!]);
  }

  override async internalInsertMany<E extends Document>(entity: Type<E>, payloads: E[]) {
    return this.timed('internalInsertMany', undefined, async () => {
      if (!payloads?.length) {
        return [];
      }

      payloads = clone(payloads);

      const meta = getMeta(entity);
      const persistables = this.dialect.getPersistables(meta, payloads, 'onInsert') as OptionalUnlessRequiredId<E>[];

      const { insertedIds } = await this.execute((session) =>
        this.collection(entity).insertMany(persistables, { session }),
      );

      const ids = Object.values(insertedIds) as IdValue<E>[];

      for (const [index, it] of payloads.entries()) {
        it[meta.id!] = ids[index];
      }

      await this.insertRelations(entity, payloads);

      return ids;
    });
  }

  override async internalUpdateMany<E extends Document>(
    entity: Type<E>,
    qm: QuerySearch<E>,
    payload: UpdatePayload<E>,
    opts?: QueryOptions,
  ) {
    return this.timed('internalUpdateMany', undefined, async () => {
      payload = clone(payload);
      const meta = getMeta(entity);
      const persistable = this.dialect.getPersistable(meta, payload as E, 'onUpdate');
      // An `updateMany` filter cannot host a `$lookup`, so a relation condition is resolved to ids first.
      const where = this.dialect.constrainsRelations(entity, qm.$where)
        ? ({ _id: { $in: await this.matchedIds(entity, qm.$where, opts) } } as Filter<E>)
        : this.dialect.where(entity, qm.$where, opts);
      // Maps JSON operators ($set/$unset/$push/$pull) onto their native MongoDB equivalents.
      const update = this.dialect.getUpdateFilter<E>(persistable);

      const { matchedCount } = await this.execute((session) =>
        this.collection(entity).updateMany(where, update, {
          session,
        }),
      );

      await this.updateRelations(entity, qm, payload, opts);

      return matchedCount;
    });
  }

  private buildConflictFilter<E extends Document>(entity: Type<E>, conflictPaths: QueryConflictPaths<E>, item: E) {
    const where = getKeys(conflictPaths).reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = item[key];
      return acc;
    }, {}) as QueryWhere<E>;
    return this.dialect.where(entity, where);
  }

  override async upsertOne<E extends Document>(entity: Type<E>, conflictPaths: QueryConflictPaths<E>, payload: E) {
    return this.timed('upsertOne', undefined, async () => {
      payload = clone(payload);

      const meta = getMeta(entity);
      const persistable = this.dialect.getPersistable(meta, payload, 'onInsert');
      const filter = this.buildConflictFilter(entity, conflictPaths, payload);
      const update: UpdateFilter<E> = { $set: persistable };

      const res = await this.execute((session) =>
        this.collection(entity).findOneAndUpdate(filter, update, {
          upsert: true,
          returnDocument: 'after',
          includeResultMetadata: true,
          session,
        }),
      );

      const firstId = res?.value?._id as unknown as string;
      // `updatedExisting` is false when a new document was inserted (upserted).
      const created = res?.lastErrorObject?.['updatedExisting'] === false;

      return { firstId, changes: firstId ? 1 : 0, created };
    });
  }

  override async upsertMany<E extends Document>(entity: Type<E>, conflictPaths: QueryConflictPaths<E>, payload: E[]) {
    return this.timed('upsertMany', undefined, async () => {
      if (!payload?.length) {
        return { changes: 0 };
      }

      payload = clone(payload);

      const meta = getMeta(entity);

      const operations = payload.map((item) => {
        const persistable = this.dialect.getPersistable(meta, item, 'onInsert');
        const filter = this.buildConflictFilter(entity, conflictPaths, item);
        const update: UpdateFilter<E> = { $set: persistable };

        return {
          updateOne: {
            filter,
            update,
            upsert: true,
          },
        };
      });

      const res = await this.execute((session) => this.collection(entity).bulkWrite(operations, { session }));

      const changes = (res.upsertedCount ?? 0) + (res.modifiedCount ?? 0);
      // `upsertedIds` only covers newly-inserted documents (keyed by operation index); a matched and
      // updated document's `_id` isn't in the response, so it's simply not represented here - same
      // "exact where knowable, absent otherwise" convention `RETURNING`-based SQL dialects use for
      // rows that hit `DO NOTHING`.
      const ids = Object.values(res.upsertedIds) as PrimaryKey[];

      return { changes, ids, firstId: ids[0] };
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
      const field = !opts.hardDelete && meta.softDelete ? meta.fields[meta.softDelete] : undefined;
      // Hard delete targets matching rows regardless of soft-delete state (keeps other filters).
      const findOpts = field ? opts : { ...opts, filters: withoutSoftDeleteFilter(opts.filters) };
      // Delete has always resolved its ids first (it stamps or removes them by `_id`), so a relation
      // condition needs nothing extra here.
      const ids = await this.matchedIds(entity, qm.$where, findOpts);
      if (!ids.length) {
        return 0;
      }
      let changes: number;
      if (field) {
        // Stamp the mapped column: reads filter on it, so a `@Field({ name })` mismatch here would
        // report a successful delete and leave the row visible.
        const softDeleteColumn = this.dialect.resolveColumnName(meta.softDelete as string, field);
        const updateResult = await this.execute((session) =>
          this.collection(entity).updateMany(
            { _id: { $in: ids } },
            { $set: { [softDeleteColumn]: getSoftDeleteValue(field) } } as UpdateFilter<E>,
            {
              session,
            },
          ),
        );
        changes = updateResult.matchedCount;
      } else {
        const deleteResult = await this.execute((session) =>
          this.collection(entity).deleteMany({ _id: { $in: ids } }, { session }),
        );
        changes = deleteResult.deletedCount;
      }
      await this.deleteRelations(entity, ids, opts);
      return changes;
    });
  }

  override get hasOpenTransaction(): boolean {
    return !!this.session?.inTransaction();
  }

  collection<E extends Document>(entity: Type<E>) {
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

  override async commitTransaction() {
    return this.serialize(async () => {
      if (!this.hasOpenTransaction) {
        throwNoPendingTransaction();
      }
      this.logger.logInfo('commitTransaction');
      await this.session!.commitTransaction();
    });
  }

  override async rollbackTransaction() {
    return this.serialize(async () => {
      if (!this.hasOpenTransaction) {
        throwNoPendingTransaction();
      }
      this.logger.logInfo('rollbackTransaction');
      await this.session!.abortTransaction();
    });
  }

  override async internalRelease() {
    if (this.hasOpenTransaction) {
      throwPendingTransaction();
    }
    await this.session?.endSession();
    this.session = undefined;
  }
}
