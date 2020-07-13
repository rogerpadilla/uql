import { MongoClient, ClientSession, ObjectID, Collection, OptionalId } from 'mongodb';
import { QueryFilter, Query, QueryOneFilter, QueryOne } from '../../type';
import { Querier } from '../type';
import { getEntityMeta } from '../../entity';
import { MongoDialect } from './mongoDialect';

export class MongodbQuerier extends Querier<ObjectID> {
  protected session: ClientSession;
  protected dialect = new MongoDialect();

  constructor(protected readonly conn: MongoClient) {
    super();
  }

  async insert<T>(type: { new (): T }, bodies: T[]): Promise<ObjectID[]> {
    const res = await this.collection(type).insertMany(bodies as OptionalId<T>[]);
    return Object.values(res.insertedIds);
  }

  async insertOne<T>(type: { new (): T }, body: T): Promise<ObjectID> {
    const res = await this.collection(type).insertOne(body as OptionalId<T>);
    return res.insertedId;
  }

  async update<T>(type: { new (): T }, filter: QueryFilter<T>, body: T): Promise<number> {
    const res = await this.collection(type).updateMany(this.dialect.buildFilter(filter), body);
    return res.modifiedCount;
  }

  async findOneById<T>(type: { new (): T }, id: ObjectID, qm: QueryOne<T> = {}): Promise<T> {
    const meta = getEntityMeta(type);
    (qm as QueryOneFilter<T>).filter = { [meta.id]: id };
    return this.findOne(type, qm);
  }

  async findOne<T>(type: { new (): T }, qm: QueryOneFilter<T>): Promise<T> {
    if (qm.populate && Object.keys(qm.populate).length) {
      return this.collection(type)
        .aggregate(this.dialect.buildAggregationPipeline(type, qm))
        .toArray()
        .then((resp) => resp[0]);
    }
    return this.collection(type).findOne(this.dialect.buildFilter(qm.filter), {
      projection: qm.project,
    });
  }

  async find<T>(type: { new (): T }, qm: Query<T>): Promise<T[]> {
    if (qm.populate && Object.keys(qm.populate).length) {
      return this.collection(type).aggregate(this.dialect.buildAggregationPipeline(type, qm)).toArray();
    }

    const cursor = this.collection(type).find();

    if (qm.filter) {
      const filter = this.dialect.buildFilter(qm.filter);
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

    return cursor.toArray();
  }

  count<T>(type: { new (): T }, filter: QueryFilter<T>): Promise<number> {
    return this.collection(type).countDocuments(this.dialect.buildFilter(filter));
  }

  async remove<T>(type: { new (): T }, filter: QueryFilter<T>): Promise<number> {
    const res = await this.collection(type).deleteMany(this.dialect.buildFilter(filter));
    return res.deletedCount;
  }

  collection<T>(type: { new (): T }): Collection<T> {
    const meta = getEntityMeta(type);
    return this.conn.db().collection(meta.name);
  }

  get hasOpenTransaction(): boolean {
    return this.session?.inTransaction();
  }

  beginTransaction(): Promise<void> {
    if (this.session?.inTransaction()) {
      throw new Error('There is a pending transaction.');
    }
    this.session = this.conn.startSession();
    return Promise.resolve();
  }

  async commit(): Promise<void> {
    if (!this.session?.inTransaction()) {
      throw new Error('There is not a pending transaction.');
    }
    await this.session.commitTransaction();
    this.session.endSession();
  }

  async rollback(): Promise<void> {
    if (!this.session?.inTransaction()) {
      throw new Error('There is not a pending transaction.');
    }
    await this.session.abortTransaction();
  }

  release(): Promise<void> {
    if (this.session?.inTransaction()) {
      throw new Error('Querier should not be released while there is an open transaction.');
    }
    return this.conn.close();
  }
}
