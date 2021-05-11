import { Query, QueryFilter, QueryOptions } from '../../type';
import { getMeta } from '../../entity/decorator';
import { mapRows } from '../sqlRowsMapper';
import { BaseSqlQuerier } from '../baseSqlQuerier';
import { Sqlit3Connection } from './sqlite3QuerierPool';
import { SqliteDialect } from './sqliteDialect';

export class SqliteQuerier extends BaseSqlQuerier {
  constructor(readonly conn: Sqlit3Connection) {
    super(new SqliteDialect(), conn);
  }

  async query<E>(query: string): Promise<E> {
    const res = await this.conn.query(query);
    return res as unknown as E;
  }

  async insert<E>(entity: { new (): E }, bodies: E[]) {
    const query = this.dialect.insert(entity, bodies);
    const res = await this.conn.run(query);
    const meta = getMeta(entity);
    return bodies.map((body, index) =>
      body[meta.id.property] ? body[meta.id.property] : res.lastID - res.changes + index + 1
    );
  }

  async update<E>(entity: { new (): E }, filter: QueryFilter<E>, body: E) {
    const query = this.dialect.update(entity, filter, body);
    const res = await this.conn.run(query);
    return res.changes;
  }

  async find<E>(entity: { new (): E }, qm: Query<E>, opts?: QueryOptions) {
    const query = this.dialect.find(entity, qm, opts);
    const res = await this.query<E[]>(query);
    const founds = mapRows(res);
    await this.populateToManyRelations(entity, founds, qm.populate);
    return founds;
  }

  async remove<E>(entity: { new (): E }, filter: QueryFilter<E>) {
    const query = this.dialect.remove(entity, filter);
    const res = await this.conn.run(query);
    return res.changes;
  }
}
