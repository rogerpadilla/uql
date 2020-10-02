import { log } from 'uql/config';
import { getEntityMeta } from 'uql/decorator';
import {
  Query,
  QueryFilter,
  QueryUpdateResult,
  QueryOptions,
  QueryOneFilter,
  QueryProject,
  QuerierPoolConnection,
  Querier,
} from 'uql/type';
import { mapRows } from './rowsMapper';
import { SqlDialect } from './sqlDialect';

export abstract class SqlQuerier extends Querier {
  private hasPendingTransaction?: boolean;

  constructor(readonly dialect: SqlDialect, readonly conn: QuerierPoolConnection) {
    super();
  }

  async query<T>(query: string) {
    log(`\nquery: ${query}\n`);
    const res: [T] = await this.conn.query(query);
    return res[0];
  }

  async insert<T>(type: { new (): T }, bodies: T[]) {
    const query = this.dialect.insert(type, bodies);
    const res = await this.query<QueryUpdateResult>(query);
    const meta = getEntityMeta(type);
    return bodies[bodies.length - 1][meta.id.property] ?? res.insertId;
  }

  async insertOne<T>(type: { new (): T }, body: T) {
    return this.insert(type, [body]);
  }

  async update<T>(type: { new (): T }, filter: QueryFilter<T>, body: T) {
    const query = this.dialect.update(type, filter, body);
    const res = await this.query<QueryUpdateResult>(query);
    return res.affectedRows;
  }

  async findOne<T>(type: { new (): T }, qm: QueryOneFilter<T>, opts?: QueryOptions) {
    (qm as Query<T>).limit = 1;
    const rows = await this.find(type, qm, opts);
    return rows ? rows[0] : undefined;
  }

  async find<T>(type: { new (): T }, qm: Query<T>, opts?: QueryOptions) {
    const query = this.dialect.find(type, qm, opts);
    const res = await this.query<T[]>(query);
    const data = mapRows(res);
    return data;
  }

  async count<T>(type: { new (): T }, filter?: QueryFilter<T>) {
    const res: any = await this.find(
      type,
      { project: ({ 'COUNT(*) count': 1 } as unknown) as QueryProject<T>, filter },
      { isTrustedProject: true }
    );
    return Number(res[0].count);
  }

  async remove<T>(type: { new (): T }, filter: QueryFilter<T>) {
    const query = this.dialect.remove(type, filter);
    const res = await this.query<QueryUpdateResult>(query);
    return res.affectedRows;
  }

  get hasOpenTransaction(): boolean {
    return this.hasPendingTransaction;
  }

  async beginTransaction() {
    if (this.hasPendingTransaction) {
      throw new TypeError('pending transaction');
    }
    await this.query(this.dialect.beginTransactionCommand);
    this.hasPendingTransaction = true;
  }

  async commitTransaction() {
    if (!this.hasPendingTransaction) {
      throw new TypeError('not a pending transaction');
    }
    await this.query('COMMIT');
    this.hasPendingTransaction = undefined;
  }

  async rollbackTransaction() {
    if (!this.hasPendingTransaction) {
      throw new TypeError('not a pending transaction');
    }
    await this.query('ROLLBACK');
    this.hasPendingTransaction = undefined;
  }

  async release() {
    if (this.hasPendingTransaction) {
      throw new TypeError('pending transaction');
    }
    return this.conn.release();
  }
}
