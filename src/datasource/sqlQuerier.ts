import { Query, QueryFilter, QueryUpdateResult, QueryOptions, QueryOneFilter, QueryOne, QueryPopulate } from '../type';
import { mapRows } from '../util/rowsMapper.util';
import { getEntityMeta, RelationProperties } from '../entity';
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
    return this.processPopulate(type, data, qm.populate);
  }

  async count<T>(type: { new (): T }, filter: QueryFilter<T>) {
    const query = this.dialect.find(
      type,
      { project: { 'COUNT(*) count': 1 } as any, filter },
      { trustedProject: true }
    );
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

  async processPopulate<T>(type: { new (): T }, data: T[], populate: QueryPopulate<T>) {
    if (!populate) {
      return data;
    }

    const meta = getEntityMeta(type);
    const relations = meta.relations;
    const toManyRelations = Object.keys(relations).reduce((acc, prop) => {
      if (populate[prop] && relations[prop].cardinality.endsWith('ToMany')) {
        acc[prop] = relations[prop];
      }
      return acc;
    }, {} as { [p: string]: RelationProperties<T> });

    if (Object.keys(toManyRelations).length === 0) {
      return data;
    }

    const dataMap = data.reduce((acc, it) => {
      acc.set(it[meta.id], it);
      return acc;
    }, new Map<any, T>());

    const popPromises = Object.keys(toManyRelations).map(async (key) => {
      const qo = populate[key] as QueryOne<T>;
      const rel = toManyRelations[key];
      const relType = rel.type();
      const relCol = rel.mappedBy;
      const relData = await this.find(relType, {
        filter: { [relCol]: { $in: dataMap.keys() } },
        project: qo.project,
      });

      const relDataMap = relData.reduce((acc, it) => {
        if (!acc.has(it[relCol])) {
          acc.set(it[relCol], [] as T[]);
        }
        acc.get(it[relCol]).push(it);
        return acc;
      }, new Map<any, T[]>());

      for (const row of data) {
        row[key] = relDataMap.get(row[meta.id]);
      }

      await this.processPopulate(relType, relData, qo.populate);
    });

    await Promise.all(popPromises);

    return data;
  }
}
