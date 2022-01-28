import { getMeta } from '@uql/core/entity';
import { Query, Type, QueryCriteria, QueryOptions, IdValue, QueryUpdateResult, IsolationLevel } from '@uql/core/type';
import { unflatObjects, clone } from '@uql/core/util';
import { AbstractSqlDialect } from '@uql/core/dialect';

import { AbstractQuerier } from './abstractQuerier';

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

  override async count<E>(entity: Type<E>, qm?: QueryCriteria<E>) {
    const query = await this.dialect.count(entity, qm);
    const res: any = await this.all<E>(query);
    return Number(res[0].count);
  }

  override async findMany<E>(entity: Type<E>, qm: Query<E>) {
    const query = this.dialect.find(entity, qm);
    const res = await this.all<E>(query);
    const founds = unflatObjects(res);
    await this.findToManyRelations(entity, founds, qm.$project);
    return founds;
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

  override async updateMany<E>(entity: Type<E>, qm: QueryCriteria<E>, payload: E) {
    payload = clone(payload);
    const query = this.dialect.update(entity, qm, payload);
    const { changes } = await this.run(query);
    await this.updateRelations(entity, qm, payload);
    return changes;
  }

  override async deleteMany<E>(entity: Type<E>, qm: QueryCriteria<E>, opts?: QueryOptions) {
    const meta = getMeta(entity);
    const findQuery = await this.dialect.find(entity, { ...qm, $project: [meta.id] });
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
