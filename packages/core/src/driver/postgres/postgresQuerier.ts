import { getEntityMeta } from '../../entity/decorator';
import { QueryFilter, QuerierPoolConnection } from '../../type';
import { BaseSqlQuerier } from '../baseSqlQuerier';
import { PostgresDialect } from './postgresDialect';

export class PostgresQuerier extends BaseSqlQuerier {
  constructor(conn: QuerierPoolConnection) {
    super(new PostgresDialect(), conn);
  }

  async query<T>(sql: string) {
    const res: { rows: T } = await this.conn.query(sql);
    return res.rows;
  }

  async insert<T>(type: { new (): T }, bodies: T[]) {
    const query = this.dialect.insert(type, bodies);
    const res = await this.query<{ insertid: number }[]>(query);
    const meta = getEntityMeta(type);
    return bodies.map((body, index) => (body[meta.id.property] ? body[meta.id.property] : res[index].insertid));
  }

  async update<T>(type: { new (): T }, filter: QueryFilter<T>, body: T) {
    const query = this.dialect.update(type, filter, body);
    const res: { rowCount: number } = await this.conn.query(query);
    return res.rowCount;
  }

  async remove<T>(type: { new (): T }, filter: QueryFilter<T>) {
    const query = this.dialect.remove(type, filter);
    const res = await this.conn.query(query);
    return res.rowCount;
  }
}
