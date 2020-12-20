import { ISqlite } from 'sqlite';
import { Query, QueryFilter, QueryOptions } from '../../type';
import { getEntityMeta } from '../../entity/decorator';
import { mapRows } from '../sqlRowsMapper';
import { BaseSqlQuerier } from '../baseSqlQuerier';
import { Sqlit3Connection } from './sqlite3QuerierPool';
import { SqliteDialect } from './sqliteDialect';

export class SqliteQuerier extends BaseSqlQuerier {
  constructor(readonly conn: Sqlit3Connection) {
    super(new SqliteDialect(), conn);
  }

  async insert<T>(type: { new (): T }, bodies: T[]) {
    const query = this.dialect.insert(type, bodies);
    const res = await this.query<ISqlite.RunResult>(query);
    const meta = getEntityMeta(type);
    return bodies.map((body, index) =>
      body[meta.id.property] ? body[meta.id.property] : res.lastID - res.changes + index + 1
    );
  }

  async update<T>(type: { new (): T }, filter: QueryFilter<T>, body: T) {
    const query = this.dialect.update(type, filter, body);
    const res = await this.query<ISqlite.RunResult>(query);
    return res.changes;
  }

  async find<T>(type: { new (): T }, qm: Query<T>, opts?: QueryOptions) {
    const query = this.dialect.find(type, qm, opts);
    const res = await this.conn.all(query);
    const founds = mapRows(res);
    await this.populateToManyRelations(type, founds, qm.populate);
    return founds;
  }

  async remove<T>(type: { new (): T }, filter: QueryFilter<T>) {
    const query = this.dialect.remove(type, filter);
    const res = await this.query<ISqlite.RunResult>(query);
    return res.changes;
  }
}
