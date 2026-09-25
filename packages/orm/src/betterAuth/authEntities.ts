import type { BetterAuthOptions } from 'better-auth';
import { type DBFieldAttribute, getAuthTables } from 'better-auth/db';
import { defineEntity, defineField, defineId, defineIndex, defineRelation } from '../entity/index.js';
import type { ForeignKeyAction } from '../schema/types.js';
import type { FieldOptions, FieldType, Json, Scalar, Type } from '../type/index.js';
import { UqlUsageError } from '../util/uqlError.js';

/**
 * The entities Better Auth's tables are for these options, its core tables and every plugin's: list them
 * in `uql.config.ts` so `uql-migrate` creates and migrates them with the rest.
 */
export function authEntities(options: BetterAuthOptions): Type<object>[] {
  const shapes = shapesOf(options);
  // A field type that is a constructor keyed by its name, which JSON would drop.
  const key = JSON.stringify(shapes, (_, value: unknown) => (typeof value === 'function' ? value.name : value));
  let entities = defined.get(key);
  if (!entities) {
    entities = defineTables(shapes);
    defined.set(key, entities);
  }
  return [...entities];
}

/**
 * Each set of tables defined so far, by its shapes: kept, since an adapter built on it may still be
 * reading, and a table defined twice for one shape would be two entities over one table.
 */
const defined = new Map<string, readonly Type<object>[]>();

/** A table as the options UQL defines it with, so two option sets making the same tables make equal shapes. */
type TableShape = {
  readonly name: string;
  readonly id: KeyOptions;
  readonly fields: readonly {
    readonly name: string;
    readonly options: FieldOptions;
    readonly references: Reference | undefined;
  }[];
  readonly indexes: readonly {
    readonly columns: readonly string[];
    readonly unique?: boolean;
    readonly name?: string;
  }[];
};

type KeyOptions = { readonly type: FieldType; readonly autoIncrement?: true };

type Reference = { readonly table: string; readonly column: string; readonly onDelete: ForeignKeyAction };

/** A row of a Better Auth table, whose fields are names its schema hands over at run time. */
type AuthRow = { [field: string]: Scalar | readonly Scalar[] | Json | null };

/** Defines every table at once, since each one's foreign keys point at the others. */
function defineTables(shapes: readonly TableShape[]): readonly Type<object>[] {
  const byName: Record<string, Type<AuthRow>> = Object.fromEntries(
    shapes.map(({ name }) => [
      name,
      {
        [name]: class {
          [field: string]: AuthRow[string];
        },
      }[name],
    ]),
  );
  for (const { name, id, fields, indexes } of shapes) {
    const entity = byName[name];
    defineId(entity, 'id', id);
    for (const field of fields) {
      defineField(entity, field.name, field.options);
      const { references } = field;
      if (references) {
        defineRelation<AuthRow, AuthRow>(entity, `${field.name}Ref`, {
          entity: () => byName[references.table],
          cardinality: 'm1',
          references: (local, foreign) => [{ local: local[field.name], foreign: foreign[references.column] }],
          onDelete: references.onDelete,
        });
      }
    }
    for (const index of indexes) {
      defineIndex(entity, { ...index, columns: (refs) => index.columns.map((column) => refs[column]) });
    }
    defineEntity(entity, { name });
  }
  return Object.values(byName);
}

/** Better Auth's schema as the tables UQL defines, every reference resolved to the column it points at. */
function shapesOf(options: BetterAuthOptions): TableShape[] {
  const schema = getAuthTables(options);
  const id = keyOf(options);
  const columnOf = (fields: Record<string, DBFieldAttribute>, key: string) => fields[key]?.fieldName ?? key;
  // Refused rather than left for the schema build, which drops a foreign key whose column it cannot find.
  const referenceOf = ({ model, field, onDelete = 'cascade' }: NonNullable<DBFieldAttribute['references']>) => {
    const table = schema[model] ?? Object.values(schema).find(({ modelName }) => modelName === model);
    const column = table?.fields[field];
    if (!table || (field !== 'id' && !column)) {
      throw new UqlUsageError(`a Better Auth field references '${model}.${field}', which its schema does not have`);
    }
    return {
      // Every foreign key is indexed, so it takes the type an indexed copy of the column it points at would.
      type: column ? typeOf({ ...column, index: true }) : id.type,
      references: {
        table: table.modelName,
        column: column ? columnOf(table.fields, field) : 'id',
        onDelete: ON_DELETE[onDelete],
      },
    };
  };
  return Object.values(schema).map((table) => ({
    name: table.modelName,
    id,
    fields: Object.entries(table.fields).map(([key, field]) => {
      const name = columnOf(table.fields, key);
      const reference = field.references && referenceOf(field.references);
      return {
        name,
        options: {
          name,
          type: reference?.type ?? typeOf(field),
          nullable: field.required === false,
          unique: field.unique,
          index: field.index,
          defaultValue: staticDefault(field),
        },
        references: reference?.references,
      };
    }),
    indexes: (table.indexes ?? []).map(({ fields, unique, name }) => ({
      columns: fields.map((key) => columnOf(table.fields, key)),
      unique,
      name,
    })),
  }));
}

/** The key: Better Auth's own string, its UUID, or the database's number; a key left to the database otherwise is refused. */
function keyOf(options: BetterAuthOptions): KeyOptions {
  const generateId = options.advanced?.database?.generateId;
  if (generateId === false) {
    throw new UqlUsageError(
      "Better Auth's 'generateId: false' leaves the key to the database, which it can generate in more than one " +
        "way: set 'serial' for a number or 'uuid' for a UUID",
    );
  }
  if (generateId === 'serial') {
    return { type: Number, autoIncrement: true };
  }
  return { type: generateId === 'uuid' ? 'uuid' : String };
}

/**
 * A field's column type. Text is `text` unless something indexes it, which a column of unbounded length
 * cannot be on MySQL; a list of allowed values is text too, since Better Auth checks them itself and a
 * database check on them would need a migration each time one is added.
 */
function typeOf(field: DBFieldAttribute): FieldType {
  const { type } = field;
  if (type === 'string' || Array.isArray(type)) {
    return field.unique || field.index || field.sortable ? String : 'text';
  }
  switch (type) {
    case 'number':
      return field.bigint ? BigInt : Number;
    case 'boolean':
      return Boolean;
    case 'date':
      return Date;
    case 'json':
    case 'string[]':
    case 'number[]':
      return 'json';
  }
}

/**
 * The default a column takes in the database, as Better Auth's own migrator gives one: a plain value on a
 * text, number or boolean field, so a required column added to a populated table has one to backfill. A
 * nullable unique column gets none, `NULL` being its only backfill two rows can share.
 */
function staticDefault({ type, defaultValue, unique, required }: DBFieldAttribute) {
  const plain =
    typeof defaultValue === 'string' || typeof defaultValue === 'number' || typeof defaultValue === 'boolean';
  const typed = type === 'string' || type === 'number' || type === 'boolean';
  return plain && typed && !(unique && required === false) ? defaultValue : undefined;
}

const ON_DELETE = {
  cascade: 'CASCADE',
  'no action': 'NO ACTION',
  restrict: 'RESTRICT',
  'set null': 'SET NULL',
  'set default': 'SET DEFAULT',
} as const satisfies Record<NonNullable<NonNullable<DBFieldAttribute['references']>['onDelete']>, ForeignKeyAction>;
