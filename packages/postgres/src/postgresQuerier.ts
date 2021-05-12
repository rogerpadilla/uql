import { getMeta } from '@uql/core/entity/decorator';
import { QueryFilter, QuerierPoolConnection } from '@uql/core/type';
import { BaseSqlQuerier } from '@uql/core/sql';
import { PostgresDialect } from './postgresDialect';

export class PostgresQuerier extends BaseSqlQuerier {
  constructor(conn: QuerierPoolConnection) {
    super(new PostgresDialect(), conn);
  }

  async query<E>(query: string): Promise<E> {
    const { rows } = await this.conn.query(query);
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
