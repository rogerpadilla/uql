import { canonicalToColumnType } from '../../schema/canonicalType.js';
import type { ColumnNode } from '../../schema/types.js';
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
  type: (col) => {
    const columnType = canonicalToColumnType(col.type);
    return [
      `columnType: ${quoted(columnType)}`,
      ...(col.type.length && col.type.category === 'string' ? [`length: ${col.type.length}`] : []),
      ...(col.type.precision === undefined ? [] : [`precision: ${col.type.precision}`]),
      ...(col.type.precision !== undefined && col.type.scale !== undefined ? [`scale: ${col.type.scale}`] : []),
    ];
  },
  nullable: (col) => (col.nullable ? ['nullable: true'] : []),
  isUnique: (col) => (col.isUnique ? ['unique: true'] : []),
  enum: (col) =>
    col.enum ? [`enum: [${col.enum.map((it) => (typeof it === 'number' ? it : quoted(it))).join(', ')}]`] : [],
  defaultValue: (col) =>
    col.defaultValue === undefined ? [] : [`defaultValue: ${defaultValueSource(col.defaultValue)}`],
  generatedAs: (col) => (col.generatedAs ? [`computed: ${rawTag(col.generatedAs)}`, 'stored: true'] : []),
  comment: (col) => (col.comment ? [`comment: ${quoted(col.comment)}`] : []),

  // A key is `@Id`, and a numeric one generates by that alone. Neither is an option to write out.
  isPrimaryKey: null,
  isAutoIncrement: null,
  // Graph links. A foreign key becomes a relation decorator, emitted beside the field rather than in it.
  table: null,
  references: null,
  referencedBy: null,
} as const satisfies Record<keyof ColumnNode, OptionSource | null>;

/** A column's `@Field({ ... })` options as source, `''` where it needs none: shared by the generator and the merger. */
export function buildFieldOptionsSource(col: ColumnNode, propertyName: string, indexName?: string): string {
  const context = { propertyName, indexName };
  const options = [
    ...Object.values(OPTION_SOURCE).flatMap((source) => source?.(col, context) ?? []),
    // Not a column field: the index is a table-level object the field only borrows.
    ...(indexName ? [`index: ${quoted(indexName)}`] : []),
  ];

  return options.length > 0 ? `{ ${options.join(', ')} }` : '';
}

/** Whether the field's decorator needs `raw` imported, the way {@link indexNeedsRaw} does for an index. */
export function fieldNeedsRaw(col: ColumnNode): boolean {
  return col.generatedAs !== undefined;
}

/** A default value as source, a string single-quoted and escaped, an expression included: `defaultValue: 'now()'`. */
function defaultValueSource(value: unknown): string {
  if (typeof value === 'string') {
    return quoted(value);
  }
  if (typeof value === 'boolean' || typeof value === 'number') {
    return value.toString();
  }
  if (value === null) {
    return 'null';
  }
  return JSON.stringify(value);
}
