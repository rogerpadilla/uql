import { type ColumnOptionsBuilder, columns } from '../../entity/columnOptionsBuilder.js';
import { declaredColumn } from '../../schema/declaredColumn.js';
import type { EnumValues, ForeignKeyAction } from '../../schema/types.js';
import { COLUMN_OPTIONS, type FieldOptions, type QuerySql } from '../../type/index.js';
import { fieldOptionConflict } from '../../util/fieldOption.util.js';
import { constantSql, sql } from '../../util/sql.js';
import { UqlUsageError } from '../../util/uqlError.js';
import type { ForeignKeyBuilder, ForeignKeyTarget, FullColumnDefinition, TableColumnFactory } from './types.js';

/** A migration's SQL as written: it names no field, so it is the text of a `sql` interpolating nothing. */
function migrationSql(statement: QuerySql): string {
  const text = constantSql(statement);
  if (text === undefined) {
    throw new UqlUsageError("a migration's SQL binds nothing: write it as `sql` text interpolating no value");
  }
  return text;
}

/**
 * A table's column, named, over the `f` builder an entity column is: each method is that builder's, and `build` reads
 * its options as the schema reads an entity's. Mutable, since the table collects it before its chain ends.
 */
export class TableColumn implements ForeignKeyBuilder {
  readonly #name: string;
  #column: ColumnOptionsBuilder;
  #unsigned = false;
  #target?: ForeignKeyTarget;
  #onDelete?: ForeignKeyAction;
  #onUpdate?: ForeignKeyAction;

  constructor(name: string, column: ColumnOptionsBuilder) {
    this.#name = name;
    this.#column = column;
  }

  private chain(column: ColumnOptionsBuilder): this {
    this.#column = column;
    return this;
  }

  nullable(): this {
    return this.chain(this.#column.nullable());
  }

  default(value: FieldOptions['defaultValue']): this {
    return this.chain(this.#column.default(value));
  }

  id(): this {
    return this.chain(this.#column.id());
  }

  autoIncrement(): this {
    return this.chain(this.#column.autoIncrement());
  }

  unique(): this {
    return this.chain(this.#column.unique());
  }

  as(expression: string): this {
    return this.chain(this.#column.as(sql.text(expression)).stored());
  }

  length(length: number): this {
    return this.chain(this.#column.length(length));
  }

  precision(digits: number): this {
    return this.chain(this.#column.precision(digits));
  }

  scale(digits: number): this {
    return this.chain(this.#column.scale(digits));
  }

  enum(values: EnumValues): this {
    return this.chain(this.#column.with({ enum: values }));
  }

  comment(text: string): this {
    return this.chain(this.#column.comment(text));
  }

  index(name?: string): this {
    return this.chain(this.#column.index(name));
  }

  unsigned(): this {
    this.#unsigned = true;
    return this;
  }

  references(table: string, column = 'id'): ForeignKeyBuilder {
    this.#target = { table, columns: [column] };
    return this;
  }

  onDelete(action: ForeignKeyAction): this {
    this.#onDelete = action;
    return this;
  }

  onUpdate(action: ForeignKeyAction): this {
    this.#onUpdate = action;
    return this;
  }

  /** A key here is never implied to auto-increment: a migration states what it creates. */
  build(): FullColumnDefinition {
    const field = this.#column[COLUMN_OPTIONS];
    const conflict = fieldOptionConflict(field);
    if (conflict) {
      throw new UqlUsageError(`'${this.#name}' ${conflict}`);
    }
    const column = declaredColumn(field, { name: this.#name, soleKey: false, compile: migrationSql });
    return {
      ...column,
      type: this.#unsigned ? { ...column.type, unsigned: true } : column.type,
      enum: field.enum,
      index: field.index,
      foreignKey: this.#target && { references: this.#target, onDelete: this.#onDelete, onUpdate: this.#onUpdate },
    };
  }
}

/** Every column type, named and typed as `f` types it; `add` receives each column it makes. */
export function tableColumns(add: (column: TableColumn) => TableColumn): TableColumnFactory {
  const named = (name: string, column: ColumnOptionsBuilder) => add(new TableColumn(name, column));
  return {
    id: (name = 'id') => named(name, columns.bigint().id().autoIncrement()),
    integer: (name) => named(name, columns.column('int')),
    smallint: (name) => named(name, columns.column('smallint')),
    bigint: (name) => named(name, columns.bigint()),
    float: (name) => named(name, columns.column('float')),
    double: (name) => named(name, columns.column('double')),
    decimal: (name, precision, scale) => named(name, columns.decimal(precision, scale)),
    string: (name) => named(name, columns.string().length(255)),
    char: (name) => named(name, columns.column('char').length(1)),
    text: (name) => named(name, columns.text()),
    boolean: (name) => named(name, columns.boolean()),
    date: (name) => named(name, columns.column('date')),
    time: (name) => named(name, columns.column('time')),
    timestamp: (name) => named(name, columns.column('timestamp')),
    timestamptz: (name) => named(name, columns.column('timestamptz')),
    json: (name) => named(name, columns.json()),
    jsonb: (name) => named(name, columns.jsonb()),
    uuid: (name) => named(name, columns.uuid()),
    blob: (name) => named(name, columns.column('blob')),
    vector: (name, dimensions) =>
      named(name, dimensions === undefined ? columns.column('vector') : columns.vector(dimensions)),
  };
}
