import { Query, QueryFilter, QueryUpdateResult, QueryOptions, QueryOneFilter } from '../type';
import { mapRows } from '../util/rowsMapper.util';
import { QuerierPoolConnection, Querier } from './type';
import { SqlDialect } from './sqlDialect';

export abstract class SqlQuerier extends Querier {
  protected hasPendingTransaction?: boolean;

  constructor(protected readonly dialect: SqlDialect, protected readonly conn: QuerierPoolConnection) {
    super();
  }

  abstract query<T>(sql: string): Promise<T>;

  async insertOne<T>(type: { new (): T }, body: T) {
    const query = this.dialect.insert(type, body);
    const res = await this.query<QueryUpdateResult>(query);
    return res.insertId;
  }

  updateOne<T>(type: { new (): T }, filter: QueryFilter<T>, body: T) {
    return this.update(type, filter, body, 1);
  }

  async update<T>(type: { new (): T }, filter: QueryFilter<T>, body: T, limit?: number) {
    const query = this.dialect.update(type, filter, body, limit);
    const res = await this.query<QueryUpdateResult>(query);
    return res.affectedRows;
  }

  findOne<T>(type: { new (): T }, qm: QueryOneFilter<T>, opts?: QueryOptions) {
    (qm as Query<T>).limit = 1;
    return this.find(type, qm, opts).then((rows) => (rows ? rows[0] : undefined));
  }

  async find<T>(type: { new (): T }, qm: Query<T>, opts?: QueryOptions) {
    const query = this.dialect.find(type, qm, opts);
    const res = await this.query<T[]>(query);
    const data = mapRows(res);
    return data;
  }

  async count<T>(type: { new (): T }, filter: QueryFilter<T>) {
    const query = this.dialect.find(type, { project: { 'COUNT(*) count': 1 } as any, filter }, { trustedProject: true });
    const res = await this.query<{ count: number }[]>(query);
    return res[0].count;
  }

  removeOne<T>(type: { new (): T }, filter: QueryFilter<T>) {
    return this.remove(type, filter, 1);
  }

  async remove<T>(type: { new (): T }, filter: QueryFilter<T>, limit?: number) {
    const query = this.dialect.remove(type, filter, limit);
    const res = await this.query<QueryUpdateResult>(query);
    return res.affectedRows;
  }

  hasOpenTransaction() {
    return this.hasPendingTransaction;
  }

  async beginTransaction() {
    if (this.hasPendingTransaction) {
      throw new Error('There is a pending transaction.');
    }
    await this.query(this.dialect.beginTransactionCommand);
    this.hasPendingTransaction = true;
  }

  async commit() {
    if (!this.hasPendingTransaction) {
      throw new Error('There is not a pending transaction.');
    }
    await this.query('COMMIT');
    this.hasPendingTransaction = undefined;
  }

  async rollback() {
    if (!this.hasPendingTransaction) {
      throw new Error('There is not a pending transaction.');
    }
    await this.query('ROLLBACK');
    this.hasPendingTransaction = undefined;
  }

  async release() {
    if (this.hasPendingTransaction) {
      throw new Error('Querier should not be released while there is an open transaction.');
    }
    return this.conn.release();
  }

  // async processPopulateToMany<T>(type: { new (): T }, data: T[], populate: QueryPopulate<T>) {
  //   if (!populate) {
  //     return data;
  //   }

  //   const meta = getEntityMeta(type);
  //   const ids = data.map((it) => it[meta.id]);

  //   const popPromises = Object.keys(populate)
  //     .filter((popKey) => meta.relations[popKey].cardinality === 'oneToMany')
  //     .map(async (popKey) => {
  //       const rel = meta.relations[popKey];
  //       if (!rel) {
  //         throw new Error(`'${type.name}.${popKey}' is not annotated with a relation decorator`);
  //       }

  //       const popEntry: QueryOne<T> = populate[popKey];
  //       const relType = rel.type();
  //       const relCol = rel.mappedBy;

  //       const relData = await this.find(relType, {
  //         filter: { [relCol]: { $in: ids } },
  //         project: popEntry.project,
  //       });

  //       const relDataMap: { [prop: string]: T[] } = relData.reduce((acc, it) => {
  //         if (!acc[it[relCol]]) {
  //           acc[it[relCol]] = [];
  //         }
  //         acc[it[relCol]].push(it);
  //         return acc;
  //       }, {});

  //       for (const row of data) {
  //         row[popKey] = relDataMap[row[meta.id]];
  //       }

  //       await this.processPopulateToMany(relType, relData, popEntry.populate);
  //     });

  //   await Promise.all(popPromises);

  //   return data;
  // }
}
