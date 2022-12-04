import { MongoClient, ClientSession, UpdateFilter, Document } from 'mongodb';
import { getMeta } from 'nukak/entity/decorator/index.js';
import { AbstractQuerier } from 'nukak/querier/index.js';
import { clone, getPersistable, getPersistables, getFieldCallbackValue, hasKeys, isProjectingRelations } from 'nukak/util/index.js';
import { Query, Type, QueryCriteria, QueryOptions, QuerySearch, IdValue, QueryUnique, ExtraOptions } from 'nukak/type/index.js';

import { MongoDialect } from './mongoDialect.js';

export class MongodbQuerier extends AbstractQuerier {
  private session: ClientSession;

  constructor(readonly dialect: MongoDialect, readonly conn: MongoClient, readonly extra?: ExtraOptions) {
    super();
  }

  override count<E>(entity: Type<E>, qm: QuerySearch<E> = {}) {
    const filter = this.dialect.filter(entity, qm.$filter);
    this.extra?.logger?.('count', entity.name, filter);
    return this.collection(entity).countDocuments(filter, {
      session: this.session,
    });
  }

  override findOneById<E>(entity: Type<E>, id: IdValue<E>, qm: QueryUnique<E>) {
    return this.findOne(entity, { ...qm, $filter: id });
  }

  override async findMany<E>(entity: Type<E>, qm: Query<E>) {
    const meta = getMeta(entity);

    let documents: E[];
    const hasProjectRelations = isProjectingRelations(meta, qm.$project);

    if (hasProjectRelations) {
      const pipeline = this.dialect.aggregationPipeline(entity, qm);
      this.extra?.logger('findMany', entity.name, JSON.stringify(pipeline, null, 2));
      documents = await this.collection(entity).aggregate<E>(pipeline, { session: this.session }).toArray();
      documents = this.dialect.normalizeIds(meta, documents);
      await this.findToManyRelations(entity, documents, qm.$project);
    } else {
      const cursor = this.collection(entity).find<E>({}, { session: this.session });

      const filter = this.dialect.filter(entity, qm.$filter);
      if (hasKeys(filter)) {
        cursor.filter(filter);
      }
      const project = this.dialect.project(entity, qm.$project);
      if (hasKeys(project)) {
        cursor.project(project);
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

      this.extra?.logger?.('findMany', entity.name, qm);

      documents = await cursor.toArray();
      documents = this.dialect.normalizeIds(meta, documents);
    }

    return documents;
  }

  override async insertMany<E>(entity: Type<E>, payload: E[]) {
    if (!payload.length) {
      return;
    }

    payload = clone(payload);

    const meta = getMeta(entity);
    const payloads = Array.isArray(payload) ? payload : [payload];
    const persistables = getPersistables(meta, payload, 'onInsert');

    this.extra?.logger?.('insertMany', entity.name, persistables);

    const { insertedIds } = await this.collection(entity).insertMany(persistables, { session: this.session });

    const ids = Object.values(insertedIds) as unknown as IdValue<E>[];

    for (const [index, it] of payloads.entries()) {
      it[meta.id] = ids[index];
    }

    await this.insertRelations(entity, payloads);

    return ids;
  }

  override async updateMany<E>(entity: Type<E>, qm: QueryCriteria<E>, payload: E) {
    payload = clone(payload);
    const meta = getMeta(entity);
    const persistable = getPersistable(meta, payload, 'onUpdate') as Document;
    const filter = this.dialect.filter(entity, qm.$filter);
    const update: UpdateFilter<Document> = { $set: persistable };

    this.extra?.logger?.('updateMany', entity.name, filter, update);

    const { matchedCount } = await this.collection(entity).updateMany(filter, update, {
      session: this.session,
    });

    await this.updateRelations(entity, qm, payload);

    return matchedCount;
  }

  override async deleteMany<E>(entity: Type<E>, qm: QueryCriteria<E>, opts: QueryOptions = {}) {
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
      const updateResult = await this.collection(entity).updateMany(
        { _id: { $in: ids } },
        { $set: { [meta.softDelete]: getFieldCallbackValue(meta.fields[meta.softDelete].onDelete) } },
        {
          session: this.session,
        }
      );
      changes = updateResult.matchedCount;
    } else {
      const deleteResult = await this.collection(entity).deleteMany(
        { _id: { $in: ids } },
        {
          session: this.session,
        }
      );
      changes = deleteResult.deletedCount;
    }
    await this.deleteRelations(entity, ids, opts);
    return changes;
  }

  override get hasOpenTransaction() {
    return this.session?.inTransaction();
  }

  collection<E>(entity: Type<E> | string) {
    const name = typeof entity === 'string' ? entity : getMeta(entity).name;
    return this.db.collection(name);
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
