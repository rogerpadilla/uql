import {
  Query,
  QueryFilter,
  QueryUpdateResult,
  QueryOptions,
  QueryProject,
  QuerierPoolConnection,
  Type,
} from '../type';
import { BaseQuerier } from '../querier';
import { getMeta } from '../entity/decorator';
import { mapRows } from './sqlRowsMapper';
import { BaseSqlDialect } from './baseSqlDialect';

export abstract class BaseSqlQuerier<ID = any> extends BaseQuerier<ID> {
  private hasPendingTransaction?: boolean;

  constructor(readonly dialect: BaseSqlDialect, readonly conn: QuerierPoolConnection) {
    super();
  }

  abstract query<E>(query: string): Promise<E>;

  async insertMany<E>(entity: Type<E>, bodies: E[]) {
    const query = this.dialect.insert(entity, bodies);
    const res = await this.query<QueryUpdateResult>(query);
    const meta = getMeta(entity);
    return bodies.map((body, index) => (body[meta.id.property] ? body[meta.id.property] : res.insertId + index));
  }

  async updateMany<E>(entity: Type<E>, filter: QueryFilter<E>, body: E) {
    const query = this.dialect.update(entity, filter, body);
    const res = await this.query<QueryUpdateResult>(query);
    return res.affectedRows;
  }

  async findMany<E>(entity: Type<E>, qm: Query<E>, opts?: QueryOptions) {
    const query = this.dialect.find(entity, qm, opts);
    const res = await this.query<E[]>(query);
    const founds = mapRows(res);
    await this.populateToManyRelations(entity, founds, qm.populate);
    return founds;
  }

  async removeMany<E>(entity: Type<E>, filter: QueryFilter<E>) {
    const query = this.dialect.remove(entity, filter);
    const res = await this.query<QueryUpdateResult>(query);
    return res.affectedRows;
  }

  async count<E>(entity: Type<E>, filter?: QueryFilter<E>) {
    const res: any = await this.findMany(
      entity,
      { project: { 'COUNT(*) count': 1 } as any as QueryProject<E>, filter },
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
