import { escape } from 'sqlstring';
import { AbstractSqlDialect } from 'nukak/dialect';
import type { QueryConflictPaths, Type } from 'nukak/type';
import { getMeta } from 'nukak/entity';
import { filterFieldKeys } from 'nukak/util';

export class MariaDialect extends AbstractSqlDialect {
  override insert<E>(entity: Type<E>, payload: E | E[]): string {
    const sql = super.insert(entity, payload);
    const returning = this.returningId(entity);
    return `${sql} ${returning}`;
  }

  override upsert<E>(entity: Type<E>, conflictPaths: QueryConflictPaths<E>, payload: E): string {
    const meta = getMeta(entity);
    const insert = super.insert(entity, payload);
    const felds = filterFieldKeys(meta, payload, 'onInsert');
    const update = felds
      .filter((col) => !conflictPaths[col])
      .map((col) => `${this.escapeId(col)} = VALUES(${this.escapeId(col)})`)
      .join(', ');
    const returning = this.returningId(entity);
    return `${insert} ON DUPLICATE KEY UPDATE ${update} ${returning}`;
  }

  override escape(value: any): string {
    return escape(value);
  }
}
