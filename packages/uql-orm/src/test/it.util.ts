import { getEntities, getMeta } from '../entity/decorator/index.js';
import type { AbstractSqlQuerier } from '../querier/index.js';
import type { Type } from '../type/index.js';
import { getKeys } from '../util/index.js';

export async function createTables(querier: AbstractSqlQuerier, primaryKeyType: string) {
  const entities = getEntities();
  for (const entity of entities) {
    const sql = getDdlForTable(entity, querier, primaryKeyType);
    await querier.run(sql);
  }
}

export async function dropTables(querier: AbstractSqlQuerier) {
  const entities = getEntities();
  for (const entity of entities) {
    const meta = getMeta(entity);
    const sql = `DROP TABLE IF EXISTS ${querier.dialect.escapeId(meta.name!)}`;
    await querier.run(sql);
  }
}

export async function clearTables(querier: AbstractSqlQuerier) {
  const entities = getEntities();
  for (const entity of entities) {
    const ctx = querier.dialect.createContext();
    querier.dialect.delete(ctx, entity, {});
    await querier.run(ctx.sql, ctx.values);
  }
}

function getDdlForTable<E>(entity: Type<E>, querier: AbstractSqlQuerier, primaryKeyType: string) {
  const meta = getMeta(entity);

  let sql = `CREATE TABLE IF NOT EXISTS ${querier.dialect.escapeId(meta.name!)} (\n\t`;

  const insertableIdType = 'VARCHAR(36)';
  const defaultType = querier.dialect.escapeIdChar === '"' ? 'TEXT' : 'VARCHAR(255)';

  const columns = getKeys(meta.fields).map((key) => {
    const field = meta.fields[key]!;
    let propSql = querier.dialect.escapeId(field.name!) + ' ';
    if (field.isId) {
      propSql += field.onInsert ? `${insertableIdType} PRIMARY KEY` : primaryKeyType;
    } else if (field.type === 'vector' || field.type === 'halfvec' || field.type === 'sparsevec') {
      propSql += field.dimensions ? `${field.type}(${field.dimensions})` : field.type;
    } else if (field.type === Number) {
      propSql += 'BIGINT';
    } else if (field.type === Date) {
      propSql += 'TIMESTAMP';
    } else if (field.type === 'json' || field.type === 'jsonb') {
      propSql += field.type === 'jsonb' && querier.dialect.features.supportsJsonb ? 'JSONB' : 'JSON';
    } else {
      propSql += defaultType;
    }
    return propSql;
  });

  sql += columns.join(',\n\t');
  sql += `\n);`;

  // log('sql', sql);

  return sql;
}
