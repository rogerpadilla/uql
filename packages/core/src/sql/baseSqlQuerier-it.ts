import { BaseQuerierIt } from '../querier/baseQuerier-it';
import { getMeta } from '../entity/decorator';
import { QuerierPool, Type } from '../type';
import { getKeys } from '../util';
import { log } from '../options';
import { BaseSqlQuerier } from './baseSqlQuerier';

export abstract class BaseSqlQuerierIt extends BaseQuerierIt<BaseSqlQuerier> {
  readonly primaryKeyType: string = 'INTEGER PRIMARY KEY';

  constructor(pool: QuerierPool<BaseSqlQuerier>) {
    super(pool);
  }

  override async createTables() {
    const run = async (index: number) => {
      if (index >= this.entities.length) {
        return;
      }
      const ddl = this.buildDdlForTable(this.entities[index]);
      await this.querier.conn.run(ddl);
      await run(index + 1);
    };
    await run(0);
  }

  override async dropTables() {
    await Promise.all(
      this.entities.map((entity) => {
        const meta = getMeta(entity);
        return this.querier.conn.run(`DROP TABLE IF EXISTS ${this.querier.dialect.escapeId(meta.name)}`);
      })
    );
  }

  buildDdlForTable<E>(entity: Type<E>) {
    const meta = getMeta(entity);

    let sql = `CREATE TABLE ${this.querier.dialect.escapeId(meta.name)} (\n\t`;

    const insertableIdType = 'VARCHAR(36)';
    const defaultType = 'VARCHAR(50)';

    const columns = getKeys(meta.properties).map((key) => {
      const prop = meta.properties[key];
      let propSql = this.querier.dialect.escapeId(prop.name) + ' ';
      if (prop.isId) {
        propSql += prop.onInsert ? `${insertableIdType} PRIMARY KEY` : this.primaryKeyType;
      } else {
        propSql += prop.type === Number ? 'BIGINT' : defaultType;
      }
      return propSql;
    });

    sql += columns.join(',\n\t');
    sql += `\n);`;

    log('sql', sql);

    return sql;
  }
}
