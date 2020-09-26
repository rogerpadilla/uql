import { Database } from 'sqlite';
import { Query, QueryFilter, QueryOneFilter, QueryOptions, QueryProject, Querier } from 'uql/type';
import { mapRows } from '../rowsMapper';
import { SqliteDialect } from './sqliteDialect';

export class SqliteQuerier extends Querier {
  private hasPendingTransaction?: boolean;
  readonly dialect = new SqliteDialect();

  constructor(readonly db: Database) {
    super();
  }

  query(sql: string) {
    console.debug(`\nquery: ${sql}\n`);
    return this.db.run(sql);
  }

  async insert<T>(type: { new (): T }, bodies: T[]) {
    const query = this.dialect.insert(type, bodies);
    const res = await this.query(query);
    const ids = Array(bodies.length)
      .fill(res.lastID)
      .map((firstId, index) => firstId + index);
    return ids;
  }

  async insertOne<T>(type: { new (): T }, body: T) {
    const query = this.dialect.insert(type, body);
    const res = await this.query(query);
    return res.lastID;
  }

  async update<T>(type: { new (): T }, filter: QueryFilter<T>, body: T) {
    const query = this.dialect.update(type, filter, body);
    const res = await this.query(query);
    return res.changes;
  }

  async findOne<T>(type: { new (): T }, qm: QueryOneFilter<T>, opts?: QueryOptions) {
    (qm as Query<T>).limit = 1;
    const rows = await this.find(type, qm, opts);
    return rows ? rows[0] : undefined;
  }

  async find<T>(type: { new (): T }, qm: Query<T>, opts?: QueryOptions) {
    const query = this.dialect.find(type, qm, opts);
    const res = await this.db.all<T[]>(query);
    const data = mapRows(res);
    return data;
  }

  async count<T>(type: { new (): T }, filter?: QueryFilter<T>) {
    const query = this.dialect.find(
      type,
      { project: ({ 'COUNT(*) count': 1 } as unknown) as QueryProject<T>, filter },
      { isTrustedProject: true }
    );
    const res = await this.db.get<{ count: number }>(query);
    return Number(res.count);
  }

  async remove<T>(type: { new (): T }, filter: QueryFilter<T>) {
    const query = this.dialect.remove(type, filter);
    const res = await this.query(query);
    return res.changes;
  }

  get hasOpenTransaction(): boolean {
    return this.hasPendingTransaction;
  }

  async beginTransaction() {
    if (this.hasPendingTransaction) {
      throw new TypeError('There is a pending transaction.');
    }
    await this.query(this.dialect.beginTransactionCommand);
    this.hasPendingTransaction = true;
  }

  async commitTransaction() {
    if (!this.hasPendingTransaction) {
      throw new TypeError('There is not a pending transaction.');
    }
    await this.query('COMMIT');
    this.hasPendingTransaction = undefined;
  }

  async rollbackTransaction() {
    if (!this.hasPendingTransaction) {
      throw new TypeError('There is not a pending transaction.');
    }
    await this.query('ROLLBACK');
    this.hasPendingTransaction = undefined;
  }

  async release() {
    if (this.hasPendingTransaction) {
      throw new TypeError('Querier should not be released while there is an open transaction.');
    }
    // no-op
  }
}
