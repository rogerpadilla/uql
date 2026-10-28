import type { Except, FieldMeta, QuerySql } from '../type/index.js';
import { declaresNotNull, isAutoIncrement } from '../util/field.util.js';
import { resolveColumnCanonicalType } from './canonicalType.js';
import { schemaDefault } from './sqlExpression.js';
import type { ColumnNode } from './types.js';

/**
 * The column a field's options declare, whether an entity's table or a migration holds it: `soleKey` says whether it
 * is its table's whole and own key, which a numeric one auto-increments as, and `compile` renders its SQL.
 */
export function declaredColumn(
  field: FieldMeta,
  {
    name,
    soleKey,
    compile,
  }: { readonly name: string; readonly soleKey: boolean; readonly compile: (sql: QuerySql) => string },
): Except<ColumnNode, 'table'> {
  return {
    name,
    type: resolveColumnCanonicalType(field),
    nullable: !declaresNotNull(field),
    defaultValue: schemaDefault(field.defaultValue, compile),
    isPrimaryKey: field.isId === true,
    isAutoIncrement: isAutoIncrement(field, soleKey),
    isUnique: field.unique ?? false,
    // A stamp is filled by a trigger, so it is a column like any other; only `stored: true` generates.
    generatedAs: field.stored === true && field.computed ? compile(field.computed) : undefined,
    comment: field.comment,
  };
}
