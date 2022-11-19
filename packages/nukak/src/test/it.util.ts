import { getKeys } from '../util/index.js';
import { AbstractSqlQuerier } from '../querier/index.js';
import { Type } from '../type/index.js';
import { getEntities, getMeta } from '../entity/decorator/index.js';

export async function createTables(querier: AbstractSqlQuerier, primaryKeyType: string) {
  const entities = getEntities();
  await Promise.all(
    entities.map((entity) => {
      const sql = getDdlForTable(entity, querier, primaryKeyType);
      return querier.run(sql);
    })
  );
}

export async function dropTables(querier: AbstractSqlQuerier) {
  const entities = getEntities();
  await Promise.all(
    entities.map((entity) => {
      const meta = getMeta(entity);
      const sql = `DROP TABLE IF EXISTS ${querier.dialect.escapeId(meta.name)}`;
      return querier.run(sql);
    })
  );
}

export async function clearTables(querier: AbstractSqlQuerier) {
  const entities = getEntities();
  await Promise.all(
    entities.map((entity) => {
      const sql = querier.dialect.delete(entity, {}, { softDelete: false });
      return querier.run(sql);
    })
  );
}

function getDdlForTable<E>(entity: Type<E>, querier: AbstractSqlQuerier, primaryKeyType: string) {
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
      if (field.type === Number) {
        propSql += 'BIGINT';
      } else if (field.type === Date) {
        propSql += 'TIMESTAMP';
      } else {
        propSql += defaultType;
      }
    }
    return propSql;
  });

  sql += columns.join(',\n\t');
  sql += `\n);`;

  // log('sql', sql);

  return sql;
}
