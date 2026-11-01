/**
 * What each column builder offers and refuses. The row a defined entity derives from them is pinned in
 * `definedEntity.test-d.ts`, the property a decorator checks against them in `entityDecorator.test-d.ts`.
 * Type-checked by `bun run ts` only.
 */
import { expectTypeOf } from 'vitest';
import { type ColumnOptionsOf, type ColumnValueOf, type Json, sql } from '../index.js';
import type { ColumnType, StandardSchemaV1 } from '../type/index.js';
import { f } from './column.js';

declare const settingsSchema: StandardSchemaV1<unknown, { theme: string; tags?: string[] }>;
declare const dataColumnType: ColumnType;
declare const eitherFamilyType: 'int' | 'varchar';
declare const oneFamilyType: 'int' | 'smallint';
declare const schemaWithoutTypes: StandardSchemaV1 & { readonly '~standard': { readonly types: undefined } };

export function values() {
  expectTypeOf<ColumnValueOf<ReturnType<typeof f.string>>>().toEqualTypeOf<string>();
  expectTypeOf<ColumnValueOf<ReturnType<typeof f.number>>>().toEqualTypeOf<number>();
  expectTypeOf<ColumnValueOf<ReturnType<typeof f.decimal>>>().toEqualTypeOf<string>();
  expectTypeOf<ColumnValueOf<ReturnType<typeof f.date>>>().toEqualTypeOf<Date>();
  const status = f.enum(['draft', 'published']).default('draft');
  expectTypeOf<ColumnValueOf<typeof status>>().toEqualTypeOf<'draft' | 'published'>();
  const settings = f.json(settingsSchema);
  expectTypeOf<ColumnValueOf<typeof settings>>().toMatchTypeOf<{ theme: string; tags?: string[] }>();
  const document = f.json();
  expectTypeOf<ColumnValueOf<typeof document>>().toEqualTypeOf<Json>();
  const untyped = f.json(schemaWithoutTypes);
  expectTypeOf<ColumnValueOf<typeof untyped>>().toEqualTypeOf<Json>();
  const time = f.column('time');
  expectTypeOf<ColumnValueOf<typeof time>>().toEqualTypeOf<string>();
  const stamp = f.column('timestamptz');
  expectTypeOf<ColumnValueOf<typeof stamp>>().toEqualTypeOf<Date>();
  const count = f.column('int');
  expectTypeOf<ColumnValueOf<typeof count>>().toEqualTypeOf<number | bigint>();
  const bytes = f.column('bytea');
  expectTypeOf<ColumnValueOf<typeof bytes>>().toEqualTypeOf<Uint8Array>();
  const fromData = f.column(dataColumnType);
  expectTypeOf<ColumnValueOf<typeof fromData>>().toEqualTypeOf<unknown>();
  const eitherFamily = f.column(eitherFamilyType).nullable();
  expectTypeOf<ColumnValueOf<typeof eitherFamily>>().toEqualTypeOf<unknown>();
  const oneFamily = f.column(oneFamilyType).precision(10);
  expectTypeOf<ColumnValueOf<typeof oneFamily>>().toEqualTypeOf<number | bigint>();
  const lock = f.version();
  expectTypeOf<ColumnValueOf<typeof lock>>().toEqualTypeOf<number>();
  const wide = f.version(BigInt);
  expectTypeOf<ColumnValueOf<typeof wide>>().toEqualTypeOf<bigint>();
  const decimal = f.column('decimal');
  expectTypeOf<ColumnValueOf<typeof decimal>>().toEqualTypeOf<string>();
}

export function options() {
  const name = f.string().nullable().default('x');
  expectTypeOf<ColumnOptionsOf<typeof name>>().toMatchTypeOf<{
    readonly nullable: true;
    readonly defaultValue: unknown;
  }>();
}

export function familiesOfferTheirOwn() {
  f.string().length(80);
  f.number().precision(12).scale(2);
  f.date().precision(3);
  f.vector(1536).distance('cosine');
  f.column('timestamptz').precision(6);
  // @ts-expect-error a length means nothing on a number
  f.number().length(10);
  // @ts-expect-error nor a scale on a string
  f.string().scale(2);
  // @ts-expect-error nor a metric on a JSON column
  f.json().distance('l2');
  // @ts-expect-error a version is its own builder, never a number's
  f.number().version();
}

export function refusesWhatAnotherLeavesUnread() {
  // @ts-expect-error a key holds no null
  f.number().id().nullable();
  // @ts-expect-error in either order
  f.number().nullable().id();
  // @ts-expect-error a column left out of updates is never written on one
  f.date()
    .updatable(false)
    .onUpdate(() => new Date());
  // @ts-expect-error in either order
  f.date()
    .onUpdate(() => new Date())
    .updatable(false);
  // @ts-expect-error a computed column takes no value from a write
  f.string()
    .default('x')
    .as(sql`upper(name)`);
  // @ts-expect-error a type written out as SQL carries its own bounds
  f.string()
    .columnType(sql`citext`)
    .length(10);
  // @ts-expect-error in either order
  f.string()
    .length(10)
    .columnType(sql`citext`);
  // @ts-expect-error a version takes no default: it starts at 0
  f.version().default(1);
  // @ts-expect-error a delete action needs a foreign key
  f.number().onDelete('CASCADE');
  // @ts-expect-error a default is a value of the column's
  f.number().default('zero');
  // @ts-expect-error or one of its enum's members
  f.enum(['draft', 'published']).default('archived');
}

export function boundsAreTakenInEitherOrderWhileTheTypeIsAName() {
  f.string().length(2).columnType('char');
  f.string().columnType('char').length(2);
  f.number().columnType('int').precision(10);
  f.date().columnType('timestamp').precision(3);
  f.vector(3).columnType('vector').dimensions(3);
}

export function decimalsStateTheirDigitsForTheType() {
  // @ts-expect-error a decimal whose digits are stated is a decimal, not a SQL type of its own
  f.decimal(12, 2).columnType(sql`money`);
  // @ts-expect-error a decimal with a precision alone takes it, so a SQL type cannot follow
  f.decimal(12).columnType(sql`money`);
  f.decimal().columnType(sql`money`);
}

export function computedColumnsOnlyStore() {
  f.string()
    .as(sql`upper(name)`)
    .stored();
  f.date()
    .as(sql`now()`)
    .stored(['insert', 'update']);
  f.string()
    .as(sql`upper(name)`)
    // @ts-expect-error nothing writes a computed column
    .default('x');
}
