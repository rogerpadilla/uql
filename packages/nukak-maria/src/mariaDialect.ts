import sqlstring from 'sqlstring';
import { AbstractSqlDialect } from 'nukak/dialect';
import { QueryConflictPaths, QueryRaw, Scalar, Type } from 'nukak/type';
import { getMeta } from 'nukak/entity';
import { getKeys, getPersistable, getRawValue } from 'nukak/util';

export class MariaDialect extends AbstractSqlDialect {
  override insert<E>(entity: Type<E>, payload: E | E[]): string {
    const sql = super.insert(entity, payload);
    const returning = this.returningId(entity);
    return `${sql} ${returning}`;
  }

  override upsert<E>(entity: Type<E>, conflictPaths: QueryConflictPaths<E>, payload: E): string {
    const meta = getMeta(entity);
    const insert = super.insert(entity, payload);
    const record = getPersistable(meta, payload, 'onInsert');
    const columns = getKeys(record);
    const update = columns
      .filter((col) => !conflictPaths[col])
      .map((col) => `${this.escapeId(col)} = VALUES(${this.escapeId(col)})`)
      .join(', ');
    const returning = this.returningId(entity);
    return `${insert} ON DUPLICATE KEY UPDATE ${update} ${returning}`;
  }

  override escape(value: any): Scalar {
    if (value instanceof QueryRaw) {
      return getRawValue({ value, dialect: this });
    }
    return sqlstring.escape(value);
  }
}
