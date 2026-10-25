/**
 * Named `$where` filters (`@Entity`'s and a schema's `filters`): a plain `QueryWhere<E>`
 * fragment or a function of the ambient {@link UqlContext}, both checked against the entity declaring
 * it. Type-checked by `bun run ts` only.
 */

import type { FilterOptions } from '../index.js';
import { defineEntity, Entity, f, Field } from '../index.js';

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
    return tenantId ? { tenantId: tenantId as number } : undefined;
  },
  security: true,
  onMissing: 'throw',
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
  @Field(f.number().id()) id?: number;
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
  @Field(f.number().id()) id?: number;
  @Field(f.string().nullable()) status?: string | null;
}
void MisfilteredInvoice;

// ─── a schema's filters: checked against its columns, same as decorators ───
defineEntity({
  name: 'Bill',
  fields: { id: f.number().id(), status: f.string().nullable() },
}).filters({ active: { where: { status: 'active' } } });
defineEntity({
  name: 'Bill',
  fields: { id: f.number().id() },
}).filters({
  // @ts-expect-error 'statuz' is not a column of Bill
  active: { where: { statuz: 'active' } },
});

// ─── a security filter fails closed, and `softDelete` is the built-in filter's name ───
// @ts-expect-error a security filter never skips a missing value
export const skippingSecurityFilter: FilterOptions<Invoice> = { where: {}, security: true, onMissing: 'skip' };
export const skippingFilter: FilterOptions<Invoice> = { where: { status: 'active' }, onMissing: 'skip' };

@Entity({
  filters: {
    // @ts-expect-error `softDelete` is reserved for the filter `@Field({ softDelete })` registers
    softDelete: { where: { status: 'active' } },
  },
})
class ReservedInvoice {
  @Field(f.number().id()) id?: number;
  @Field(f.string().nullable()) status?: string | null;
}
void ReservedInvoice;

defineEntity({
  name: 'Bill',
  fields: { id: f.number().id(), status: f.string().nullable() },
})
  // @ts-expect-error and among an entity's filters
  .filters({ softDelete: { where: { status: 'active' } } });
