import { MongoClient, ClientSession, Collection, OptionalId } from 'mongodb';
import { getEntityMeta } from 'uql/decorator';
import { QueryFilter, Query, QueryOneFilter, Querier } from 'uql/type';
import { MongoDialect } from './mongoDialect';

export class MongodbQuerier extends Querier<string> {
  private session: ClientSession;

  constructor(readonly conn: MongoClient, readonly dialect = new MongoDialect()) {
    super();
  }

  async query(query: string) {
    throw new Error('Method not implemented.');
  }

  async insert<T>(type: { new (): T }, bodies: T[]): Promise<string> {
    const res = await this.collection(type).insertMany(bodies as OptionalId<T>[], { session: this.session });
    return res.insertedIds[res.insertedCount].toHexString();
  }

  async insertOne<T>(type: { new (): T }, body: T): Promise<string> {
    const res = await this.collection(type).insertOne(body as OptionalId<T>, { session: this.session });
    return res.insertedId.toHexString();
  }

  async update<T>(type: { new (): T }, filter: QueryFilter<T>, body: T): Promise<number> {
    const res = await this.collection(type).updateMany(
      this.dialect.buildFilter(type, filter),
      { $set: body },
      {
        session: this.session,
      }
    );
    return res.modifiedCount;
  }

  async findOne<T>(type: { new (): T }, qm: QueryOneFilter<T>): Promise<T> {
    if (qm.populate && Object.keys(qm.populate).length) {
      const document = this.collection(type)
        .aggregate(this.dialect.buildAggregationPipeline(type, qm), { session: this.session })
        .toArray();
      return parseDocument(document);
    }

    const document = await this.collection(type).findOne(this.dialect.buildFilter(type, qm.filter), {
      projection: qm.project,
      session: this.session,
    });

    return parseDocument(document);
  }

  async find<T>(type: { new (): T }, qm: Query<T>): Promise<T[]> {
    if (qm.populate && Object.keys(qm.populate).length) {
      const documents = await this.collection(type)
        .aggregate(this.dialect.buildAggregationPipeline(type, qm), { session: this.session })
        .toArray();
      return parseDocuments(documents);
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

    return parseDocuments(documents);
  }

  count<T>(type: { new (): T }, filter?: QueryFilter<T>): Promise<number> {
    return this.collection(type).countDocuments(this.dialect.buildFilter(type, filter), { session: this.session });
  }

  async remove<T>(type: { new (): T }, filter: QueryFilter<T>): Promise<number> {
    const res = await this.collection(type).deleteMany(this.dialect.buildFilter(type, filter), {
      session: this.session,
    });
    return res.deletedCount;
  }

  collection<T>(type: { new (): T }): Collection<T> {
    const meta = getEntityMeta(type);
    return this.conn.db().collection(meta.name);
  }

  get hasOpenTransaction(): boolean {
    return this.session?.inTransaction();
  }

  async beginTransaction(): Promise<void> {
    if (this.session?.inTransaction()) {
      throw new TypeError('There is a pending transaction.');
    }
    this.session = this.conn.startSession();
    this.session.startTransaction();
  }

  async commitTransaction(): Promise<void> {
    if (!this.session?.inTransaction()) {
      throw new TypeError('There is not a pending transaction.');
    }
    await this.session.commitTransaction();
    return new Promise((resolve, reject) => {
      this.session.endSession((err) => {
        if (err) {
          return reject(err);
        }
        this.session = undefined;
        resolve();
      });
    });
  }

  async rollbackTransaction(): Promise<void> {
    if (!this.session?.inTransaction()) {
      throw new TypeError('There is not a pending transaction.');
    }
    await this.session.abortTransaction();
  }

  release(): Promise<void> {
    if (this.session?.inTransaction()) {
      throw new TypeError('Querier should not be released while there is an open transaction.');
    }
    return this.conn.close();
  }
}

function parseDocuments<T>(docs: any[]) {
  return docs.map((doc) => parseDocument(doc));
}

function parseDocument<T>(doc: any) {
  doc._id = doc._id.toHexString();
  return doc;
}
