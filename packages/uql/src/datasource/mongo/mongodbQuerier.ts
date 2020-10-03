import { MongoClient, ClientSession, OptionalId, ObjectId } from 'mongodb';
import { getEntityMeta } from 'uql/decorator';
import { QueryFilter, Query, QueryOneFilter, Querier, EntityMeta, QueryProject } from 'uql/type';
import { MongoDialect } from './mongoDialect';

export class MongodbQuerier extends Querier<ObjectId> {
  private session: ClientSession;

  constructor(readonly conn: MongoClient, readonly dialect = new MongoDialect()) {
    super();
  }

  async query(query: string) {
    throw new TypeError('method not implemented');
  }

  async insert<T>(type: { new (): T }, bodies: T[]) {
    const res = await this.collection(type).insertMany(bodies as OptionalId<T>[], { session: this.session });
    return Object.values(res.insertedIds);
  }

  async insertOne<T>(type: { new (): T }, body: T) {
    const res = await this.collection(type).insertOne(body as OptionalId<T>, { session: this.session });
    return res.insertedId;
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

  async findOne<T>(type: { new (): T }, qm: QueryOneFilter<T>) {
    const meta = getEntityMeta(type);

    if (qm.populate && Object.keys(qm.populate).length) {
      const pipeline = this.dialect.buildAggregationPipeline(type, qm);
      const documents = await this.collection(type).aggregate(pipeline, { session: this.session }).toArray();
      return parseDocument(documents[0], qm.project, meta);
    }

    const document = await this.collection(type).findOne(this.dialect.buildFilter(type, qm.filter), {
      projection: qm.project,
      session: this.session,
    });

    return parseDocument(document, qm.project, meta);
  }

  async find<T>(type: { new (): T }, qm: Query<T>) {
    const meta = getEntityMeta(type);

    if (qm.populate && Object.keys(qm.populate).length) {
      const documents = await this.collection(type)
        .aggregate(this.dialect.buildAggregationPipeline(type, qm), { session: this.session })
        .toArray();
      return parseDocuments(documents, qm.project, meta);
    }

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

    const documents = await cursor.toArray();

    return parseDocuments(documents, qm.project, meta);
  }

  count<T>(type: { new (): T }, filter?: QueryFilter<T>) {
    return this.collection(type).countDocuments(this.dialect.buildFilter(type, filter), { session: this.session });
  }

  async remove<T>(type: { new (): T }, filter: QueryFilter<T>) {
    const res = await this.collection(type).deleteMany(this.dialect.buildFilter(type, filter), {
      session: this.session,
    });
    return res.deletedCount;
  }

  collection<T>(type: { new (): T }) {
    const meta = getEntityMeta(type);
    return this.conn.db().collection(meta.name);
  }

  get hasOpenTransaction() {
    return this.session?.inTransaction();
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

function parseDocuments<T>(docs: T[], project: QueryProject<T>, meta: EntityMeta<T>) {
  return docs.map((doc) => parseDocument<T>(doc, project, meta));
}

function parseDocument<T>(doc: any, project: QueryProject<T>, meta: EntityMeta<T>) {
  if (!doc) {
    return;
  }
  const hasProjectId = !project || project[meta.id.property] || !Object.keys(project).length;
  if (hasProjectId) {
    doc[meta.id.property] = doc._id;
  }
  return doc as T;
}
