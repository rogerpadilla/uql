import { MongoClient, ClientSession } from 'mongodb';
import { isLogging, log } from '@uql/core';
import { Query, QueryOne, Type, QueryCriteria, FieldValue, QueryOptions } from '@uql/core/type';
import { BaseQuerier, getPersistable, getPersistables, hasProjectRelationKeys } from '@uql/core/querier';
import { getMeta } from '@uql/core/entity/decorator';
import { clone } from '@uql/core/util';

import { MongoDialect } from './mongoDialect';

export class MongodbQuerier extends BaseQuerier {
  private session: ClientSession;

  constructor(readonly conn: MongoClient, readonly dialect = new MongoDialect()) {
    super();
  }

  override count<E>(entity: Type<E>, qm: QueryCriteria<E> = {}) {
    const filter = this.dialect.filter(entity, qm.$filter);
    log('count', entity.name, filter);
    return this.collection(entity).countDocuments(filter, {
      session: this.session,
    });
  }

  override async findMany<E>(entity: Type<E>, qm: Query<E>) {
    const meta = getMeta(entity);

    let documents: E[];

    if (hasProjectRelationKeys(meta, qm.$project)) {
      const pipeline = this.dialect.aggregationPipeline(entity, qm);
      if (isLogging()) {
        log('findMany', entity.name, JSON.stringify(pipeline, null, 2));
      }
      documents = await this.collection(entity).aggregate<E>(pipeline, { session: this.session }).toArray();
      documents = this.dialect.normalizeIds(meta, documents);
      await this.findToManyRelations(entity, documents, qm.$project);
    } else {
      const cursor = this.collection(entity).find<E>({}, { session: this.session });

      if (qm.$filter) {
        const filter = this.dialect.filter(entity, qm.$filter);
        cursor.filter(filter);
      }
      if (qm.$project) {
        const project = this.dialect.project(entity, qm.$project);
        cursor.project(project);
      }
      if (qm.$sort) {
        cursor.sort(qm.$sort);
      }
      if (qm.$skip) {
        cursor.skip(qm.$skip);
      }
      if (qm.$limit) {
        cursor.limit(qm.$limit);
      }

      log('findMany', entity.name, qm);

      documents = await cursor.toArray();
      documents = this.dialect.normalizeIds(meta, documents);
    }

    return documents;
  }

  override findOneById<E>(entity: Type<E>, id: FieldValue<E>, qo: QueryOne<E>) {
    const meta = getMeta(entity);
    return this.findOne(entity, { ...qo, $filter: id });
  }

  override async insertMany<E>(entity: Type<E>, payload: E[]) {
    if (!payload.length) {
      return;
    }

    payload = clone(payload);

    const meta = getMeta(entity);
    const payloads = Array.isArray(payload) ? payload : [payload];
    const persistables = getPersistables(meta, payload, 'onInsert');

    log('insertMany', entity.name, persistables);

    const { insertedIds } = await this.collection(entity).insertMany(persistables, { session: this.session });

    const ids = Object.values(insertedIds);

    for (const [index, it] of payloads.entries()) {
      it[meta.id] = ids[index];
    }

    await this.insertRelations(entity, payloads);

    return ids;
  }

  override async updateMany<E>(entity: Type<E>, payload: E, qm: QueryCriteria<E>) {
    payload = clone(payload);
    const meta = getMeta(entity);
    const persistable = getPersistable(meta, payload, 'onUpdate');
    const filter = this.dialect.filter(entity, qm.$filter);
    const update = { $set: persistable };

    log('updateMany', entity.name, filter, update);

    const { matchedCount } = await this.collection(entity).updateMany(filter, update, {
      session: this.session,
    });

    await this.updateRelations(entity, payload, qm);

    return matchedCount;
  }

  override async deleteMany<E>(entity: Type<E>, qm: QueryCriteria<E>, opts: QueryOptions = {}) {
    const meta = getMeta(entity);
    const filter = this.dialect.filter(entity, qm.$filter);
    log('deleteMany', entity.name, filter, opts);
    const founds: E[] = await this.collection(entity)
      .find(filter, {
        projection: { _id: true },
        session: this.session,
      })
      .toArray();
    if (!founds.length) {
      return 0;
    }
    const ids = this.dialect.normalizeIds(meta, founds).map((found) => found[meta.id]);
    let changes: number;
    if (meta.softDeleteKey && !opts.softDelete) {
      const updateResult = await this.collection(entity).updateMany(
        { _id: { $in: ids } },
        { $set: { [meta.softDeleteKey]: meta.fields[meta.softDeleteKey].onDelete() } },
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

  collection<E>(entity: Type<E>) {
    const meta = getMeta(entity);
    return this.conn.db().collection(meta.name);
  }

  override async beginTransaction() {
    if (this.session?.inTransaction()) {
      throw new TypeError('pending transaction');
    }
    log('beginTransaction');
    this.session = this.conn.startSession();
    this.session.startTransaction();
  }

  override async commitTransaction() {
    if (!this.session?.inTransaction()) {
      throw new TypeError('not a pending transaction');
    }
    log('commitTransaction');
    await this.session.commitTransaction();
  }

  override async rollbackTransaction() {
    if (!this.session?.inTransaction()) {
      throw new TypeError('not a pending transaction');
    }
    log('rollbackTransaction');
    await this.session.abortTransaction();
  }

  override async release(force?: boolean) {
    if (this.session?.inTransaction()) {
      throw new TypeError('pending transaction');
    }
    await this.conn.close(force);
  }
}
