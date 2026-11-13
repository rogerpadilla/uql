/**
 * Row-level policies (`@Entity({ policies })` and a defined entity's `.policies()`): predicates checked against the
 * entity, its relations included, and context keys typed by the `UqlContext` they read. Type-checked by `bun run ts` only.
 */

import { $context, defineEntity, Entity, f, Field } from '../index.js';

declare module '../index.js' {
  interface UqlContext {
    policyTenantId?: number;
    policyUserId?: string;
  }
}

@Entity({
  policies: [
    { must: { tenantId: $context.policyTenantId } },
    { allow: { ownerId: $context.policyUserId, $new: { status: { $ne: 'void' } } } },
    {
      must: {
        $or: [
          { $old: { status: 'open' }, $new: { status: { $in: ['open', 'paid'] } } },
          { $old: { status: 'paid' }, $not: [{ $new: { status: 'open' } }] },
        ],
      },
      ops: ['update'],
    },
    { allow: { status: { $in: ['open', 'paid'] } }, ops: ['read'] },
    { allow: {}, when: { policyUserId: 'root' } },
  ],
})
class Invoice {
  @Field(f.number().autoIncrement()) id?: number;
  @Field(f.number()) tenantId?: number;
  @Field(f.string()) ownerId?: string;
  @Field(f.string()) status?: string;
}
void Invoice;

@Entity({
  // @ts-expect-error a string key never meets a number column
  policies: [{ must: { tenantId: $context.policyUserId } }],
})
class Mistyped {
  @Field(f.number().autoIncrement()) id?: number;
  @Field(f.number()) tenantId?: number;
}
void Mistyped;

@Entity({
  // @ts-expect-error 'tenantID' is not a field of the decorated entity
  policies: [{ must: { tenantID: $context.policyTenantId } }],
})
class Misspelled {
  @Field(f.number().autoIncrement()) id?: number;
  @Field(f.number()) tenantId?: number;
}
void Misspelled;

@Entity({
  // @ts-expect-error 'publish' is not a statement a policy holds
  policies: [{ allow: {}, ops: ['publish'] }],
})
class Misheld {
  @Field(f.number().autoIncrement()) id?: number;
}
void Misheld;

@Entity({
  // @ts-expect-error a context key takes the value it holds
  policies: [{ allow: {}, when: { policyTenantId: 'one' } }],
})
class Miswhen {
  @Field(f.number().autoIncrement()) id?: number;
}
void Miswhen;

@Entity({
  // @ts-expect-error the written row is `$new` in the predicate: a policy takes no `check`
  policies: [{ allow: {}, check: { status: 'open' } }],
})
class Checked {
  @Field(f.number().autoIncrement()) id?: number;
  @Field(f.string()) status?: string;
}
void Checked;

@Entity({
  // @ts-expect-error a row holds no row: `$old` reads the entity's own fields
  policies: [{ allow: { $old: { $new: { status: 'open' } } } }],
})
class Nested {
  @Field(f.number().autoIncrement()) id?: number;
  @Field(f.string()) status?: string;
}
void Nested;

@Entity({
  // @ts-expect-error 'state' is not a field of the row as written
  policies: [{ allow: { $new: { state: 'open' } } }],
})
class Misnamed {
  @Field(f.number().autoIncrement()) id?: number;
  @Field(f.string()) status?: string;
}
void Misnamed;

// A policy is data, so one stated once holds every entity whose fields it names.
const ownTenant = { must: { tenantId: $context.policyTenantId } };

@Entity({ policies: [ownTenant, { allow: {}, when: { policyUserId: ['root', 'admin'] } }] })
class SharedTenant {
  @Field(f.number().autoIncrement()) id?: number;
  @Field(f.number()) tenantId?: number;
}
void SharedTenant;

@Entity({
  // @ts-expect-error a shared policy still names the fields of each entity holding it
  policies: [ownTenant],
})
class Untenanted {
  @Field(f.number().autoIncrement()) id?: number;
}
void Untenanted;

@Entity({
  // @ts-expect-error each value a `when` lists is one its context key holds
  policies: [{ allow: {}, when: { policyTenantId: [1, 'two'] } }],
})
class MiswhenList {
  @Field(f.number().autoIncrement()) id?: number;
}
void MiswhenList;

// A tenant column is filled on insert, so an insert may leave it out.
export const Ledger = defineEntity({
  name: 'Ledger',
  fields: { id: f.number().autoIncrement(), tenantId: f.number().tenant($context.policyTenantId), name: f.string() },
});

// The default `$context.tenantId` holds a number in this program, so a text tenant names its key.
// @ts-expect-error a text column takes no number tenant
void f.string().tenant();
// @ts-expect-error a number column takes no text context key
void f.number().tenant($context.policyUserId);
void f.number().tenant();
// @ts-expect-error a misspelled context key is no declared one
void $context.policyTenantID;
void defineEntity({ name: 'Miswhen2', fields: { id: f.number().autoIncrement() } }).policies([
  // @ts-expect-error a `when` names a declared context key
  { allow: {}, when: { rol: 'x' } },
]);
declare const ledgers: import('../index.js').Querier;
void ledgers.insertOne(Ledger, { name: 'cash' });

@Entity({
  // @ts-expect-error a policy states one effect
  policies: [{ allow: {}, must: {} }],
})
class Twofold {
  @Field(f.number().autoIncrement()) id?: number;
}
void Twofold;

// ─── a defined entity's policies read through its relations, as its filters do: the one reading them goes last ───
export const Project = defineEntity({
  name: 'Project',
  fields: { id: f.number().autoIncrement(), tenantId: f.number() },
})
  .relations((rel) => ({ members: () => rel.oneToMany(Member, { mappedBy: (member) => member.project }) }))
  .filters({ big: { where: { id: { $gt: 100 } }, default: false } })
  .policies([
    { must: { tenantId: $context.policyTenantId } },
    { allow: { members: { userId: $context.policyUserId } } },
  ]);

export const Member = defineEntity({
  name: 'Member',
  fields: { id: f.number().autoIncrement(), projectId: f.number(), userId: f.string() },
})
  .relations((rel) => ({ project: () => rel.manyToOne(Project, { references: (member) => member.projectId }) }))
  .policies([
    // @ts-expect-error 'userID' is not a column of Member, read through its project
    { allow: { project: { members: { userID: $context.policyUserId } } } },
  ]);

defineEntity({ name: 'Once', fields: { id: f.number().autoIncrement() } })
  .relations(() => ({}))
  .policies([{ allow: {} }])
  // @ts-expect-error an entity declares its policies once
  .policies([{ allow: {} }]);
