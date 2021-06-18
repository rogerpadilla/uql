import { log } from 'console';
import { getEntities, getMeta } from '../entity/decorator';
import { BaseSqlQuerier } from '../sql';
import { Type } from '../type';
import { getKeys } from '../util';

export async function createTables(querier: BaseSqlQuerier, primaryKeyType: string) {
  const entities = getEntities();
  await Promise.all(
    entities.map((entity) => {
      const ddl = buildDdlForTable(entity, querier, primaryKeyType);
      return querier.conn.run(ddl);
    })
  );
}

export async function dropTables(querier: BaseSqlQuerier) {
  const entities = getEntities();
  await Promise.all(
    entities.map((entity) => {
      const meta = getMeta(entity);
      return querier.conn.run(`DROP TABLE IF EXISTS ${querier.dialect.escapeId(meta.name)}`);
    })
  );
}

export async function cleanTables(querier: BaseSqlQuerier) {
  const entities = getEntities();
  await Promise.all(entities.map((entity) => querier.deleteMany(entity, {})));
}

function buildDdlForTable<E>(entity: Type<E>, querier: BaseSqlQuerier, primaryKeyType: string) {
  const meta = getMeta(entity);

  let sql = `CREATE TABLE ${querier.dialect.escapeId(meta.name)} (\n\t`;

  const insertableIdType = 'VARCHAR(36)';
  const defaultType = 'VARCHAR(50)';

  const columns = getKeys(meta.fields).map((key) => {
    const field = meta.fields[key];
    let propSql = querier.dialect.escapeId(field.name) + ' ';
    if (field.isId) {
      propSql += field.onInsert ? `${insertableIdType} PRIMARY KEY` : primaryKeyType;
    } else {
      propSql += field.type === Number ? 'BIGINT' : defaultType;
    }
    return propSql;
  });

  sql += columns.join(',\n\t');
  sql += `\n);`;

  // log('sql', sql);

  return sql;
}
