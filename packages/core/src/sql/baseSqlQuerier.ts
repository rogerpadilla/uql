import { Query, QueryProject, QuerierPoolConnection, Type, QueryCriteria, FieldValue } from '../type';
import { BaseQuerier } from '../querier';
import { getMeta } from '../entity/decorator';
import { clone } from '../util';
import { mapRows } from './sql.util';
import { BaseSqlDialect } from './baseSqlDialect';
import { raw } from './raw';

export abstract class BaseSqlQuerier extends BaseQuerier {
  private hasPendingTransaction?: boolean;

  constructor(readonly conn: QuerierPoolConnection, readonly dialect: BaseSqlDialect) {
    super();
  }

  override async count<E>(entity: Type<E>, qm?: QueryCriteria<E>) {
    const res: any = await this.findMany(entity, { ...qm, $project: [raw('COUNT(*)', 'count')] as QueryProject<E> });
    return Number(res[0].count);
  }

  override async findMany<E>(entity: Type<E>, qm: Query<E>) {
    const query = this.dialect.find(entity, qm);
    const res = await this.conn.all<E>(query);
    const founds = mapRows(res);
    await this.findToManyRelations(entity, founds, qm.$project);
    return founds;
  }

  override async insertMany<E>(entity: Type<E>, payload: E[]) {
    if (!payload.length) {
      return;
    }
    payload = clone(payload);
    const query = this.dialect.insert(entity, payload);
    const { firstId } = await this.conn.run(query);
    const meta = getMeta(entity);
    const ids = payload.map((it, index) => {
      it[meta.id as string] ??= firstId + index;
      return it[meta.id];
    });
    await this.insertRelations(entity, payload);
    return ids;
  }

  override async updateMany<E>(entity: Type<E>, payload: E, qm: QueryCriteria<E>) {
    payload = clone(payload);
    const query = this.dialect.update(entity, payload, qm);
    const { changes } = await this.conn.run(query);
    await this.updateRelations(entity, payload, qm);
    return changes;
  }

  override async deleteMany<E>(entity: Type<E>, qm: QueryCriteria<E>) {
    const meta = getMeta(entity);
    const founds = await this.findMany(entity, { ...qm, $project: [meta.id] });
    const ids = founds.map((it) => it[meta.id]);
    if (!ids.length) {
      return 0;
    }
    const query = this.dialect.delete(entity, { $filter: { [meta.id]: ids } });
    const { changes } = await this.conn.run(query);
    await this.deleteRelations(entity, ids);
    return changes;
  }

  override get hasOpenTransaction(): boolean {
    return this.hasPendingTransaction;
  }

  override async beginTransaction() {
    if (this.hasPendingTransaction) {
      throw new TypeError('pending transaction');
    }
    await this.conn.run(this.dialect.beginTransactionCommand);
    this.hasPendingTransaction = true;
  }

  override async commitTransaction() {
    if (!this.hasPendingTransaction) {
      throw new TypeError('not a pending transaction');
    }
    await this.conn.run('COMMIT');
    this.hasPendingTransaction = undefined;
  }

  override async rollbackTransaction() {
    if (!this.hasPendingTransaction) {
      throw new TypeError('not a pending transaction');
    }
    await this.conn.run('ROLLBACK');
    this.hasPendingTransaction = undefined;
  }

  override async release() {
    if (this.hasPendingTransaction) {
      throw new TypeError('pending transaction');
    }
    return this.conn.release();
  }
}
