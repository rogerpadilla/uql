import type { MongoClient, ClientSession, UpdateFilter, Document, OptionalUnlessRequiredId } from 'mongodb';
import { getMeta } from 'nukak/entity';
import { AbstractQuerier } from 'nukak/querier';
import {
  clone,
  getPersistable,
  getPersistables,
  getFieldCallbackValue,
  hasKeys,
  isProjectingRelations,
} from 'nukak/util';
import type {
  Type,
  QueryOptions,
  IdValue,
  ExtraOptions,
  QueryProject,
  Merge,
  QuerySearch,
  QueryCriteria,
} from 'nukak/type';

import { MongoDialect } from './mongoDialect.js';

export class MongodbQuerier extends AbstractQuerier {
  private session: ClientSession;

  constructor(
    readonly dialect: MongoDialect,
    readonly conn: MongoClient,
    readonly extra?: ExtraOptions,
  ) {
    super();
  }

  override async findMany<E extends Document, P extends QueryProject<E>>(
    entity: Type<E>,
    qm: QueryCriteria<E>,
    project?: P,
  ) {
    const meta = getMeta(entity);

    type D = Merge<E, P>;

    let documents: D[];
    const hasProjectRelations = isProjectingRelations(meta, project);

    if (hasProjectRelations) {
      const pipeline = this.dialect.aggregationPipeline(entity, qm, project);
      this.extra?.logger('findMany', entity.name, JSON.stringify(pipeline, null, 2));
      documents = await this.collection(entity).aggregate<D>(pipeline, { session: this.session }).toArray();
      documents = this.dialect.normalizeIds(meta, documents) as D[];
      await this.findToManyRelations(entity, documents, project);
    } else {
      const cursor = this.collection(entity).find<E>({}, { session: this.session });

      const filter = this.dialect.filter(entity, qm.$filter);
      if (hasKeys(filter)) {
        cursor.filter(filter);
      }
      const projection = this.dialect.project(entity, project);
      if (hasKeys(projection)) {
        cursor.project(projection);
      }
      const sort = this.dialect.sort(entity, qm.$sort);
      if (hasKeys(sort)) {
        cursor.sort(sort);
      }
      if (qm.$skip) {
        cursor.skip(qm.$skip);
      }
      if (qm.$limit) {
        cursor.limit(qm.$limit);
      }

      this.extra?.logger?.('findMany', entity.name, qm, project);

      documents = (await cursor.toArray()) as D[];
      documents = this.dialect.normalizeIds(meta, documents) as D[];
    }

    return documents;
  }

  override count<E extends Document>(entity: Type<E>, qm: QuerySearch<E> = {}) {
    const filter = this.dialect.filter(entity, qm.$filter);
    this.extra?.logger?.('count', entity.name, filter);
    return this.collection(entity).countDocuments(filter, {
      session: this.session,
    });
  }

  override async insertMany<E extends Document>(entity: Type<E>, payloads: E[]) {
    payloads = clone(payloads);

    const meta = getMeta(entity);
    const persistables = getPersistables(meta, payloads, 'onInsert') as OptionalUnlessRequiredId<E>[];

    this.extra?.logger?.('insertMany', entity.name, persistables);

    const { insertedIds } = await this.collection(entity).insertMany(persistables, { session: this.session });

    const ids = Object.values(insertedIds) as unknown as IdValue<E>[];

    for (const [index, it] of payloads.entries()) {
      it[meta.id] = ids[index];
    }

    await this.insertRelations(entity, payloads);

    return ids;
  }

  override async updateMany<E extends Document>(entity: Type<E>, qm: QuerySearch<E>, payload: E) {
    payload = clone(payload);
    const meta = getMeta(entity);
    const persistable = getPersistable(meta, payload, 'onUpdate') satisfies Document;
    const filter = this.dialect.filter(entity, qm.$filter);
    const update = { $set: persistable } satisfies UpdateFilter<Document>;

    this.extra?.logger?.('updateMany', entity.name, filter, update);

    const { matchedCount } = await this.collection(entity).updateMany(filter, update, {
      session: this.session,
    });

    await this.updateRelations(entity, qm, payload);

    return matchedCount;
  }

  override async deleteMany<E extends Document>(entity: Type<E>, qm: QuerySearch<E>, opts: QueryOptions = {}) {
    const meta = getMeta(entity);
    const filter = this.dialect.filter(entity, qm.$filter);
    this.extra?.logger?.('deleteMany', entity.name, filter, opts);
    const founds = await this.collection(entity)
      .find(filter, {
        projection: { _id: true },
        session: this.session,
      })
      .toArray();
    if (!founds.length) {
      return 0;
    }
    const ids = this.dialect.normalizeIds(meta, founds as unknown as E[]).map((found) => found[meta.id]);
    let changes: number;
    if (meta.softDelete && !opts.softDelete) {
      const onDeleteValue = getFieldCallbackValue(meta.fields[meta.softDelete].onDelete);
      const updateResult = await this.collection(entity).updateMany(
        { _id: { $in: ids } },
        { $set: { [meta.softDelete]: onDeleteValue } } as UpdateFilter<E>,
        {
          session: this.session,
        },
      );
      changes = updateResult.matchedCount;
    } else {
      const deleteResult = await this.collection(entity).deleteMany(
        { _id: { $in: ids } },
        {
          session: this.session,
        },
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

  override async beginTransaction() {
    if (this.hasOpenTransaction) {
      throw TypeError('pending transaction');
    }
    this.extra?.logger?.('beginTransaction');
    this.session = this.conn.startSession();
    this.session.startTransaction();
  }

  override async commitTransaction() {
    if (!this.hasOpenTransaction) {
      throw TypeError('not a pending transaction');
    }
    this.extra?.logger?.('commitTransaction');
    await this.session.commitTransaction();
  }

  override async rollbackTransaction() {
    if (!this.hasOpenTransaction) {
      throw TypeError('not a pending transaction');
    }
    this.extra?.logger?.('rollbackTransaction');
    await this.session.abortTransaction();
  }

  override async release(force?: boolean) {
    if (this.hasOpenTransaction) {
      throw TypeError('pending transaction');
    }
    await this.conn.close(force);
  }
}
