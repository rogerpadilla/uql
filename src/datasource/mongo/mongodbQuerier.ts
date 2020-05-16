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

  async insertOne<T>(type: { new (): T }, body: T) {
    const res = await this.conn.db().collection(type.name).insertOne(body);
    return res.insertedId;
  }

  async updateOne<T>(type: { new (): T }, filter: QueryFilter<T>, body: T) {
    const res = await this.conn.db().collection(type.name).updateOne(type, filter, body);
    return res.modifiedCount;
  }

  async update<T>(type: { new (): T }, filter: QueryFilter<T>, body: T) {
    const res = await this.conn.db().collection(type.name).updateMany(buildFilter(filter), body);
    return res.modifiedCount;
  }

  async findOneById<T>(type: { new (): T }, id: any, qm: QueryOne<T> = {}) {
    const meta = getEntityMeta(type);
    (qm as QueryOneFilter<T>).filter = { [meta.id]: id };
    return this.findOne(type, qm);
  }

  async findOne<T>(type: { new (): T }, qm: QueryOneFilter<T>) {
    if (qm.populate) {
      const pipeline = buildAggregationPipeline(type, qm);
      return this.conn
        .db()
        .collection(type.name)
        .aggregate(pipeline)
        .toArray()
        .then((resp) => resp[0]);
    }
    return this.conn.db().collection(type.name).findOne(buildFilter(qm.filter), { projection: qm.project });
  }

  async find<T>(type: { new (): T }, qm: Query<T>) {
    if (qm.populate) {
      const pipeline = buildAggregationPipeline(type, qm);
      return this.conn.db().collection(type.name).aggregate(pipeline).toArray();
    }

    const cursor = this.conn.db().collection(type.name).find();

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
    return this.conn.db().collection(type.name).countDocuments(buildFilter(filter));
  }

  async removeOne<T>(type: { new (): T }, filter: QueryFilter<T>) {
    const res = await this.conn.db().collection(type.name).deleteOne(buildFilter(filter));
    return res.deletedCount;
  }

  async remove<T>(type: { new (): T }, filter: QueryFilter<T>) {
    const res = await this.conn.db().collection(type.name).deleteMany(buildFilter(filter));
    return res.deletedCount;
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
