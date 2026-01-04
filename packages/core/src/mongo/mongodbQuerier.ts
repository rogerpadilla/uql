import type { ClientSession, Document, MongoClient, OptionalUnlessRequiredId, UpdateFilter } from 'mongodb';
import { getMeta } from '../entity/index.js';
import { AbstractQuerier, Log, Serialized } from '../querier/index.js';
import type {
  ExtraOptions,
  IdValue,
  Query,
  QueryConflictPaths,
  QueryOptions,
  QuerySearch,
  QueryWhere,
  Type,
} from '../type/index.js';
import { clone, getFieldCallbackValue, getKeys, hasKeys, isSelectingRelations } from '../util/index.js';

import type { MongoDialect } from './mongoDialect.js';

export class MongodbQuerier extends AbstractQuerier {
  private session: ClientSession;

  constructor(
    readonly dialect: MongoDialect,
    readonly conn: MongoClient,
    override readonly extra?: ExtraOptions,
  ) {
    super(extra);
  }

  @Serialized()
  private async execute<T>(task: (session: ClientSession) => Promise<T>): Promise<T> {
    return task(this.session);
  }

  @Log()
  override async findMany<E extends Document>(entity: Type<E>, q: Query<E>) {
    const meta = getMeta(entity);

    let documents: E[];
    const hasSelectedRelations = isSelectingRelations(meta, q.$select);

    if (hasSelectedRelations) {
      const pipeline = this.dialect.aggregationPipeline(entity, q);
      documents = await this.execute((session) =>
        this.collection(entity).aggregate<E>(pipeline, { session }).toArray(),
      );
      documents = this.dialect.normalizeIds(meta, documents) as E[];
      await this.fillToManyRelations(entity, documents, q.$select);
    } else {
      const cursor = this.collection(entity).find<E>({}, { session: this.session });

      const filter = this.dialect.where(entity, q.$where);
      if (hasKeys(filter)) {
        cursor.filter(filter);
      }
      const select = this.dialect.select(entity, q.$select);
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

      documents = await this.execute(() => cursor.toArray() as Promise<E[]>);
      documents = this.dialect.normalizeIds(meta, documents) as E[];
    }

    return documents;
  }

  @Log()
  override count<E extends Document>(entity: Type<E>, qm: QuerySearch<E> = {}) {
    const filter = this.dialect.where(entity, qm.$where);
    return this.execute((session) =>
      this.collection(entity).countDocuments(filter, {
        session,
      }),
    );
  }

  @Log()
  override async insertMany<E extends Document>(entity: Type<E>, payloads: E[]) {
    if (!payloads?.length) {
      return [];
    }

    payloads = clone(payloads);

    const meta = getMeta(entity);
    const persistables = this.dialect.getPersistables(meta, payloads, 'onInsert') as OptionalUnlessRequiredId<E>[];

    const { insertedIds } = await this.execute((session) =>
      this.collection(entity).insertMany(persistables, { session }),
    );

    const ids = Object.values(insertedIds) as unknown as IdValue<E>[];

    for (const [index, it] of payloads.entries()) {
      it[meta.id] = ids[index];
    }

    await this.insertRelations(entity, payloads);

    return ids;
  }

  @Log()
  override async updateMany<E extends Document>(entity: Type<E>, qm: QuerySearch<E>, payload: E) {
    payload = clone(payload);
    const meta = getMeta(entity);
    const persistable = this.dialect.getPersistable(meta, payload, 'onUpdate');
    const where = this.dialect.where(entity, qm.$where);
    const update = { $set: persistable } satisfies UpdateFilter<E>;

    const { matchedCount } = await this.execute((session) =>
      this.collection(entity).updateMany(where, update, {
        session,
      }),
    );

    await this.updateRelations(entity, qm, payload);

    return matchedCount;
  }

  @Log()
  override async upsertOne<E extends Document>(entity: Type<E>, conflictPaths: QueryConflictPaths<E>, payload: E) {
    payload = clone(payload);

    const meta = getMeta(entity);
    const persistable = this.dialect.getPersistable(meta, payload, 'onInsert') as OptionalUnlessRequiredId<E>;

    const where = getKeys(conflictPaths).reduce(
      (acc, key) => {
        acc[key] = payload[key];
        return acc;
      },
      {} as QueryWhere<E>,
    );

    const filter = this.dialect.where(entity, where);

    const update = { $set: persistable } as UpdateFilter<E>;

    const res = await this.execute((session) =>
      this.collection(entity).findOneAndUpdate(filter, update, {
        upsert: true,
        session,
      }),
    );

    const firstId = res?._id as unknown as string;

    return { firstId, changes: firstId ? 1 : 0 };
  }

  @Log()
  override async deleteMany<E extends Document>(entity: Type<E>, qm: QuerySearch<E>, opts: QueryOptions = {}) {
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
    const ids = this.dialect.normalizeIds(meta, founds as unknown as E[]).map((found) => found[meta.id]);
    let changes: number;
    if (meta.softDelete && !opts.softDelete) {
      const onDeleteValue = getFieldCallbackValue(meta.fields[meta.softDelete].onDelete);
      const updateResult = await this.execute((session) =>
        this.collection(entity).updateMany(
          { _id: { $in: ids } },
          { $set: { [meta.softDelete]: onDeleteValue } } as UpdateFilter<E>,
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

  override get hasOpenTransaction() {
    return this.session?.inTransaction();
  }

  collection<E extends Document>(entity: Type<E>) {
    const { name } = getMeta(entity);
    return this.db.collection<E>(name);
  }

  get db() {
    return this.conn.db();
  }

  @Serialized()
  override async beginTransaction() {
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
    await this.session.commitTransaction();
  }

  @Serialized()
  override async rollbackTransaction() {
    if (!this.hasOpenTransaction) {
      throw TypeError('not a pending transaction');
    }
    this.logger.logInfo('rollbackTransaction');
    await this.session.abortTransaction();
  }

  override async internalRelease() {
    if (this.hasOpenTransaction) {
      throw TypeError('pending transaction');
    }
    await this.session?.endSession();
    this.session = undefined;
  }
}
