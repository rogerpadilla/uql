import { canonicalToColumnType } from '../../schema/canonicalType.js';
import type { ColumnNode } from '../../schema/types.js';

/**
 * A column's `@Field({ ... })` options as source, or `''` when it needs none.
 *
 * Shared by the entity generator and the merger because they emit the same decorator. They each had
 * their own copy, and the copies had drifted: the merger's dropped `unique` and `defaultValue`, so
 * merging a column into an existing entity file quietly produced a weaker field than generating the
 * file from scratch.
 */
export function buildFieldOptionsSource(col: ColumnNode, propertyName: string, indexName?: string): string {
  const options: string[] = [];

  // Without this the entity maps to a column named after the property, which for anything the
  // transformer rewrote - every `user_id` - is a column the database does not have.
  if (propertyName !== col.name) {
    options.push(`name: '${col.name}'`);
  }

  const columnType = canonicalToColumnType(col.type);
  if (columnType) {
    options.push(`columnType: '${columnType}'`);
  }
  if (col.type.length && col.type.category === 'string') {
    options.push(`length: ${col.type.length}`);
  }
  if (col.type.precision !== undefined) {
    options.push(`precision: ${col.type.precision}`);
    if (col.type.scale !== undefined) {
      options.push(`scale: ${col.type.scale}`);
    }
  }
  if (col.nullable) {
    options.push('nullable: true');
  }
  if (col.isUnique) {
    options.push('unique: true');
  }
  if (col.defaultValue !== undefined) {
    options.push(`defaultValue: ${formatDefaultValueSource(col.defaultValue)}`);
  }
  if (indexName) {
    options.push(`index: '${indexName}'`);
  }

  return options.length > 0 ? `{ ${options.join(', ')} }` : '';
}

/**
 * A default value as source. Strings stay single-quoted, expressions included: `defaultValue: 'now()'`
 * is what reaches the DDL. The generator used to branch on `CURRENT_TIMESTAMP`/`NEXTVAL`/`(` first, but
 * both branches emitted a quoted string and only the fallthrough escaped embedded quotes.
 */
function formatDefaultValueSource(value: unknown): string {
  if (typeof value === 'string') {
    return `'${value.replace(/'/g, "\\'")}'`;
  }
  if (typeof value === 'boolean' || typeof value === 'number') {
    return value.toString();
  }
  if (value === null) {
    return 'null';
  }
  return JSON.stringify(value);
}
