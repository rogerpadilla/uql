import { MongoClient, ClientSession, OptionalId, ObjectId } from 'mongodb';
import { QueryFilter, Query, EntityMeta, QueryOne, QueryOptions } from '../../type';
import { BaseQuerier } from '../../querier';
import { getEntityMeta } from '../../entity/decorator';
import { MongoDialect } from './mongoDialect';

export class MongodbQuerier extends BaseQuerier<ObjectId> {
  private session: ClientSession;

  constructor(readonly conn: MongoClient, readonly dialect = new MongoDialect()) {
    super();
  }

  async insert<T>(type: { new (): T }, bodies: T[]) {
    const res = await this.collection(type).insertMany(bodies as OptionalId<T>[], { session: this.session });
    return Object.values(res.insertedIds);
  }

  async update<T>(type: { new (): T }, filter: QueryFilter<T>, body: T) {
    const res = await this.collection(type).updateMany(
      this.dialect.buildFilter(type, filter),
      { $set: body },
      {
        session: this.session,
      }
    );
    return res.modifiedCount;
  }

  async find<T>(type: { new (): T }, qm: Query<T>) {
    const meta = getEntityMeta(type);

    let documents: T[];

    if (qm.populate && Object.keys(qm.populate).length) {
      const pipeline = this.dialect.buildAggregationPipeline(type, qm);
      documents = await this.collection(type).aggregate(pipeline, { session: this.session }).toArray();
    } else {
      const cursor = this.collection(type).find({}, { session: this.session });

      if (qm.filter) {
        const filter = this.dialect.buildFilter(type, qm.filter);
        cursor.filter(filter);
      }
      if (qm.project) {
        cursor.project(qm.project);
      }
      if (qm.sort) {
        cursor.sort(qm.sort);
      }
      if (qm.skip) {
        cursor.skip(qm.skip);
      }
      if (qm.limit) {
        cursor.limit(qm.limit);
      }

      documents = await cursor.toArray();
    }

    const bodies = parseDocuments(documents, meta);

    await this.populateToManyRelations(type, bodies, qm.populate);

    return bodies;
  }

  findOneById<T>(type: { new (): T }, id: ObjectId, qo: QueryOne<T>, opts?: QueryOptions) {
    const meta = getEntityMeta(type);
    return this.findOne(type, { ...qo, filter: { [meta.id.name]: id } }, opts);
  }

  async remove<T>(type: { new (): T }, filter: QueryFilter<T>) {
    const res = await this.collection(type).deleteMany(this.dialect.buildFilter(type, filter), {
      session: this.session,
    });
    return res.deletedCount;
  }

  count<T>(type: { new (): T }, filter?: QueryFilter<T>) {
    return this.collection(type).countDocuments(this.dialect.buildFilter(type, filter), { session: this.session });
  }

  async query(query: string) {
    throw new TypeError('method not implemented');
  }

  get hasOpenTransaction() {
    return this.session?.inTransaction();
  }

  collection<T>(type: { new (): T }) {
    const meta = getEntityMeta(type);
    return this.conn.db().collection(meta.name);
  }

  async beginTransaction() {
    if (this.session?.inTransaction()) {
      throw new TypeError('pending transaction');
    }
    this.session = this.conn.startSession();
    this.session.startTransaction();
  }

  async commitTransaction() {
    if (!this.session?.inTransaction()) {
      throw new TypeError('not a pending transaction');
    }
    await this.session.commitTransaction();
    this.session.endSession();
  }

  async rollbackTransaction() {
    if (!this.session?.inTransaction()) {
      throw new TypeError('not a pending transaction');
    }
    await this.session.abortTransaction();
  }

  async release() {
    if (this.session?.inTransaction()) {
      throw new TypeError('pending transaction');
    }
    return this.conn.close();
  }
}

function parseDocuments<T>(docs: T[], meta: EntityMeta<T>) {
  return docs.map((doc) => parseDocument<T>(doc, meta));
}

function parseDocument<T>(doc: any, meta: EntityMeta<T>) {
  if (!doc) {
    return;
  }
  doc[meta.id.property] = doc._id;
  return doc as T;
}
