/**
 * A column constructor's type argument, a brand or a payload: what a row reads, what a filter and a default take, and
 * what a relation asks of a foreign key to a branded key. Type-checked by `bun run ts` only.
 */
import { expectTypeOf } from 'vitest';
import { f } from '../entity/column.js';
import { defineEntity } from '../entity/metadata/definition.js';
import { type ColumnType, type ColumnValueOf, Entity, Field, idKey, type Json, type Querier } from '../index.js';

declare const dataColumnType: ColumnType;

type UserId = `${string}-${string}` & { readonly __tag: 'UserId' };
type UserEmail = string & { readonly __tag: 'UserEmail' };
type UserName = string & { readonly __tag: 'UserName' };

/** A constructor's type argument types a row as a decorated property's own type does: a brand, a template literal, a payload. */
export const BrandedUser = defineEntity({
  name: 'BrandedUser',
  fields: {
    id: f
      .uuid<UserId>()
      .id()
      .onInsert(() => crypto.randomUUID() as UserId),
    email: f.string<UserEmail>().unique(),
    name: f.string<UserName>().nullable(),
    slug: f.string<`/${string}`>(),
    settings: f.jsonb<{ theme: string }>(),
  },
});

export const BrandedPost = defineEntity({
  name: 'BrandedPost',
  fields: { id: f.number().autoIncrement(), authorId: f.uuid<UserId>() },
}).relations((rel) => ({
  author: () => rel.manyToOne(BrandedUser, { references: (post) => post.authorId }),
}));

export async function brandsReachEveryRead(querier: Querier, email: UserEmail, id: UserId) {
  const [user] = await querier.findMany(BrandedUser, {
    $select: { id: true, email: true, name: true, slug: true },
    $where: { email: { $iendsWith: '@uql-orm.dev' } },
  });
  expectTypeOf(user!.id).toEqualTypeOf<UserId>();
  expectTypeOf(user!.email).toEqualTypeOf<UserEmail>();
  expectTypeOf(user!.name).toEqualTypeOf<UserName | null | undefined>();
  expectTypeOf(user!.slug).toEqualTypeOf<`/${string}`>();

  const [post] = await querier.findMany(BrandedPost, {
    $select: { authorId: true },
    $populate: { author: { $select: { email: true } } },
    $where: { authorId: id },
  });
  expectTypeOf(post!.authorId).toEqualTypeOf<UserId>();
  expectTypeOf(post!.author!.email).toEqualTypeOf<UserEmail>();

  await querier.findMany(BrandedUser, { $where: { email } });
  // @ts-expect-error a brand keeps a plain string out
  await querier.findMany(BrandedUser, { $where: { email: 'a@uql-orm.dev' } });
}

type TenantId = number & { readonly __tag: 'TenantId' };
type OrgId = number & { readonly __tag: 'OrgId' };
type Stamp = Date & { readonly __tag: 'Stamp' };

export const BrandedTenant = defineEntity({
  name: 'BrandedTenant',
  fields: { id: f.number<TenantId>().autoIncrement(), at: f.date<Stamp>() },
});

defineEntity({
  name: 'HoldsTenant',
  fields: { id: f.number().autoIncrement(), tenantId: f.number<TenantId>() },
}).relations((rel) => ({ tenant: () => rel.manyToOne(BrandedTenant, { references: (row) => row.tenantId }) }));

/** A key's brand holds across a relation: a plain column would drop it, another brand is another kind of value. */
defineEntity({ name: 'DropsBrand', fields: { id: f.number().autoIncrement(), tenantId: f.number() } })
  // @ts-expect-error the column has to hold the key's brand
  .relations((rel) => ({ tenant: () => rel.manyToOne(BrandedTenant, { references: (row) => row.tenantId }) }));
defineEntity({ name: 'OtherBrand', fields: { id: f.number().autoIncrement(), tenantId: f.number<OrgId>() } })
  // @ts-expect-error another brand is not the key's
  .relations((rel) => ({ tenant: () => rel.manyToOne(BrandedTenant, { references: (row) => row.tenantId }) }));

export async function aBrandedDateFiltersAsAnyBrandDoes(querier: Querier, at: Stamp) {
  await querier.findMany(BrandedTenant, { $where: { at: { $gt: at } } });
  // @ts-expect-error a brand keeps a plain value out
  await querier.findMany(BrandedTenant, { $where: { at: { $gt: new Date() } } });
}

type BigKey = bigint & { readonly __tag: 'BigKey' };

export const PlainKey = defineEntity({ name: 'PlainKey', fields: { id: f.number().autoIncrement() } });
export const BigKeyed = defineEntity({ name: 'BigKeyed', fields: { id: f.bigint().autoIncrement() } });
export const BrandedBigKey = defineEntity({
  name: 'BrandedBigKey',
  fields: { id: f.bigint<BigKey>().autoIncrement() },
});

/** A brand on the column alone loses nothing, and is no other kind of value: a number still joins a bigint. */
defineEntity({
  name: 'NarrowerThanKey',
  fields: { id: f.number().autoIncrement(), keyId: f.number<TenantId>() },
}).relations((rel) => ({
  plain: () => rel.manyToOne(PlainKey, { references: (row) => row.keyId }),
  wide: () => rel.manyToOne(BigKeyed, { references: (row) => row.keyId }),
}));
defineEntity({
  name: 'HoldsBigBrand',
  fields: { id: f.number().autoIncrement(), keyId: f.bigint<BigKey>() },
}).relations((rel) => ({ big: () => rel.manyToOne(BrandedBigKey, { references: (row) => row.keyId }) }));
defineEntity({ name: 'DropsBigBrand', fields: { id: f.number().autoIncrement(), keyId: f.number() } })
  // @ts-expect-error a plain number drops a bigint key's brand too
  .relations((rel) => ({ big: () => rel.manyToOne(BrandedBigKey, { references: (row) => row.keyId }) }));

/** A column whose type is data states no value, so only the run time can check it. */
defineEntity({
  name: 'HoldsData',
  fields: { id: f.number().autoIncrement(), keyId: f.column(dataColumnType) },
}).relations((rel) => ({ tenant: () => rel.manyToOne(BrandedTenant, { references: (row) => row.keyId }) }));

@Entity()
export class DecoratedKey {
  @Field(f.number().autoIncrement()) id?: TenantId;
}

/** A decorated property brands what its builder does not, so the builder cannot be held to the brand. */
@Entity()
export class DecoratedHolder {
  @Field(f.number().autoIncrement()) id?: number;
  @Field(f.number().references(() => DecoratedKey)) keyId?: TenantId;
  @Field(f.references(() => DecoratedKey)) derivedId?: TenantId;
  @Field(f.column(dataColumnType).references(() => BrandedTenant)) dataId?: TenantId;
}

/** A column-level foreign key is held to a relation's rule, on the property, which is what the row holds. */
@Entity()
export class DecoratedDropsBrand {
  @Field(f.number().autoIncrement()) id?: number;
  // @ts-expect-error a plain property drops the key's brand
  @Field(f.number().references(() => DecoratedKey)) keyId?: number;
  // @ts-expect-error another brand is not the key's
  @Field(f.number().references(() => DecoratedKey)) orgId?: OrgId;
  // @ts-expect-error nor is another kind of value
  @Field(f.string().references(() => DecoratedKey)) nameId?: string;
  @Field(f.number().references(() => PlainKey)) plainId?: TenantId;
  @Field(
    f
      .number()
      .references(() => DecoratedKey)
      .nullable(),
  )
  optionalId?: TenantId | null;
}

/** A key column referencing another stays a key, which a class has to name where its name says nothing. */
@Entity()
export class NamesReferencingKey {
  [idKey]?: 'code';
  @Field(
    f
      .number()
      .id()
      .references(() => DecoratedKey),
  )
  code!: TenantId;
}

@Entity()
export class LeavesReferencingKeyUnnamed {
  // @ts-expect-error nothing names `code` as the key
  @Field(
    f
      .number()
      .id()
      .references(() => DecoratedKey),
  )
  code?: TenantId;
}

export function aDefaultIsTheColumnsOwnType() {
  f.string<UserName>().default('x' as UserName);
  f.string<'a' | 'b'>().default('a');
  // @ts-expect-error a brand keeps a plain value out
  f.string<UserName>().default('x');
  // @ts-expect-error and a literal union, what is no member of it
  f.string<'a' | 'b'>().default('c');
}

type Usd = string & { readonly __tag: 'Usd' };
type Cents = number & { readonly __tag: 'Cents' };

export function aTypeArgumentNarrowsTheColumn() {
  const owner = f.uuid<UserId>();
  expectTypeOf<ColumnValueOf<typeof owner>>().toEqualTypeOf<UserId>();
  const payload = f.json<{ theme: string }>();
  expectTypeOf<ColumnValueOf<typeof payload>>().toEqualTypeOf<Json<{ theme: string }>>();
  const price = f.decimal<Usd>(12, 2);
  expectTypeOf<ColumnValueOf<typeof price>>().toEqualTypeOf<Usd>();
  const sized = f.number<Cents>().columnType('int');
  expectTypeOf<ColumnValueOf<typeof sized>>().toEqualTypeOf<Cents>();
  // @ts-expect-error a type argument narrows the column's own type
  f.number<string>();
}

export const StampKey = defineEntity({ name: 'StampKey', fields: { at: f.date<Stamp>().id() } });
export const PlainDateKey = defineEntity({ name: 'PlainDateKey', fields: { at: f.date().id() } });

/** A date's brand holds as a primitive's does: a plain column would drop it, a brand on the column alone loses nothing. */
defineEntity({ name: 'HoldsStamp', fields: { id: f.number().autoIncrement(), keyAt: f.date<Stamp>() } }).relations(
  (rel) => ({
    branded: () => rel.manyToOne(StampKey, { references: (row) => row.keyAt }),
    plain: () => rel.manyToOne(PlainDateKey, { references: (row) => row.keyAt }),
  }),
);
defineEntity({ name: 'DropsStamp', fields: { id: f.number().autoIncrement(), keyAt: f.date() } })
  // @ts-expect-error the column has to hold the key's brand
  .relations((rel) => ({ branded: () => rel.manyToOne(StampKey, { references: (row) => row.keyAt }) }));
