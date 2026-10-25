/**
 * The entity options family: a declared `type` is checked against the property's TypeScript type, so a
 * mismatch is a compile error rather than a wrong column. Type-checked by `bun run ts` only.
 */
import { Entity, f, Field, ManyToMany, ManyToOne, OneToMany, OneToOne } from '../entity/index.js';
import type { FieldKey, Json, MethodKey, RelationKey } from '../type/index.js';
import { sql } from '../util/index.js';

declare function expectType<T>(value: T): void;

class Company {
  @Field(f.number().id()) id?: number;
}

// ─── @Field({ type }): the constructor and the column-string spelling are both checked ───
export class Typed {
  @Field(f.number().id()) id?: number;
  @Field(f.column('varchar').nullable()) name?: string | null;
  @Field(f.column('int').nullable()) count?: number | null;
  @Field(f.column('timestamptz').nullable()) at?: Date | null;
  // A time of day names no day, so it reads as the text every driver returns rather than a `Date`.
  @Field(f.column('time').nullable()) opensAt?: string | null;
  // @ts-expect-error a time column holds no `Date`
  @Field(f.column('time').nullable()) closesAt?: Date | null;
  // A decimal is exact text: `Number` over one opts in to rounding.
  @Field(f.decimal().nullable()) price?: string | null;
  @Field(f.number().nullable().columnType('decimal')) rounded?: number | null;
  // A string-literal union (the shape every `as const` enum takes) is still a string column.
  @Field(f.string().nullable()) role?: 'admin' | 'member' | null;
  @Field(f.jsonb().nullable()) settings?: Json<{ a: number }> | null;
  @Field(f.vector(3).nullable()) embedding?: number[] | null;
  @Field(f.column('bytea').nullable()) avatar?: Uint8Array | null;
  // @ts-expect-error a string field cannot be a numeric column
  @Field(f.number().nullable()) label?: string | null;
  // @ts-expect-error a number field cannot be a string column
  @Field(f.text().nullable()) total?: number | null;
  // @ts-expect-error a JSON field is not a text column
  @Field(f.text().nullable()) meta?: Json<{ a: number }> | null;
  // @ts-expect-error a vector field is not a plain number column
  @Field(f.number().nullable()) vector?: number[] | null;
}

// ─── @Field({ references }): a foreign key holds the referenced key's own type ───
// An explicit `type` opts out of resolving the column from that key, so it may widen it, a BIGINT column over
// a numeric key, but not hold another kind of value, which no join could match.
export class Referrer {
  @Field(f.number().id()) id?: number;
  @Field(f.references(() => Company).nullable()) companyId?: number | null;
  @Field(
    f
      .bigint()
      .nullable()
      .references(() => Company),
  )
  wideCompanyId?: bigint | null;
  // @ts-expect-error a string property cannot hold Company's numeric key
  @Field(f.references(() => Company).nullable()) misTypedId?: string | null;
  @Field(
    f
      .string()
      .nullable()
      // @ts-expect-error a text column cannot hold Company's numeric key
      .references(() => Company),
  )
  textCompanyId?: string | null;
}
// ─── Generators stamp the value the field declares ───
// `defaultValue` does too, with one exception: a JSONB column defaults with a document, a list included,
// or the SQL literal it stores, unchecked against the field: the decorator types every JSON column alike.
class Generated {
  @Field(
    f
      .uuid()
      .id()
      .onInsert(() => crypto.randomUUID()),
  )
  id?: string;
  @Field(
    f
      .number()
      .nullable()
      .onInsert(() => Date.now())
      .onUpdate(() => Date.now()),
  )
  stamped?: number | null;
  @Field(f.date().nullable().softDelete()) deletedAt?: Date | null;
  @Field(
    f
      .number()
      .nullable()
      .softDelete(() => Date.now()),
  )
  deletedEpoch?: number | null;
  @Field(f.jsonb().nullable().default('{}')) settings?: Json<{ theme?: string }> | null;
  @Field(f.jsonb().nullable().default({ theme: 'dark' })) theme?: Json<{ theme?: string }> | null;
  @Field(f.jsonb().nullable().default([])) tags?: Json<string[]> | null;
  @Field(
    f
      .jsonb()
      .nullable()
      .default([{ at: 1 }]),
  )
  events?: Json<{ at: number }>[] | null;

  @Field(
    f
      .uuid()
      .nullable()
      // @ts-expect-error a uuid column is not stamped with a number
      .onInsert(() => 42),
  )
  badGenerator?: string | null;
}
expectType<string | undefined>(new Generated().id);

// ─── FieldKey / RelationKey: an array of Json is a column, an array of entities is a relation ───
// The two are told apart by the weak-type check: `JsonBrand` is all-optional, so an entity class
// with named properties is not assignable to it. Get this wrong and every to-many silently becomes a
// column, so both directions are pinned here.
class WithJsonArray {
  id?: number;
  items?: Json<{ a: string }>[] | null;
  employees?: Employee[];
}
expectType<FieldKey<WithJsonArray>>('items');
expectType<RelationKey<WithJsonArray>>('employees');
// @ts-expect-error an array of entities stays a relation, not a column
expectType<FieldKey<WithJsonArray>>('employees');
// @ts-expect-error an array of Json is a column, so it is not a relation
expectType<RelationKey<WithJsonArray>>('items');

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

// ─── Relation options: each decorator takes the options its side can use ───
class Employee {
  @Field(f.number().id()) id?: number;
  @Field(f.references(() => Company).nullable()) companyId?: number | null;
  @ManyToOne({ entity: () => Company, references: (employee) => employee.companyId }) company?: Company;
}

class EmployeeProject {
  @Field(f.number().id()) id?: number;
  @Field(f.references(() => Employee).nullable()) employeeId?: number | null;
  @Field(f.references(() => Company).nullable()) companyId?: number | null;
}

export class Staffed {
  @Field(f.number().id()) id?: number;
  @OneToMany({ entity: () => Employee, mappedBy: (employee) => employee.company }) staff?: Employee[];
  // A pivot is its own entity, unrelated to the target's shape.
  @ManyToMany({ entity: () => Employee, through: () => EmployeeProject }) contractors?: Employee[];
  // @ts-expect-error a misspelled key is not a member of the target
  @OneToMany({ entity: () => Employee, mappedBy: (employee) => employee.compnayId }) misspelled?: Employee[];
  // @ts-expect-error a string names a key a rename cannot follow; only the callback form exists
  @OneToMany({ entity: () => Employee, mappedBy: 'companyId' }) named?: Employee[];
  // @ts-expect-error a to-many needs to say how to reach its children
  @ManyToMany({ entity: () => Employee }) unjoined?: Employee[];
  // @ts-expect-error an inverse side holds no foreign key for an action to apply to
  @OneToMany({ entity: () => Employee, mappedBy: (employee) => employee.company, onDelete: 'CASCADE' })
  acted?: Employee[];
  // @ts-expect-error a to-one joins through no junction
  @OneToOne({ entity: () => Company, through: () => EmployeeProject }) pivoted?: Company;
}

// ─── @Entity: its options read the decorated class ───
@Entity({
  indexes: (account, index) => [
    index([account.email], { unique: true }),
    index([{ column: account.createdAt, order: 'desc' }, sql`lower(${account.email})`], { include: [account.id] }),
  ],
  checks: (account, check) => [check({ email: { $ne: '' } }), check(sql`${account.createdAt} IS NOT NULL`)],
})
export class Account {
  @Field(f.number().id()) id?: number;
  @Field(f.string().nullable()) email?: string | null;
  @Field(f.column('timestamptz').nullable()) createdAt?: Date | null;
}

// @ts-expect-error a check reads the entity's own fields
@Entity({ checks: (unchecked, check) => [check({ emial: { $ne: '' } })] })
export class Unchecked {
  @Field(f.number().id()) id?: number;
  @Field(f.string().nullable()) email?: string | null;
}

/**
 * The options around each member list are a literal of their own, not a callback's return, because only
 * a literal is checked for excess properties: `uniqe` below would otherwise compile, and the index not be unique.
 */
// @ts-expect-error an index option the entity index does not have
@Entity({ indexes: (misindexed, index) => [index([misindexed.email], { uniqe: true })] })
export class Misindexed {
  @Field(f.number().id()) id?: number;
  @Field(f.string().nullable()) email?: string | null;
}

// @ts-expect-error no such column to index
@Entity({ indexes: (unindexed, index) => [index([unindexed.emial])] })
export class Unindexed {
  @Field(f.number().id()) id?: number;
  @Field(f.string().nullable()) email?: string | null;
}

/** A base that is never a table: the entities extending it take the columns its index names. */
@Entity({ abstract: true, indexes: (stampedBase, index) => [index([stampedBase.at])] })
export abstract class StampedBase {
  @Field(f.date().nullable()) at?: Date | null;
}

/** A key's values are checked against its type as a field's are. */
export class EnumKeyed {
  // @ts-expect-error a String key cannot hold a numeric member
  @Field(f.enum(['a', 2]).id()) id?: 'a' | 2;
}
