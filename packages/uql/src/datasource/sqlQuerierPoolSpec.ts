import { escapeId as sqlstringEscapeId } from 'sqlstring';
import { getEntityMeta } from 'uql/decorator';
import { QuerierPool } from 'uql/type';
import { QuerierPoolSpec } from './querierPoolSpec';

export abstract class SqlQuerierPoolSpec extends QuerierPoolSpec {
  readonly primaryKeyType: string = 'INTEGER PRIMARY KEY AUTO_INCREMENT';

  constructor(pool: QuerierPool) {
    super(pool);
  }

  async createTables() {
    const run = async (index = 0) => {
      if (index >= this.entities.length) {
        return;
      }
      await this.querier.query(this.buildDdlForTable(this.entities[index]));
      await run(index + 1);
    };
    await run();
  }

  dropTables() {
    return Promise.all(
      this.entities.map((type) => {
        const meta = getEntityMeta(type);
        return this.querier.query(`DROP TABLE IF EXISTS ${this.escapeId(meta.name)}`);
      })
    );
  }

  buildDdlForTable<T>(type: { new (): T }) {
    const meta = getEntityMeta(type);

    let sql = `CREATE TABLE ${this.escapeId(meta.name)} (\n\t`;

    const defaultType = 'VARCHAR(50)';

    const columns = Object.keys(meta.properties).map((key) => {
      const prop = meta.properties[key];
      let propSql = this.escapeId(prop.name) + ' ';
      if (prop.isId) {
        propSql += prop.onInsert ? defaultType : this.primaryKeyType;
      } else {
        propSql += prop.type === Number ? 'BIGINT' : defaultType;
      }
      return propSql;
    });

    sql += columns.join(',\n\t');
    sql += `\n);`;

    return sql;
  }

  escapeId(val: any) {
    return sqlstringEscapeId(val);
  }
}
