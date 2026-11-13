/**
 * Named `$where` filters (`@Entity`'s and a defined entity's `filters`): a plain `QueryWhere<E>`
 * fragment or a function of the ambient {@link UqlContext}, both checked against the entity declaring
 * it. Type-checked by `bun run ts` only.
 */

import type { FilterOptions } from '../index.js';
import { $context, defineEntity, Entity, f, Field } from '../index.js';

class Invoice {
  id?: number;
  tenantId?: number;
  status?: string;
}

// ─── where as a plain fragment ───
export const staticFilter: FilterOptions<Invoice> = {
  where: { status: 'active' },
};
export const staticFilterTypo: FilterOptions<Invoice> = {
  // @ts-expect-error 'statuz' is not a field of Invoice
  where: { statuz: 'active' },
};

// ─── where as a function of the ambient context ───
export const contextFilter: FilterOptions<Invoice> = {
  where: (context) => {
    const tenantId = context?.['tenantId'];
    return typeof tenantId === 'number' ? { tenantId } : undefined;
  },
};
// A typo'd fragment *returned* from a where callback is not rejected: the literal is checked after the
// callback's return type was inferred. Annotating that return type (`(): QueryWhere<Invoice> | undefined`)
// restores the check.
export const contextFilterReturningFragment: FilterOptions<Invoice> = {
  where: () => ({ status: 'active' }),
};

// ─── `@Entity({ filters })`: `E` is inferred from the class it decorates ───
@Entity({ filters: { active: { where: { status: 'active' }, default: false } } })
class DecoratedInvoice {
  @Field(f.number().autoIncrement()) id?: number;
  @Field(f.string().nullable()) status?: string | null;
}
void DecoratedInvoice;

@Entity({
  filters: {
    // @ts-expect-error 'statuz' is not a field of the decorated entity
    broken: { where: { statuz: 'active' } },
  },
})
class MisfilteredInvoice {
  @Field(f.number().autoIncrement()) id?: number;
  @Field(f.string().nullable()) status?: string | null;
}
void MisfilteredInvoice;

// ─── a defined entity's filters: checked against its columns, same as decorators ───
defineEntity({
  name: 'Bill',
  fields: { id: f.number().autoIncrement(), status: f.string().nullable() },
}).filters({ active: { where: { status: 'active' } } });
defineEntity({
  name: 'Bill',
  fields: { id: f.number().autoIncrement() },
}).filters({
  // @ts-expect-error 'statuz' is not a column of Bill
  active: { where: { statuz: 'active' } },
});

// ─── a defined entity's filters after its relations read through them, as a decorated entity's do ───
export const Writer = defineEntity({
  name: 'Writer',
  fields: { id: f.number().autoIncrement(), name: f.string(), active: f.boolean() },
})
  .relations((rel) => ({ posts: () => rel.oneToMany(Post, { mappedBy: (post) => post.writer }) }))
  .filters({ published: { where: { posts: { title: { $ne: '' } } } } });

export const Post = defineEntity({
  name: 'Post',
  fields: { id: f.number().autoIncrement(), title: f.string(), writerId: f.number() },
})
  .relations((rel) => ({ writer: () => rel.manyToOne(Writer, { references: (post) => post.writerId }) }))
  .filters({
    byActiveWriter: { where: { writer: { active: true } } },
    twoHops: { where: { writer: { posts: { title: 'x' } } } },
    // @ts-expect-error 'actve' is not a column of Writer
    typo: { where: { writer: { actve: true } } },
    // @ts-expect-error 'titel' is not a column of Post, two hops away
    deepTypo: { where: { writer: { posts: { titel: 'x' } } } },
  });

// ─── a filter is a convenience scope: what must hold whatever a call asks is a policy ───
// @ts-expect-error a filter holds no security, a policy does
export const securityFilter: FilterOptions<Invoice> = { where: { tenantId: 1 }, security: true };
// @ts-expect-error nor names the statements it holds
export const convenienceOpsFilter: FilterOptions<Invoice> = { where: { status: 'active' }, ops: ['update'] };

declare module '../index.js' {
  interface UqlContext {
    filterUserId?: string;
  }
}

@Entity({ filters: { mine: { where: { status: $context.filterUserId } } } })
class ContextFiltered {
  @Field(f.number().autoIncrement()) id?: number;
  @Field(f.string().nullable()) status?: string | null;
}
void ContextFiltered;

@Entity({
  // @ts-expect-error a key holding a string never meets a number column, in a filter as in a policy
  filters: { mine: { where: { id: $context.filterUserId } } },
})
class ContextMistyped {
  @Field(f.number().autoIncrement()) id?: number;
}
void ContextMistyped;

@Entity({
  filters: {
    // @ts-expect-error `softDelete` is reserved for the filter `@Field({ softDelete })` registers
    softDelete: { where: { status: 'active' } },
  },
})
class ReservedInvoice {
  @Field(f.number().autoIncrement()) id?: number;
  @Field(f.string().nullable()) status?: string | null;
}
void ReservedInvoice;

defineEntity({
  name: 'Bill',
  fields: { id: f.number().autoIncrement(), status: f.string().nullable() },
})
  // @ts-expect-error and among an entity's filters
  .filters({ softDelete: { where: { status: 'active' } } });
