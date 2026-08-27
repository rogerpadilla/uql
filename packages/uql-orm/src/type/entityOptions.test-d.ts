/**
 * Type-level regression tests for the entity options family.
 *
 * These lock in the payoff of making `type` explicit: it is now checked against the property's real
 * TypeScript type, so a mismatch that used to compile into a wrong column is a compile error. Every
 * `@ts-expect-error` fails the type-check if the error it guards stops happening.
 *
 * Not a runtime test: type-checked by `bun run ts`, skipped by vitest, and excluded from the build by
 * the `.test-d.ts` suffix, Vitest's and `tsd`'s own convention for type-only tests.
 */
import { defineEntity, Field, Id } from '../entity/index.js';
import type {
  FieldKey,
  FieldOptionsFor,
  Json,
  MethodKey,
  RelationKey,
  RelationOptionsFor,
  RelationTarget,
  TsTypeOf,
  TypeFor,
} from '../type/index.js';

declare function expectType<T>(value: T): void;

class Company {
  id?: number;
}

// ─── TypeFor: the constructor and the column-string spelling are both accepted ───
expectType<TypeFor<string>>(String);
expectType<TypeFor<string>>('varchar');
expectType<TypeFor<string | null>>('uuid');
expectType<TypeFor<number>>(Number);
expectType<TypeFor<number>>('int');
expectType<TypeFor<bigint>>(BigInt);
expectType<TypeFor<boolean>>(Boolean);
expectType<TypeFor<boolean>>('bool');
expectType<TypeFor<Date>>(Date);
expectType<TypeFor<Date>>('timestamptz');
expectType<TypeFor<Uint8Array>>('bytea');

// A string-literal union (the shape every `as const` enum takes) is still a string column.
type Role = 'admin' | 'member';
expectType<TypeFor<Role>>(String);
expectType<TypeFor<Role>>('text');

// JSON is matched on the brand, so it survives intersecting its payload, and arrays of it too.
expectType<TypeFor<Json<{ a: number }>>>('jsonb');
expectType<TypeFor<Json<string[]>>>('jsonb');
expectType<TypeFor<Json<{ a: number }>[]>>('json');

// `number[]` is a vector, not a number.
expectType<TypeFor<number[]>>('vector');
expectType<TypeFor<number[]>>('halfvec');

// An untyped field stays permissive rather than becoming unusable.
expectType<TypeFor<unknown>>(String);
expectType<TypeFor<unknown>>('jsonb');

// @ts-expect-error a string field cannot be a numeric column
expectType<TypeFor<string>>(Number);
// @ts-expect-error a number field cannot be a string column
expectType<TypeFor<number>>('text');
// @ts-expect-error a Date field cannot be an integer column
expectType<TypeFor<Date>>('int');
// @ts-expect-error a boolean field cannot be a Date
expectType<TypeFor<boolean>>(Date);
// @ts-expect-error a vector field is not a plain number column
expectType<TypeFor<number[]>>(Number);
// @ts-expect-error a JSON field is not a text column
expectType<TypeFor<Json<{ a: number }>>>('text');

// ─── FieldOptionsFor: `type` required, except behind `references` ───
expectType<FieldOptionsFor<string>>({ type: String });
expectType<FieldOptionsFor<string>>({ type: 'varchar', length: 150 });
expectType<FieldOptionsFor<number>>({ type: Number, isId: true });
// A foreign key may omit `type` so schema generation resolves it from the referenced primary key. Unlike
// `@Field`, this arm cannot also check the property against that key: `FieldOptionsFor<V>` is reached
// through a mapped type, which gives the target no inference position to be read from.
expectType<FieldOptionsFor<string>>({ references: () => Company });
expectType<FieldOptionsFor<string>>({ references: () => Company, type: 'uuid' });

// @ts-expect-error `type` is required when there is no `references` to resolve it from
expectType<FieldOptionsFor<string>>({ length: 150 });
// @ts-expect-error the declared type is checked even alongside other options
expectType<FieldOptionsFor<string>>({ type: Number, length: 150 });
// @ts-expect-error and it is checked on the `references` arm too
expectType<FieldOptionsFor<string>>({ references: () => Company, type: 'int' });

// ─── @Field({ references }): a foreign key holds the referenced key's own type ───
// Only where the column is resolved from that key. An explicit `type` opts out of the resolution, so
// it is checked on its own - the case `schemaASTBuilder.spec` pins, a BIGINT column over a uuid key.
class Referrer {
  @Id({ type: Number }) id?: number;
  @Field({ references: () => Company }) companyId?: number;
  @Field({ type: BigInt, references: () => Company }) wideCompanyId?: bigint;
  // @ts-expect-error a string property cannot hold Company's numeric key
  @Field({ references: () => Company }) misTypedId?: string;
}
// ─── Generators stamp the value the field declares ───
// `defaultValue` is deliberately not among them: it is the DDL literal, so a JSONB column defaults
// with the string it stores. Requiring the field's own type there broke every such column in 0.24.3.
class Generated {
  @Id({ type: 'uuid', onInsert: () => crypto.randomUUID() }) id?: string;
  @Field({ type: Number, onInsert: () => Date.now(), onUpdate: () => Date.now() }) stamped?: number;
  @Field({ type: Date, softDelete: true }) deletedAt?: Date;
  @Field({ type: Number, softDelete: () => Date.now() }) deletedEpoch?: number;
  @Field({ type: 'jsonb', defaultValue: '{}' }) settings?: Json<{ theme?: string }>;

  // @ts-expect-error a uuid column is not stamped with a number
  @Field({ type: 'uuid', onInsert: () => 42 }) badGenerator?: string;
}
expectType<string | undefined>(new Generated().id);

// The same check on the imperative path, which `FieldOptions<V>` carries into `FieldOptionsFor<V>`.
expectType<FieldOptionsFor<number>>({ type: Number, onInsert: () => Date.now() });
expectType<FieldOptionsFor<Json<{ theme?: string }>>>({ type: 'jsonb', defaultValue: '{}' });
// @ts-expect-error a number column is not stamped with a string
expectType<FieldOptionsFor<number>>({ type: Number, onInsert: () => 'nope' });

// ─── RelationOptionsFor: `entity` required and pinned, cardinality follows the field shape ───
expectType<RelationTarget<Company>>(new Company());
expectType<RelationTarget<Company[]>>(new Company());

expectType<RelationOptionsFor<Company>>({ entity: () => Company, cardinality: 'm1' });
expectType<RelationOptionsFor<Company>>({ entity: () => Company, cardinality: '11' });
expectType<RelationOptionsFor<Company[]>>({ entity: () => Company, cardinality: '1m', mappedBy: 'id' });
// @ts-expect-error a to-many needs to say how to reach its children
expectType<RelationOptionsFor<Company[]>>({ entity: () => Company, cardinality: 'mm' });
expectType<RelationOptionsFor<Company[]>>({
  entity: () => Company,
  cardinality: 'mm',
  references: [{ local: 'companyId', foreign: 'id' }],
});

// @ts-expect-error a to-many cardinality needs an array field
expectType<RelationOptionsFor<Company>>({ entity: () => Company, cardinality: '1m' });
// @ts-expect-error a to-one cardinality cannot hold an array field
expectType<RelationOptionsFor<Company[]>>({ entity: () => Company, cardinality: 'm1' });
// @ts-expect-error `entity` is required
expectType<RelationOptionsFor<Company>>({ cardinality: 'm1' });

// ─── mappedBy: the key map holds every key, with no optionality to assert away ───
class Employee {
  id?: number;
  companyId?: number;
  company?: Company;
}
expectType<RelationOptionsFor<Employee[]>>({
  entity: () => Employee,
  cardinality: '1m',
  mappedBy: (employee) => employee.companyId,
});
expectType<RelationOptionsFor<Employee[]>>({
  entity: () => Employee,
  cardinality: '1m',
  mappedBy: (employee) => employee.company,
});
expectType<RelationOptionsFor<Employee[]>>({ entity: () => Employee, cardinality: '1m', mappedBy: 'companyId' });

expectType<RelationOptionsFor<Employee[]>>({
  entity: () => Employee,
  cardinality: '1m',
  // @ts-expect-error a misspelled key is not on the key map
  mappedBy: (employee) => employee.compnayId,
});
// @ts-expect-error nor can the callback conjure a key name from nothing
expectType<RelationOptionsFor<Employee[]>>({ entity: () => Employee, cardinality: '1m', mappedBy: () => 'nope' });
// @ts-expect-error and the string form is checked the same way
expectType<RelationOptionsFor<Employee[]>>({ entity: () => Employee, cardinality: '1m', mappedBy: 'compnayId' });

// ─── through: a pivot is its own entity, unrelated to the target's shape ───
class EmployeeProject {
  id?: number;
  employeeId?: number;
  projectId?: number;
}
// `Company` declares no relation of its own, which used to collapse `through` to `never`.
expectType<RelationOptionsFor<Company[]>>({
  entity: () => Company,
  cardinality: 'mm',
  through: () => EmployeeProject,
});

// ─── FieldKey / RelationKey: an array of Json is a column, an array of entities is a relation ───
// The two are told apart by the weak-type check: `Json<unknown>` is all-optional, so an entity class
// with named properties is not assignable to it. Get this wrong and every to-many silently becomes a
// column, so both directions are pinned here.
class WithJsonArray {
  id?: number;
  items?: Json<{ a: string }>[];
  employees?: Employee[];
}
expectType<FieldKey<WithJsonArray>>('items');
expectType<RelationKey<WithJsonArray>>('employees');
// @ts-expect-error an array of entities stays a relation, not a column
expectType<FieldKey<WithJsonArray>>('employees');
// @ts-expect-error an array of Json is a column, so it is not a relation
expectType<RelationKey<WithJsonArray>>('items');

// And it is declarable as one, with the `json` column type `TypeFor` already allows for the shape.
defineEntity(WithJsonArray, {
  fields: { id: { type: Number, isId: true }, items: { type: 'jsonb' } },
  relations: { employees: { cardinality: '1m', entity: () => Employee, mappedBy: 'companyId' } },
});

// ─── MethodKey ───
class WithMethods {
  id?: number;
  name?: string;
  touch() {}
  async reload(): Promise<void> {}
}
expectType<MethodKey<WithMethods>>('touch');
expectType<MethodKey<WithMethods>>('reload');
// @ts-expect-error a data property is not a method
expectType<MethodKey<WithMethods>>('name');

// ─── EntityOptions: the checks survive being reached through `defineEntity` ───
class Account {
  id?: number;
  email?: string;
  createdAt?: Date;
  owner?: Company;
  touch() {}
}

defineEntity(Account, {
  fields: { id: { type: Number, isId: true }, email: { type: String }, createdAt: { type: 'timestamptz' } },
  relations: { owner: { cardinality: 'm1', entity: () => Company } },
  hooks: { beforeInsert: ['touch'] },
});

defineEntity(Account, {
  // @ts-expect-error wrong `type` for a string field
  fields: { id: { type: Number, isId: true }, email: { type: Number } },
});
defineEntity(Account, {
  // @ts-expect-error wrong column type for a Date field
  fields: { id: { type: Number, isId: true }, createdAt: { type: 'int' } },
});
defineEntity(Account, {
  // @ts-expect-error a misspelled field name is not a field of the entity
  fields: { id: { type: Number, isId: true }, emial: { type: String } },
});
defineEntity(Account, {
  fields: { id: { type: Number, isId: true } },
  // @ts-expect-error the hook names a method the entity does not have
  hooks: { beforeInsert: ['nope'] },
});
/**
 * A relation's `entity` is checked structurally, which is as far as TypeScript can go: a class that
 * happens to satisfy the target's shape is accepted, so only a genuinely incompatible one is rejected.
 * `Account` would pass for `Company` here, because it also has an optional numeric `id`.
 */
class Unrelated {
  label?: string;
}
defineEntity(Account, {
  fields: { id: { type: Number, isId: true } },
  // @ts-expect-error a relation cannot point at an entity of an incompatible shape
  relations: { owner: { cardinality: 'm1', entity: () => Unrelated } },
});

// ─── TsTypeOf agrees with TypeFor ───
// The two mappings are written independently (neither is inferable from the other), so these assert
// they stay consistent: whatever TypeScript type a declared `type` implies must accept that `type` back.
expectType<TypeFor<TsTypeOf<StringConstructor>>>(String);
expectType<TypeFor<TsTypeOf<NumberConstructor>>>(Number);
expectType<TypeFor<TsTypeOf<BigIntConstructor>>>(BigInt);
expectType<TypeFor<TsTypeOf<BooleanConstructor>>>(Boolean);
expectType<TypeFor<TsTypeOf<DateConstructor>>>(Date);
expectType<TypeFor<TsTypeOf<'varchar'>>>('varchar');
expectType<TypeFor<TsTypeOf<'uuid'>>>('uuid');
expectType<TypeFor<TsTypeOf<'int'>>>('int');
expectType<TypeFor<TsTypeOf<'bigint'>>>('bigint');
expectType<TypeFor<TsTypeOf<'bool'>>>('bool');
expectType<TypeFor<TsTypeOf<'timestamptz'>>>('timestamptz');
expectType<TypeFor<TsTypeOf<'jsonb'>>>('jsonb');
expectType<TypeFor<TsTypeOf<'bytea'>>>('bytea');
expectType<TypeFor<TsTypeOf<'vector'>>>('vector');
