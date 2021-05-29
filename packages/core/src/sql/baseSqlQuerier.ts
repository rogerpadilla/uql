import { Query, QueryFilter, QueryProject, QuerierPoolConnection, Type } from '../type';
import { BaseQuerier } from '../querier';
import { getMeta } from '../entity/decorator';
import { mapRows } from './sqlRowsMapper';
import { BaseSqlDialect } from './baseSqlDialect';
import { literal } from './literal';

export abstract class BaseSqlQuerier extends BaseQuerier {
  private hasPendingTransaction?: boolean;

  constructor(readonly conn: QuerierPoolConnection, readonly dialect: BaseSqlDialect) {
    super();
  }

  async insertMany<E>(entity: Type<E>, bodies: E[]) {
    const query = this.dialect.insert(entity, bodies);
    const res = await this.conn.run(query);
    const meta = getMeta(entity);
    return bodies.map((body, index) => (body[meta.id.property] ? body[meta.id.property] : res.insertId + index));
  }

  async updateMany<E>(entity: Type<E>, filter: QueryFilter<E>, body: E) {
    const query = this.dialect.update(entity, filter, body);
    const res = await this.conn.run(query);
    return res.changes;
  }

  async findMany<E>(entity: Type<E>, qm: Query<E>) {
    const query = this.dialect.find(entity, qm);
    const res = await this.conn.all<E>(query);
    const founds = mapRows(res);
    await this.populateToManyRelations(entity, founds, qm.populate);
    return founds;
  }

  async removeMany<E>(entity: Type<E>, filter: QueryFilter<E>) {
    const query = this.dialect.remove(entity, filter);
    const res = await this.conn.run(query);
    return res.changes;
  }

  async count<E>(entity: Type<E>, filter?: QueryFilter<E>) {
    const res: any = await this.findMany(entity, { project: [literal('COUNT(*) count')] as QueryProject<E>, filter });
    return Number(res[0].count);
  }

  get hasOpenTransaction(): boolean {
    return this.hasPendingTransaction;
  }

  async beginTransaction() {
    if (this.hasPendingTransaction) {
      throw new TypeError('pending transaction');
    }
    await this.conn.run(this.dialect.beginTransactionCommand);
    this.hasPendingTransaction = true;
  }

  async commitTransaction() {
    if (!this.hasPendingTransaction) {
      throw new TypeError('not a pending transaction');
    }
    await this.conn.run('COMMIT');
    this.hasPendingTransaction = undefined;
  }

  async rollbackTransaction() {
    if (!this.hasPendingTransaction) {
      throw new TypeError('not a pending transaction');
    }
    await this.conn.run('ROLLBACK');
    this.hasPendingTransaction = undefined;
  }

  async release() {
    if (this.hasPendingTransaction) {
      throw new TypeError('pending transaction');
    }
    return this.conn.release();
  }
}
