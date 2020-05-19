import { MongoClient, ClientSession } from 'mongodb';
import { QueryFilter, Query, QueryOneFilter, QueryOne } from '../../type';
import { Querier } from '../type';
import { getEntityMeta } from '../../entity';
import { buildFilter, buildAggregationPipeline } from './mongodb.util';

export class MongodbQuerier extends Querier {
  protected session: ClientSession;

  constructor(protected readonly conn: MongoClient) {
    super();
  }

  hasOpenTransaction() {
    return this.session?.inTransaction();
  }

  async insert<T>(type: { new (): T }, bodies: T[]) {
    const res = await this.collection(type).insertMany(bodies);
    return Object.values(res.insertedIds);
  }

  async insertOne<T>(type: { new (): T }, body: T) {
    const res = await this.collection(type).insertOne(body);
    return res.insertedId;
  }

  async updateOne<T>(type: { new (): T }, filter: QueryFilter<T>, body: T) {
    const res = await this.collection(type).updateOne(type, filter, body);
    return res.modifiedCount;
  }

  async update<T>(type: { new (): T }, filter: QueryFilter<T>, body: T) {
    const res = await this.collection(type).updateMany(buildFilter(filter), body);
    return res.modifiedCount;
  }

  async findOneById<T>(type: { new (): T }, id: any, qm: QueryOne<T> = {}) {
    const meta = getEntityMeta(type);
    (qm as QueryOneFilter<T>).filter = { [meta.id]: id };
    return this.findOne(type, qm);
  }

  async findOne<T>(type: { new (): T }, qm: QueryOneFilter<T>) {
    if (qm.populate) {
      return this.collection(type)
        .aggregate(buildAggregationPipeline(type, qm))
        .toArray()
        .then((resp) => resp[0]);
    }
    return this.collection(type).findOne(buildFilter(qm.filter), { projection: qm.project });
  }

  async find<T>(type: { new (): T }, qm: Query<T>) {
    if (qm.populate) {
      return this.collection(type).aggregate(buildAggregationPipeline(type, qm)).toArray();
    }

    const cursor = this.collection(type).find();

    if (qm.filter) {
      const filter = buildFilter(qm.filter);
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

  count<T>(type: { new (): T }, filter: QueryFilter<T>) {
    return this.collection(type).countDocuments(buildFilter(filter));
  }

  async removeOne<T>(type: { new (): T }, filter: QueryFilter<T>) {
    const res = await this.collection(type).deleteOne(buildFilter(filter));
    return res.deletedCount;
  }

  async remove<T>(type: { new (): T }, filter: QueryFilter<T>) {
    const res = await this.collection(type).deleteMany(buildFilter(filter));
    return res.deletedCount;
  }

  collection<T>(type: { new (): T }) {
    const meta = getEntityMeta(type);
    return this.conn.db().collection(meta.name);
  }

  async beginTransaction() {
    if (this.session?.inTransaction()) {
      throw new Error('There is a pending transaction.');
    }
    this.session = this.conn.startSession();
  }

  async commit() {
    if (!this.session?.inTransaction()) {
      throw new Error('There is not a pending transaction.');
    }
    await this.session.commitTransaction();
    this.session.endSession();
  }

  async rollback() {
    if (!this.session?.inTransaction()) {
      throw new Error('There is not a pending transaction.');
    }
    await this.session.abortTransaction();
  }

  release() {
    if (this.session?.inTransaction()) {
      throw new Error('Querier should not be released while there is an open transaction.');
    }
    return this.conn.close();
  }
}
