import { log } from 'console';
import { getEntityMeta } from 'uql/decorator';
import {
  QuerierPoolConnection,
  Query,
  QueryFilter,
  QueryOneFilter,
  QueryOptions,
  QueryProject,
  QueryUpdateResult,
} from 'uql/type';
import { mapRows } from '../rowsMapper';
import { SqlQuerier } from '../sqlQuerier';
import { MySqlDialect } from './mysqlDialect';

export class MySqlQuerier extends SqlQuerier {
  constructor(conn: QuerierPoolConnection) {
    super(new MySqlDialect(), conn);
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

  findOne<T>(type: { new (): T }, qm: QueryOneFilter<T>, opts?: QueryOptions) {
    (qm as Query<T>).limit = 1;
    return this.find(type, qm, opts).then((rows) => (rows ? rows[0] : undefined));
  }

  async find<T>(type: { new (): T }, qm: Query<T>, opts?: QueryOptions) {
    const query = this.dialect.find(type, qm, opts);
    const res = await this.query<T[]>(query);
    const data = mapRows(res);
    return data;
  }

  async count<T>(type: { new (): T }, filter?: QueryFilter<T>) {
    const query = this.dialect.find(
      type,
      { project: ({ 'COUNT(*) count': 1 } as unknown) as QueryProject<T>, filter },
      { isTrustedProject: true }
    );
    const res = await this.query<{ count: number }[]>(query);
    return Number(res[0].count);
  }

  async remove<T>(type: { new (): T }, filter: QueryFilter<T>) {
    const query = this.dialect.remove(type, filter);
    const res = await this.query<QueryUpdateResult>(query);
    return res.affectedRows;
  }

  async release() {
    await super.release();
    return this.conn.release();
  }
}
