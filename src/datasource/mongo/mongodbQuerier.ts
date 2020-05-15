import { MongoClient, ClientSession } from 'mongodb';
import { QueryFilter, Query, QueryOneFilter, QueryOne, QueryPopulate } from '../../type';
import { Querier } from '../type';
import { getEntityMeta, getEntityId } from '../../entity';
import { fillCursor, parseFilter } from './mongodb.util';

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
    const res = await this.conn.db().collection(type.name).updateMany(parseFilter(filter), body);
    return res.modifiedCount;
  }

  async findOneById<T>(type: { new (): T }, id: any, qm?: QueryOne<T>) {
    const doc = await this.conn.db().collection(type.name).findOne(id, qm?.project);
    return this.processPopulate(type, doc, qm?.populate);
  }

  async findOne<T>(type: { new (): T }, qm: QueryOneFilter<T>) {
    const doc = await this.conn.db().collection(type.name).findOne(parseFilter(qm.filter), qm.project);
    return this.processPopulate(type, doc, qm.populate);
  }

  async find<T>(type: { new (): T }, qm: Query<T>): Promise<T[]> {
    const cursor = this.conn.db().collection(type.name).find(parseFilter(qm.filter));
    const filledCursor = fillCursor(cursor, qm);
    const docs = await filledCursor.toArray();
    return this.processPopulate(type, docs, qm.populate);
  }

  count<T>(type: { new (): T }, filter: QueryFilter<T>): Promise<number> {
    return this.conn.db().collection(type.name).countDocuments(parseFilter(filter));
  }

  async removeOne<T>(type: { new (): T }, filter: QueryFilter<T>) {
    const res = await this.conn.db().collection(type.name).deleteOne(parseFilter(filter));
    return res.deletedCount;
  }

  async remove<T>(type: { new (): T }, filter: QueryFilter<T>) {
    const res = await this.conn.db().collection(type.name).deleteMany(parseFilter(filter));
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

  async processPopulate<T>(type: { new (): T }, data: T | T[], populate: QueryPopulate<T>) {
    if (!populate) {
      return data;
    }

    const dataArr = Array.isArray(data) ? data : [data];
    const meta = getEntityMeta(type);

    const popPromises = Object.keys(populate).map(async (popKey) => {
      const rel = meta.relations[popKey];
      if (!rel) {
        throw new Error(`'${type.name}.${popKey}' is not annotated with a relation decorator`);
      }

      const popEntry = populate[popKey as keyof T];
      const popIds = dataArr.map((it) => it[popKey]);
      const relType = rel.type();
      const relMeta = getEntityMeta(relType);

      const relData = await this.conn
        .db()
        .collection(relType.name)
        .find<T>({ [relMeta.id]: { $in: popIds } })
        .project(popEntry.project)
        .toArray();

      const relDataMap = relData.reduce((acc, it) => {
        acc[it[relMeta.id]] = it;
        return acc;
      }, {} as { [prop: string]: T });

      for (const row of dataArr) {
        row[popKey] = relDataMap[row[popKey]];
      }
    });

    await Promise.all(popPromises);

    return dataArr;
  }
}
