import { BaseQuerierIt } from '../querier/baseQuerier-it';
import { getMeta } from '../entity/decorator';
import { QuerierPool, ReferenceOptions, Type } from '../type';
import { objectKeys } from '../util';
import { BaseSqlQuerier } from './baseSqlQuerier';

export abstract class BaseSqlQuerierIt extends BaseQuerierIt {
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
      await this.querier.conn.run(ddl);
      await run(index + 1);
    };
    await run(0);
  }

  async dropTables() {
    await Promise.all(
      this.entities.map((entity) => {
        const meta = getMeta(entity);
        return this.querier.conn.run(`DROP TABLE ${meta.name}`);
      })
    );
  }

  buildDdlForTable<E>(entity: Type<E>) {
    const meta = getMeta(entity);

    let sql = `CREATE TABLE ${meta.name} (\n\t`;

    const defaultIdType = 'VARCHAR(36)';
    const defaultType = 'VARCHAR(50)';

    const columns = objectKeys(meta.properties).map((key) => {
      const prop = meta.properties[key];
      let propSql = prop.name + ' ';
      if (prop.isId) {
        propSql += prop.onInsert ? `${defaultIdType} PRIMARY KEY` : this.primaryKeyType;
      } else if (prop.reference) {
        const rel = (prop.reference as ReferenceOptions).entity();
        const relMeta = getMeta(rel);
        const type = relMeta.id.onInsert
          ? defaultIdType
          : this.primaryKeyType.startsWith('INTEGER')
          ? 'INTEGER'
          : 'BIGINT';
        propSql += `${type} REFERENCES ${relMeta.name}(${relMeta.id.name})`;
      } else {
        propSql += prop.type === Number ? 'BIGINT' : defaultType;
      }
      return propSql;
    });

    sql += columns.join(',\n\t');
    sql += `\n);`;

    // console.log('sql', sql);

    return sql;
  }
}
