import { Query, QueryFilter, QueryUpdateResult, QueryOptions, QueryProject, QuerierPoolConnection } from '../type';
import { BaseQuerier } from '../querier';
import { getEntityMeta } from '../entity/decorator';
import { mapRows } from './sqlRowsMapper';
import { BaseSqlDialect } from './baseSqlDialect';

export abstract class BaseSqlQuerier<ID = any> extends BaseQuerier<ID> {
  private hasPendingTransaction?: boolean;

  constructor(readonly dialect: BaseSqlDialect, readonly conn: QuerierPoolConnection) {
    super();
  }

  async query<T>(query: string) {
    const res = await this.conn.query(query);
    return this.processQueryResult<T>(res);
  }

  protected processQueryResult<T>(result: any): T {
    return result;
  }

  async insert<T>(type: { new (): T }, bodies: T[]) {
    const query = this.dialect.insert(type, bodies);
    const res = await this.query<QueryUpdateResult>(query);
    const meta = getEntityMeta(type);
    return bodies.map((body, index) => (body[meta.id.property] ? body[meta.id.property] : res.insertId + index));
  }

  async update<T>(type: { new (): T }, filter: QueryFilter<T>, body: T) {
    const query = this.dialect.update(type, filter, body);
    const res = await this.query<QueryUpdateResult>(query);
    return res.affectedRows;
  }

  async find<T>(type: { new (): T }, qm: Query<T>, opts?: QueryOptions) {
    const query = this.dialect.find(type, qm, opts);
    const res = await this.query<T[]>(query);
    const founds = mapRows(res);
    await this.populateToManyRelations(type, founds, qm.populate);
    return founds;
  }

  async remove<T>(type: { new (): T }, filter: QueryFilter<T>) {
    const query = this.dialect.remove(type, filter);
    const res = await this.query<QueryUpdateResult>(query);
    return res.affectedRows;
  }

  async count<T>(type: { new (): T }, filter?: QueryFilter<T>) {
    const res: any = await this.find(
      type,
      { project: ({ 'COUNT(*) count': 1 } as any) as QueryProject<T>, filter },
      { isTrustedProject: true }
    );
    return Number(res[0].count);
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
