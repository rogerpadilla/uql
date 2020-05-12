import { Mongoose, ClientSession } from 'mongoose';
import { QueryFilter, Query, QueryOne, QueryPopulate } from '../../type';
import { Querier } from '../type';
import { fillDocumentQuery, parseFilter } from './mongoose.util';

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
    const res = await this.conn.model(type.name).updateMany(parseFilter(filter), body);
    return res.modifiedCount;
  }

  findOneById<T>(type: { new (): T }, id: any, qm: QueryPopulate<T>) {
    const docQuery = this.conn.model(type.name).findById(id);
    return fillDocumentQuery(docQuery, qm).exec();
  }

  findOne<T>(type: { new (): T }, qm: QueryOne<T>) {
    const docQuery = this.conn.model(type.name).findOne(parseFilter(qm.filter));
    return fillDocumentQuery(docQuery, qm).exec();
  }

  find<T>(type: { new (): T }, qm: Query<T>): Promise<T[]> {
    const docQuery = this.conn.model(type.name).find(parseFilter(qm.filter));
    return fillDocumentQuery(docQuery, qm).exec();
  }

  count<T>(type: { new (): T }, filter: QueryFilter<T>): Promise<number> {
    return this.conn.model(type.name).countDocuments(parseFilter(filter)).exec();
  }

  async removeOne<T>(type: { new (): T }, filter: QueryFilter<T>) {
    const res = await this.conn.model(type.name).deleteOne(parseFilter(filter)).exec();
    return res.deletedCount;
  }

  async remove<T>(type: { new (): T }, filter: QueryFilter<T>) {
    const res = await this.conn.model(type.name).deleteMany(parseFilter(filter)).exec();
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
