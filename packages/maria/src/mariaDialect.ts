import { AbstractSqlDialect } from 'nukak/dialect';
import { getMeta } from 'nukak/entity';
import type { QueryConflictPaths, Type } from 'nukak/type';
import SqlString from 'sqlstring';

export class MariaDialect extends AbstractSqlDialect {
  override insert<E>(entity: Type<E>, payload: E | E[]): string {
    const sql = super.insert(entity, payload);
    const returning = this.returningId(entity);
    return `${sql} ${returning}`;
  }

  override upsert<E>(entity: Type<E>, conflictPaths: QueryConflictPaths<E>, payload: E): string {
    const insert = super.insert(entity, payload);
    const meta = getMeta(entity);
    const update = this.getUpsertUpdateAssignments(meta, conflictPaths, payload, (name) => `VALUES(${name})`);
    const returning = this.returningId(entity);
    const onConflict = update ? ` ON DUPLICATE KEY UPDATE ${update}` : '';
    const sql = update ? insert : insert.replace(/^INSERT/, 'INSERT IGNORE');
    return `${sql}${onConflict} ${returning}`;
  }

  override escape(value: unknown): string {
    return SqlString.escape(value);
  }
}
