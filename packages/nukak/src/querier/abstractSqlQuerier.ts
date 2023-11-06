import { Type, QueryOptions, QueryUpdateResult, QuerySearch, Query } from '../type/index.js';
import { unflatObjects, clone } from '../util/index.js';
import { AbstractSqlDialect } from '../dialect/index.js';
import { getMeta } from '../entity/index.js';

import { AbstractQuerier } from './abstractQuerier.js';

export abstract class AbstractSqlQuerier extends AbstractQuerier {
  private hasPendingTransaction?: boolean;

  constructor(readonly dialect: AbstractSqlDialect) {
    super();
  }

  /**
   * read query.
   * @param query the query
   */
  abstract all<T>(query: string): Promise<T[]>;

  /**
   * insert/update/delete/ddl query.
   * @param query the query
   */
  abstract run(query: string): Promise<QueryUpdateResult>;

  override async findMany<E>(entity: Type<E>, q: Query<E>) {
    const query = this.dialect.find(entity, q);
    const res = await this.all<E>(query);
    const founds = unflatObjects(res);
    await this.fillToManyRelations(entity, founds, q.$project);
    return founds;
  }

  override async count<E>(entity: Type<E>, q: QuerySearch<E> = {}) {
    const query = this.dialect.count(entity, q);
    const res = await this.all<{ count: number }>(query);
    return Number(res[0].count);
  }

  override async insertMany<E>(entity: Type<E>, payload: E[]) {
    payload = clone(payload);
    const query = this.dialect.insert(entity, payload);
    const { firstId } = await this.run(query);
    const meta = getMeta(entity);
    const ids = payload.map((it, index) => {
      it[meta.id as string] ??= firstId + index;
      return it[meta.id];
    });
    await this.insertRelations(entity, payload);
    return ids;
  }

  override async updateMany<E>(entity: Type<E>, q: QuerySearch<E>, payload: E) {
    payload = clone(payload);
    const query = this.dialect.update(entity, q, payload);
    const { changes } = await this.run(query);
    await this.updateRelations(entity, q, payload);
    return changes;
  }

  override async deleteMany<E>(entity: Type<E>, q: QuerySearch<E>, opts?: QueryOptions) {
    const meta = getMeta(entity);
    // TODO: project ID should be automatic unless specified to be ommited
    const findQuery = await this.dialect.find(entity, { ...q, $project: [meta.id] });
    const founds = await this.all<E>(findQuery);
    if (!founds.length) {
      return 0;
    }
    const ids = founds.map((it) => it[meta.id]);
    const query = this.dialect.delete(entity, { $filter: ids }, opts);
    const { changes } = await this.run(query);
    await this.deleteRelations(entity, ids, opts);
    return changes;
  }

  override get hasOpenTransaction() {
    return this.hasPendingTransaction;
  }

  override async beginTransaction(/*isolationLevel?: IsolationLevel*/) {
    if (this.hasPendingTransaction) {
      throw TypeError('pending transaction');
    }
    // TODO
    // if (isolationLevel) {
    //   await this.run(`SET TRANSACTION ISOLATION LEVEL ${isolationLevel}`);
    // }
    await this.run(this.dialect.beginTransactionCommand);
    this.hasPendingTransaction = true;
  }

  override async commitTransaction() {
    if (!this.hasPendingTransaction) {
      throw TypeError('not a pending transaction');
    }
    await this.run('COMMIT');
    this.hasPendingTransaction = undefined;
  }

  override async rollbackTransaction() {
    if (!this.hasPendingTransaction) {
      throw TypeError('not a pending transaction');
    }
    await this.run('ROLLBACK');
    this.hasPendingTransaction = undefined;
  }
}
