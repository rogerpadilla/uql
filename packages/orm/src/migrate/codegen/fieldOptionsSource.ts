import { canonicalToColumnType, isVectorCategory } from '../../schema/canonicalType.js';
import { SqlExpression, type SqlExpressionKind } from '../../schema/sqlExpression.js';
import type { ColumnNode, EnumValues } from '../../schema/types.js';
import { DATE_PRECISION } from '../../util/date.js';
import { isAutoIncrement } from '../../util/field.util.js';
import { quoted, rawTag } from './sourceLiteral.js';

/** What a column's decorator is written against beyond the column itself. */
interface FieldSourceContext {
  /** The property the column maps to, which decides whether a `name` is needed. */
  readonly propertyName: string;
  /** The single-column index the field can carry itself, where there is one. */
  readonly indexName?: string;
}

type OptionSource = (col: ColumnNode, context: FieldSourceContext) => readonly string[];

/** What each field of a {@link ColumnNode} contributes to `@Field({ ... })`, in emit order; `satisfies` makes a new field answer. */
const OPTION_SOURCE = {
  // Without this the entity maps to a column named after the property, which for anything the
  // transformer rewrote - every `user_id` - is a column the database does not have.
  name: (col, { propertyName }) => (propertyName === col.name ? [] : [`name: ${quoted(col.name)}`]),
  // The column type as `type`, which the decorator checks the property against and the schema reads
  // exactly as it reads `columnType`.
  type: (col) => {
    const columnType = canonicalToColumnType(col.type);
    return [
      `type: ${quoted(columnType)}`,
      ...(col.type.length && col.type.category === 'string' ? [`length: ${col.type.length}`] : []),
      ...(col.type.length && isVectorCategory(col.type.category) ? [`dimensions: ${col.type.length}`] : []),
      ...(writesPrecision(col.type) ? [`precision: ${col.type.precision}`] : []),
      ...(col.type.precision !== undefined && col.type.scale !== undefined ? [`scale: ${col.type.scale}`] : []),
    ];
  },
  // A column is nullable unless it says otherwise, and a key is NOT NULL without saying so.
  nullable: (col) => (col.nullable || col.isPrimaryKey ? [] : ['nullable: false']),
  isUnique: (col) => (col.isUnique ? ['unique: true'] : []),
  enum: (col) => (col.enum ? [`enum: [${enumMembersSource(col.enum).join(', ')}] as const`] : []),
  defaultValue: (col) =>
    col.defaultValue === undefined ? [] : [`defaultValue: ${defaultValueSource(col.defaultValue)}`],
  generatedAs: (col) => (col.generatedAs ? [`computed: ${rawTag(col.generatedAs)}`, 'stored: true'] : []),
  comment: (col) => (col.comment ? [`comment: ${quoted(col.comment)}`] : []),

  // A key is `@Id`, which says it on its own, and generates where `isAutoIncrement` says, which only a
  // column the database treats otherwise contradicts.
  isPrimaryKey: null,
  isAutoIncrement: (col) =>
    isAutoIncrement(
      { type: canonicalToColumnType(col.type) },
      col.isPrimaryKey && col.table.primaryKey?.columns.length === 1,
    ) === col.isAutoIncrement
      ? []
      : [`autoIncrement: ${col.isAutoIncrement}`],
  // Graph links. A foreign key becomes a relation decorator, emitted beside the field rather than in it.
  table: null,
  references: null,
  referencedBy: null,
} as const satisfies Record<keyof ColumnNode, OptionSource | null>;

/** Whether to write `type`'s precision: not for a timestamp at a `Date`'s milliseconds, its default. */
function writesPrecision(type: ColumnNode['type']): boolean {
  return type.precision !== undefined && !(type.category === 'timestamp' && type.precision === DATE_PRECISION);
}

/** A column's `@Id({ ... })` or `@Field({ ... })` options as source. */
export function buildFieldOptionsSource(col: ColumnNode, propertyName: string, indexName?: string): string {
  const context = { propertyName, indexName };
  const options = [
    ...Object.values(OPTION_SOURCE).flatMap((source) => source?.(col, context) ?? []),
    // Not a column field: the index is a table-level object the field only borrows.
    ...(indexName ? [`index: ${quoted(indexName)}`] : []),
  ];

  return `{ ${options.join(', ')} }`;
}

/** An enum's members as source literals, which are also the property's type as a union. */
export function enumMembersSource(members: EnumValues): string[] {
  return members.map((it) => (typeof it === 'number' ? String(it) : quoted(it)));
}

/** The uql imports the field's decorator needs besides `Field`, as {@link indexNeedsRaw} tells for an index. */
export function fieldImports(col: ColumnNode): string[] {
  const sql = SqlExpression.isExpression(col.defaultValue) ? [sqlDefaultSource(col.defaultValue).name] : [];
  return [...(col.generatedAs === undefined ? [] : ['raw']), ...sql];
}

/** A default value as source code: SQL the way an entity declares it, a string single-quoted and escaped. */
function defaultValueSource(value: unknown): string {
  if (SqlExpression.isExpression(value)) {
    return sqlDefaultSource(value).source;
  }
  return typeof value === 'string' ? quoted(value) : JSON.stringify(value);
}

/**
 * A SQL default as an entity declares it, with the name to import for it: the value uql exports by its own
 * name (`currentTimestamp`), and `raw` for any other SQL, as introspection reads it back.
 */
function sqlDefaultSource({ kind, sql }: SqlExpression): { readonly name: SqlExpressionKind; readonly source: string } {
  return sql === undefined ? { name: kind, source: kind } : { name: 'raw', source: rawTag(sql) };
}
