import { log } from 'uql/config';
import { getEntityMeta } from 'uql/decorator';
import { Query, QueryFilter, QueryOptions } from 'uql/type';
import { mapRows } from '../rowsMapper';
import { SqlQuerier } from '../sqlQuerier';
import { Sqlit3Connection } from './sqlite3QuerierPool';
import { SqliteDialect } from './sqliteDialect';

export class SqliteQuerier extends SqlQuerier {
  constructor(readonly conn: Sqlit3Connection) {
    super(new SqliteDialect(), conn);
  }

  query(sql: string) {
    log(`\nquery: ${sql}\n`);
    return this.conn.query(sql);
  }

  async insert<T>(type: { new (): T }, bodies: T[]) {
    const query = this.dialect.insert(type, bodies);
    const res = await this.query(query);
    const meta = getEntityMeta(type);
    return bodies[bodies.length - 1][meta.id.property] ?? res.lastID - res.changes + 1;
  }

  async update<T>(type: { new (): T }, filter: QueryFilter<T>, body: T) {
    const query = this.dialect.update(type, filter, body);
    const res = await this.query(query);
    return res.changes;
  }

  async find<T>(type: { new (): T }, qm: Query<T>, opts?: QueryOptions) {
    const query = this.dialect.find(type, qm, opts);
    const res = await this.conn.all(query);
    const data = mapRows(res);
    return data;
  }

  async remove<T>(type: { new (): T }, filter: QueryFilter<T>) {
    const query = this.dialect.remove(type, filter);
    const res = await this.query(query);
    return res.changes;
  }
}
