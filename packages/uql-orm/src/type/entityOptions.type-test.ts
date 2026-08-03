/**
 * Type-level regression tests for the entity options family.
 *
 * These lock in the payoff of making `type` explicit: it is now checked against the property's real
 * TypeScript type, so a mismatch that used to compile into a wrong column is a compile error. Every
 * `@ts-expect-error` fails the type-check if the error it guards stops happening.
 *
 * Not a runtime test: type-checked by `bun run ts`, skipped by vitest, and excluded from the build by
 * the `-test.ts` suffix.
 */
import { defineEntity } from '../entity/index.js';
import type {
  FieldOptionsFor,
  Json,
  MethodKey,
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
// A foreign key may omit `type` so schema generation resolves it from the referenced primary key.
expectType<FieldOptionsFor<string>>({ references: () => Company });
expectType<FieldOptionsFor<string>>({ references: () => Company, type: 'uuid' });

// @ts-expect-error `type` is required when there is no `references` to resolve it from
expectType<FieldOptionsFor<string>>({ length: 150 });
// @ts-expect-error the declared type is checked even alongside other options
expectType<FieldOptionsFor<string>>({ type: Number, length: 150 });
// @ts-expect-error and it is checked on the `references` arm too
expectType<FieldOptionsFor<string>>({ references: () => Company, type: 'int' });

// ─── RelationOptionsFor: `entity` required and pinned, cardinality follows the field shape ───
expectType<RelationTarget<Company>>(new Company());
expectType<RelationTarget<Company[]>>(new Company());

expectType<RelationOptionsFor<Company>>({ entity: () => Company, cardinality: 'm1' });
expectType<RelationOptionsFor<Company>>({ entity: () => Company, cardinality: '11' });
expectType<RelationOptionsFor<Company[]>>({ entity: () => Company, cardinality: '1m', mappedBy: 'id' });
expectType<RelationOptionsFor<Company[]>>({ entity: () => Company, cardinality: 'mm' });

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
