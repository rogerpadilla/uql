import { log } from 'uql/config';
import { getEntityMeta } from 'uql/decorator';
import {
  Query,
  QueryFilter,
  QueryUpdateResult,
  QueryOptions,
  QueryProject,
  QuerierPoolConnection,
  Querier,
  QueryOne,
} from 'uql/type';
import { mapRows } from './rowsMapper';
import { SqlDialect } from './sqlDialect';

export abstract class SqlQuerier<ID = any> extends Querier<ID> {
  private hasPendingTransaction?: boolean;

  constructor(readonly dialect: SqlDialect, readonly conn: QuerierPoolConnection) {
    super();
  }

  async query<T>(query: string) {
    log(`\nquery: ${query}\n`, 'info');
    const res: [T] = await this.conn.query(query);
    return res[0];
  }

  async insert<T>(type: { new (): T }, bodies: T[]) {
    const query = this.dialect.insert(type, bodies);
    const res = await this.query<QueryUpdateResult>(query);
    const meta = getEntityMeta(type);
    return bodies.map((body, index) => (body[meta.id.property] ? body[meta.id.property] : res.insertId + index));
  }

  async insertOne<T>(type: { new (): T }, body: T) {
    const ids = await this.insert(type, [body]);
    return ids[0];
  }

  async update<T>(type: { new (): T }, filter: QueryFilter<T>, body: T) {
    const query = this.dialect.update(type, filter, body);
    const res = await this.query<QueryUpdateResult>(query);
    return res.affectedRows;
  }

  async findOneById<T>(type: { new (): T }, id: ID, qo: QueryOne<T>, opts?: QueryOptions) {
    const meta = getEntityMeta(type);
    (qo as Query<T>).filter = { [meta.id.property]: id };
    return this.findOne(type, qo, opts);
  }

  async findOne<T>(type: { new (): T }, qm: Query<T>, opts?: QueryOptions) {
    qm.limit = 1;
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
