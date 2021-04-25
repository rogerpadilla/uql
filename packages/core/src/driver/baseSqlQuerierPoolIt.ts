import { BaseQuerierPoolIt } from '../querier/baseQuerierPoolIt';
import { getEntityMeta } from '../entity/decorator';
import { QuerierPool } from '../type';
import { BaseSqlQuerier } from './baseSqlQuerier';

export abstract class BaseSqlQuerierPoolIt extends BaseQuerierPoolIt {
  readonly primaryKeyType: string = 'BIGINT PRIMARY KEY AUTO_INCREMENT';
  querier: BaseSqlQuerier;

  constructor(pool: QuerierPool) {
    super(pool);
  }

  async createTables() {
    const run = async (index: number) => {
      if (index >= this.entities.length) {
        return;
      }
      const ddl = this.buildDdlForTable(this.entities[index]);
      await this.querier.query(ddl);
      await run(index + 1);
    };
    await run(0);
  }

  async dropTables() {
    await Promise.all(
      this.entities.map((type) => {
        const meta = getEntityMeta(type);
        return this.querier.query(`DROP TABLE IF EXISTS ${this.querier.dialect.escapeId(meta.name)}`);
      })
    );
  }

  buildDdlForTable<T>(type: { new (): T }) {
    const meta = getEntityMeta(type);

    let sql = `CREATE TABLE ${this.querier.dialect.escapeId(meta.name)} (\n\t`;

    const defaultType = 'VARCHAR(50)';

    const columns = Object.keys(meta.properties).map((key) => {
      const prop = meta.properties[key];
      let propSql = this.querier.dialect.escapeId(prop.name) + ' ';
      if (prop.isId) {
        propSql += prop.onInsert ? defaultType : this.primaryKeyType;
      } else {
        const rel = meta.relations[key];
        propSql += rel || prop.type === Number ? 'BIGINT' : defaultType;
      }
      return propSql;
    });

    sql += columns.join(',\n\t');
    sql += `\n);`;

    return sql;
  }
}
