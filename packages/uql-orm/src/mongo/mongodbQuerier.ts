import type { ClientSession, Document, MongoClient, OptionalUnlessRequiredId, UpdateFilter } from 'mongodb';
import { getMeta } from '../entity/index.js';
import { AbstractQuerier, Log, Serialized } from '../querier/index.js';
import type {
  EntityMeta,
  ExtraOptions,
  IdValue,
  Query,
  QueryAggregate,
  QueryAggregateResult,
  QueryConflictPaths,
  QueryOptions,
  QuerySearch,
  QueryWhere,
  TransactionOptions,
  Type,
  UpdatePayload,
} from '../type/index.js';
import { clone, getFieldCallbackValue, getKeys, getRelationRequestSummary, hasKeys } from '../util/index.js';

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

  @Serialized()
  private async execute<T>(task: (session: ClientSession) => Promise<T>): Promise<T> {
    return task(this.session!);
  }

  @Log()
  protected override async internalFindMany<E extends Document>(entity: Type<E>, q: Query<E>) {
    const meta = getMeta(entity);
    const vectorSort = this.dialect.extractVectorSort(q.$sort);

    let documents: E[];

    if (vectorSort) {
      const pipeline = this.buildVectorPipeline(entity, meta, q, vectorSort);
      documents = await this.runPipeline(entity, meta, pipeline);
    } else {
      const relationSummary = getRelationRequestSummary(meta, q.$populate);

      if (relationSummary.requestedKeys.length) {
        const pipeline = this.dialect.aggregationPipeline(entity, q, relationSummary);
        documents = await this.runPipeline(entity, meta, pipeline);
        await this.fillToManyRelations(entity, documents, q.$populate);
      } else {
        const cursor = this.buildFindCursor(entity, q);
        documents = await this.execute(() => cursor.toArray());
        documents = this.dialect.normalizeIds(meta, documents) || [];
      }
    }

    return documents;
  }

  protected override async *internalFindManyStream<E extends Document>(entity: Type<E>, q: Query<E>) {
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
    const cursor = this.buildFindCursor(entity, q);

    for await (const doc of cursor) {
      const [normalized] = this.dialect.normalizeIds(meta, [doc]) || [doc];
      yield normalized;
    }
  }

  private buildScalarProjection<E extends Document>(entity: Type<E>, q: Query<E>) {
    return this.dialect.select(entity, q.$select, q.$exclude);
  }

  /** Build a MongoDB FindCursor with filter, projection, sort, skip, and limit from the query. */
  private buildFindCursor<E extends Document>(entity: Type<E>, q: Query<E>) {
    const cursor = this.collection(entity).find<E>({}, { session: this.session });

    const filter = this.dialect.where(entity, q.$where);
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
    meta: EntityMeta<E>,
    q: Query<E>,
    vectorSort: ExtractedVectorSort<E>,
  ): Record<string, unknown>[] {
    const pipeline: Record<string, unknown>[] = [];

    pipeline.push(
      this.dialect.buildVectorSearchStage(
        entity,
        meta,
        vectorSort.vectorKey,
        vectorSort.vectorSearch,
        q.$where,
        q.$limit ?? 10,
      ),
    );

    // Score projection via $meta
    if (vectorSort.vectorSearch.$project) {
      const select = q.$select || q.$exclude ? this.buildScalarProjection(entity, q) : {};
      pipeline.push({
        $project: {
          ...select,
          [vectorSort.vectorSearch.$project]: { $meta: 'vectorSearchScore' },
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

  @Log()
  protected override async internalAggregate<E extends Document, Q extends QueryAggregate<E>>(
    entity: Type<E>,
    q: Q,
  ): Promise<QueryAggregateResult<E, Q['$group']>[]> {
    const pipeline = this.dialect.buildAggregateStages(entity, q);
    return this.execute((session) => this.collection(entity).aggregate<any>(pipeline, { session }).toArray());
  }

  @Log()
  protected override internalCount<E extends Document>(entity: Type<E>, qm: QuerySearch<E> = {}) {
    const filter = this.dialect.where(entity, qm.$where);
    return this.execute((session) =>
      this.collection(entity).countDocuments(filter, {
        session,
      }),
    );
  }

  @Log()
  override async internalInsertMany<E extends Document>(entity: Type<E>, payloads: E[]) {
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
  }

  @Log()
  override async internalUpdateMany<E extends Document>(
    entity: Type<E>,
    qm: QuerySearch<E>,
    payload: UpdatePayload<E>,
  ) {
    payload = clone(payload);
    const meta = getMeta(entity);
    const persistable = this.dialect.getPersistable(meta, payload as E, 'onUpdate');
    const where = this.dialect.where(entity, qm.$where);
    const update: UpdateFilter<E> = { $set: persistable };

    const { matchedCount } = await this.execute((session) =>
      this.collection(entity).updateMany(where, update, {
        session,
      }),
    );

    await this.updateRelations(entity, qm, payload);

    return matchedCount;
  }

  private buildConflictFilter<E extends Document>(entity: Type<E>, conflictPaths: QueryConflictPaths<E>, item: E) {
    const where = getKeys(conflictPaths).reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = item[key];
      return acc;
    }, {}) as QueryWhere<E>;
    return this.dialect.where(entity, where);
  }

  @Log()
  override async upsertOne<E extends Document>(entity: Type<E>, conflictPaths: QueryConflictPaths<E>, payload: E) {
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
  }

  @Log()
  override async upsertMany<E extends Document>(entity: Type<E>, conflictPaths: QueryConflictPaths<E>, payload: E[]) {
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

    return { changes };
  }

  @Log()
  protected override async internalDeleteMany<E extends Document>(
    entity: Type<E>,
    qm: QuerySearch<E>,
    opts: QueryOptions = {},
  ) {
    const meta = getMeta(entity);
    const where = this.dialect.where(entity, qm.$where);
    const founds = await this.execute((session) =>
      this.collection(entity)
        .find(where, {
          projection: { _id: true },
          session,
        })
        .toArray(),
    );
    if (!founds.length) {
      return 0;
    }
    const ids = (this.dialect.normalizeIds(meta, founds as unknown as E[]) || []).map((found) => found[meta.id!]);
    let changes: number;
    if (meta.softDelete && !opts.softDelete) {
      const field = meta.fields[meta.softDelete];
      const onDeleteValue = getFieldCallbackValue(field!.onDelete!);
      const updateResult = await this.execute((session) =>
        this.collection(entity).updateMany(
          { _id: { $in: ids } },
          { $set: { [meta.softDelete as string]: onDeleteValue } } as UpdateFilter<E>,
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

  @Serialized()
  override async beginTransaction(_opts?: TransactionOptions) {
    if (this.hasOpenTransaction) {
      throw TypeError('pending transaction');
    }
    this.logger.logInfo('beginTransaction');
    await this.session?.endSession();
    this.session = this.conn.startSession();
    this.session.startTransaction();
  }

  @Serialized()
  override async commitTransaction() {
    if (!this.hasOpenTransaction) {
      throw TypeError('not a pending transaction');
    }
    this.logger.logInfo('commitTransaction');
    await this.session!.commitTransaction();
  }

  @Serialized()
  override async rollbackTransaction() {
    if (!this.hasOpenTransaction) {
      throw TypeError('not a pending transaction');
    }
    this.logger.logInfo('rollbackTransaction');
    await this.session!.abortTransaction();
  }

  override async internalRelease() {
    if (this.hasOpenTransaction) {
      throw TypeError('pending transaction');
    }
    await this.session?.endSession();
    this.session = undefined;
  }
}
