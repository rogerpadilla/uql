import { canonicalToColumnType, isVectorCategory } from '../../schema/canonicalType.js';
import { SqlExpression } from '../../schema/sqlExpression.js';
import type { ColumnNode } from '../../schema/types.js';
import { DATE_PRECISION } from '../../util/date.js';
import { isAutoIncrement } from '../../util/field.util.js';
import { jsonDocument } from '../../util/object.util.js';
import { escapeSingleQuotes } from '../../util/sqlLiteral.js';
import { quoted, sqlTag } from './sourceLiteral.js';

/** What a field of the column contributes, given the property it maps to, which decides whether a `name` is needed. */
type MethodSource = (col: ColumnNode, propertyName: string) => readonly string[];

/**
 * What each field of a {@link ColumnNode} chains onto its builder, in emit order; `satisfies` makes a new field
 * answer. The builder itself is the column's type, `f.column('varchar')`.
 */
const METHOD_SOURCE = {
  // The type's bounds, which its family's builder takes.
  type: (col) => [
    ...(col.type.length && col.type.category === 'string' ? [`.length(${col.type.length})`] : []),
    ...(col.type.length && isVectorCategory(col.type.category) ? [`.dimensions(${col.type.length})`] : []),
    ...(writesPrecision(col.type) ? [`.precision(${col.type.precision})`] : []),
    ...(col.type.precision !== undefined && col.type.scale !== undefined ? [`.scale(${col.type.scale})`] : []),
  ],
  // A column is NOT NULL unless it says otherwise; a key is a key, which holds no null.
  nullable: (col) => (col.nullable && !col.isPrimaryKey ? ['.nullable()'] : []),
  isPrimaryKey: (col) => (col.isPrimaryKey ? ['.id()'] : []),
  // Generates where `isAutoIncrement` says, which only a column the database treats otherwise contradicts.
  isAutoIncrement: (col) =>
    isAutoIncrement({ type: canonicalToColumnType(col.type) }, ownsSoleKey(col)) === col.isAutoIncrement
      ? []
      : [col.isAutoIncrement ? '.autoIncrement()' : '.autoIncrement(false)'],
  isUnique: (col) => (col.isUnique ? ['.unique()'] : []),
  defaultValue: (col) => {
    const value = defaultSource(col);
    return value ? [`.default(${value.source})`] : [];
  },
  // Without this the entity maps to a column named after the property, which for anything the
  // transformer rewrote - every `user_id` - is a column the database does not have.
  name: (col, propertyName) => (propertyName === col.name ? [] : [`.name(${quoted(col.name)})`]),
  comment: (col) => (col.comment ? [`.comment(${quoted(col.comment)})`] : []),
  // Emitted after the index: a generated column is the builder computed `as()` its SQL, and kept.
  generatedAs: (col) => (col.generatedAs ? [`.as(${sqlTag(col.generatedAs)}).stored()`] : []),
  // The graph link: a foreign key becomes a relation decorator, emitted beside the field rather than in it.
  table: null,
} as const satisfies Record<keyof ColumnNode, MethodSource | null>;

/** The AST's reading of the entity's `ownsSoleKey`: the table's whole key, and not the key of a row it references. */
function ownsSoleKey(col: ColumnNode): boolean {
  const { primaryKey, outgoingRelations } = col.table;
  return (
    col.isPrimaryKey &&
    primaryKey?.columns.length === 1 &&
    !outgoingRelations.some(({ from }) => from.columns.includes(col))
  );
}

/** Whether to write `type`'s precision: not for a timestamp at a `Date`'s milliseconds, its default. */
function writesPrecision(type: ColumnNode['type']): boolean {
  return type.precision !== undefined && !(type.category === 'timestamp' && type.precision === DATE_PRECISION);
}

/** A column's builder as source, `f.column('varchar').length(80).nullable()`, its plain index's name chained on. */
export function buildFieldOptionsSource(col: ColumnNode, propertyName: string, indexName?: string): string {
  const { generatedAs, ...methodSources } = METHOD_SOURCE;
  const methods = Object.values(methodSources).flatMap((source) => source?.(col, propertyName) ?? []);
  // Not a column field: the index is a table-level object the field only borrows.
  const index = indexName ? [`.index(${quoted(indexName)})`] : [];
  return `f.column(${quoted(canonicalToColumnType(col.type))})${[...methods, ...index, ...generatedAs(col)].join('')}`;
}

/** The decorator declaring the column `builder` writes: `@Computed` for one the database generates. */
export function fieldDecoratorSource(builder: string, col: ColumnNode): string {
  return col.generatedAs ? `@Computed(() => ${builder})` : `@Field(${builder})`;
}

/** The uql imports the field's decorator needs besides `Field`, as {@link indexNeedsRaw} tells for an index. */
export function fieldImports(col: ColumnNode): string[] {
  const name = defaultSource(col)?.name;
  return [...(col.generatedAs === undefined ? [] : ['sql']), ...(name ? [name] : [])];
}

/**
 * A column's default as source code, with the name it imports: SQL the way an entity declares it, a JSON column's
 * text as the document it spells (as SQL where that document is itself JSON text), and any other string quoted.
 */
function defaultSource(col: ColumnNode): { readonly source: string; readonly name?: string } | undefined {
  const value = col.defaultValue;
  if (value === undefined) {
    return undefined;
  }
  if (SqlExpression.isExpression(value)) {
    return sqlDefaultSource(value);
  }
  if (col.type.category === 'json' && typeof value === 'string') {
    const document = jsonDocument(value);
    if (typeof document === 'string' && jsonDocument(document) !== undefined) {
      return { source: sqlTag(`'${escapeSingleQuotes(value)}'`), name: 'sql' };
    }
    if (document !== undefined) {
      return { source: JSON.stringify(document) };
    }
  }
  return { source: typeof value === 'string' ? quoted(value) : JSON.stringify(value) };
}

/**
 * A SQL default as an entity declares it, with the name to import for it: the value uql exports by its own
 * name (`currentTimestamp`), and `sql` for any other SQL, as introspection reads it back.
 */
function sqlDefaultSource({ kind, sql }: SqlExpression): {
  readonly name: SqlExpression['kind'];
  readonly source: string;
} {
  return sql === undefined ? { name: kind, source: kind } : { name: 'sql', source: sqlTag(sql) };
}
