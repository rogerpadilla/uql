import type { ForeignKeyAction } from '../schema/types.js';
import {
  COLUMN_OPTIONS,
  type ColumnType,
  type FieldOptions,
  type OnFieldCallback,
  type QuerySql,
  type StampEvent,
  type StandardSchemaV1,
  type Type,
  type VectorDistance,
} from '../type/index.js';

/**
 * Every family's builder at run time: the types offer each family only its own methods. Immutable, so a shared
 * `const money = f.decimal(12, 2)` is reused safely, and its options are the plain ones the registry reads.
 */
export class ColumnOptionsBuilder {
  readonly [COLUMN_OPTIONS]: FieldOptions;

  constructor(options: FieldOptions) {
    this[COLUMN_OPTIONS] = options;
  }

  with(options: FieldOptions): ColumnOptionsBuilder {
    return new ColumnOptionsBuilder({ ...this[COLUMN_OPTIONS], ...options });
  }

  nullable(): ColumnOptionsBuilder {
    return this.with({ nullable: true });
  }

  id(): ColumnOptionsBuilder {
    return this.with({ isId: true });
  }

  default(defaultValue: FieldOptions['defaultValue']): ColumnOptionsBuilder {
    return this.with({ defaultValue });
  }

  onInsert(onInsert: OnFieldCallback): ColumnOptionsBuilder {
    return this.with({ onInsert });
  }

  onUpdate(onUpdate: OnFieldCallback): ColumnOptionsBuilder {
    return this.with({ onUpdate });
  }

  updatable(updatable: false): ColumnOptionsBuilder {
    return this.with({ updatable });
  }

  softDelete(softDelete?: OnFieldCallback): ColumnOptionsBuilder {
    return this.with({ softDelete: softDelete ?? true });
  }

  unique(): ColumnOptionsBuilder {
    return this.with({ unique: true });
  }

  index(index?: string | false): ColumnOptionsBuilder {
    return this.with({ index: index ?? true });
  }

  name(name: string): ColumnOptionsBuilder {
    return this.with({ name });
  }

  comment(comment: string): ColumnOptionsBuilder {
    return this.with({ comment });
  }

  eager(eager: false): ColumnOptionsBuilder {
    return this.with({ eager });
  }

  columnType(columnType: ColumnType): ColumnOptionsBuilder;
  columnType(columnType: QuerySql): ColumnOptionsBuilder;
  columnType(columnType: ColumnType | QuerySql): ColumnOptionsBuilder {
    return this.with({ columnType });
  }

  references(references: () => Type<object>): ColumnOptionsBuilder {
    return this.with({ references });
  }

  onDelete(onDelete: ForeignKeyAction): ColumnOptionsBuilder {
    return this.with({ onDelete });
  }

  narrow(): ColumnOptionsBuilder {
    return this;
  }

  as(computed: QuerySql): ColumnOptionsBuilder {
    return this.with({ computed });
  }

  stored(events?: readonly StampEvent[]): ColumnOptionsBuilder {
    return this.with({ stored: events ?? true });
  }

  precision(precision: number): ColumnOptionsBuilder {
    return this.with({ precision });
  }

  scale(scale: number): ColumnOptionsBuilder {
    return this.with({ scale });
  }

  autoIncrement(autoIncrement = true): ColumnOptionsBuilder {
    return this.with({ autoIncrement });
  }

  length(length: number): ColumnOptionsBuilder {
    return this.with({ length });
  }

  dimensions(dimensions: number): ColumnOptionsBuilder {
    return this.with({ dimensions });
  }

  distance(distance: VectorDistance): ColumnOptionsBuilder {
    return this.with({ distance });
  }
}

const column = (options: FieldOptions) => new ColumnOptionsBuilder(options);

const jsonColumn = (type: 'json' | 'jsonb') => (schema?: StandardSchemaV1) =>
  column({ type, ...(schema && { schema }) });

/** The column constructors at run time, which `f` types and the migration builder names. */
export const columns = {
  string: () => column({ type: String }),
  text: () => column({ type: 'text' }),
  uuid: () => column({ type: 'uuid' }),
  number: () => column({ type: Number }),
  bigint: () => column({ type: BigInt }),
  decimal: (precision?: number, scale?: number) =>
    column({ type: 'decimal', ...(precision !== undefined && { precision }), ...(scale !== undefined && { scale }) }),
  boolean: () => column({ type: Boolean }),
  date: () => column({ type: Date }),
  json: jsonColumn('json'),
  jsonb: jsonColumn('jsonb'),
  vector: (dimensions: number) => column({ type: 'vector', dimensions }),
  enum: (members: readonly string[] | readonly number[]) =>
    column({ type: typeof members[0] === 'number' ? Number : String, enum: members }),
  version: (type: NumberConstructor | BigIntConstructor = Number) => column({ type, version: true }),
  column: (type: ColumnType) => column({ type }),
  references: (references: () => Type<object>) => column({ references }),
};
