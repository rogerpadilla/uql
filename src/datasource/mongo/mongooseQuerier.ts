import { Mongoose, ClientSession, DocumentQuery, QueryPopulateOptions, FilterQuery } from 'mongoose';
import { QueryFilter, Query, QueryOne, QueryPopulate } from '../../type';
import { Querier } from '../type';

export class MongooseQuerier extends Querier {
  protected session: ClientSession;

  constructor(protected readonly conn: Mongoose) {
    super();
  }

  hasOpenTransaction() {
    return this.session?.inTransaction();
  }

  async insertOne<T>(type: { new (): T }, body: T) {
    const res = await this.conn.model(type.name).create(body);
    return res.id;
  }

  async updateOne<T>(type: { new (): T }, filter: QueryFilter<T>, body: T) {
    const res = await this.conn.model(type.name).updateOne(type, filter, body);
    return res.modifiedCount;
  }

  async update<T>(type: { new (): T }, filter: QueryFilter<T>, body: T) {
    const res = await this.conn.model(type.name).updateMany(filter as any, body);
    return res.modifiedCount;
  }

  findOneById<T>(type: { new (): T }, id: any, qm: QueryPopulate<T>) {
    const docQuery = this.conn.model(type.name).findById(id);
    return processDocumentQuery(docQuery, qm);
  }

  findOne<T>(type: { new (): T }, qm: QueryOne<T>) {
    const docQuery = this.conn.model(type.name).findOne(qm.filter as any);
    return processDocumentQuery(docQuery, qm);
  }

  find<T>(type: { new (): T }, qm: Query<T>): Promise<T[]> {
    const docQuery = this.conn.model(type.name).find(qm.filter as any, undefined);
    return processDocumentQuery(docQuery, qm);
  }

  count<T>(type: { new (): T }, filter: QueryFilter<T>): Promise<number> {
    return this.conn
      .model(type.name)
      .countDocuments(filter as any, undefined)
      .exec();
  }

  async removeOne<T>(type: { new (): T }, filter: QueryFilter<T>) {
    const res = await this.conn.model(type.name).deleteOne(filter as any);
    return res.deletedCount;
  }

  async remove<T>(type: { new (): T }, filter: QueryFilter<T>) {
    const res = await this.conn.model(type.name).deleteMany(filter as any);
    return res.deletedCount;
  }

  async beginTransaction() {
    if (this.session?.inTransaction()) {
      throw new Error('There is a pending transaction.');
    }
    this.session = await this.conn.startSession();
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
    return this.conn.disconnect();
  }
}

function processDocumentQuery<T>(docQuery: DocumentQuery<any, any>, qm: Query<T>) {
  if (qm.project) {
    docQuery = docQuery.select(qm.project);
  }
  if (qm.populate) {
    docQuery.populate(parsePopulate(qm.populate));
  }
  if (qm.sort) {
    docQuery = docQuery.sort(qm.sort);
  }
  if (qm.skip) {
    docQuery = docQuery.skip(qm.skip);
  }
  if (qm.limit) {
    docQuery = docQuery.limit(qm.limit);
  }
  return docQuery.exec();
}

// function parseFilter<T>(filter: QueryFilter<T>): FilterQuery<T> {

// }

function parsePopulate<T>(populate: QueryPopulate<T>): QueryPopulateOptions {
  const mongoosePopulate = Object.keys(populate).reduce((acc, key) => {
    acc.path = key;
    const val: QueryPopulate<T> = populate[key];
    if (val?.project) {
      acc.select = val.project;
    }
    if (val?.populate) {
      acc.populate = parsePopulate(val.populate);
    }
    return acc;
  }, {} as QueryPopulateOptions);
  return mongoosePopulate;
}
