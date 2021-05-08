import { getMeta } from '../../entity/decorator';
import { QueryFilter, QuerierPoolConnection } from '../../type';
import { BaseSqlQuerier } from '../baseSqlQuerier';
import { PostgresDialect } from './postgresDialect';

export class PostgresQuerier extends BaseSqlQuerier {
  constructor(conn: QuerierPoolConnection) {
    super(new PostgresDialect(), conn);
  }

  processQueryResult<E>({ rows }: { rows: E }): E {
    return rows;
  }

  async insert<E>(entity: { new (): E }, bodies: E[]) {
    const query = this.dialect.insert(entity, bodies);
    const res = await this.query<{ insertid: number }[]>(query);
    const meta = getMeta(entity);
    return bodies.map((body, index) => (body[meta.id.property] ? body[meta.id.property] : res[index].insertid));
  }

  async update<E>(entity: { new (): E }, filter: QueryFilter<E>, body: E) {
    const query = this.dialect.update(entity, filter, body);
    const res: { rowCount: number } = await this.conn.query(query);
    return res.rowCount;
  }

  async remove<E>(entity: { new (): E }, filter: QueryFilter<E>) {
    const query = this.dialect.remove(entity, filter);
    const res: { rowCount: number } = await this.conn.query(query);
    return res.rowCount;
  }
}
