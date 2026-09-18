/**
 * Named `$where` filters (`@Filter`, `defineFilter`, `EntityOptions.filters`): a plain `QueryWhere<E>`
 * fragment or a function of the ambient {@link UqlContext}, both checked against the entity declaring
 * it. Type-checked by `bun run ts` only.
 */

import type { FilterOptions } from '../index.js';
import { defineEntity, defineFilter, Field, Filter, Id } from '../index.js';

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

// ─── @Filter decorator: `E` is inferred from the class it decorates ───
@Filter('active', { where: { status: 'active' }, default: false })
// @ts-expect-error 'statuz' is not a field of the decorated entity
@Filter('broken', { where: { statuz: 'active' } })
class DecoratedInvoice {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) status?: string | null;
}
void DecoratedInvoice;

// ─── EntityOptions.filters: reached through defineEntity, same as decorators ───
class Bill {
  id?: number;
  status?: string | null;
}
defineEntity(Bill, {
  fields: { id: { type: Number, isId: true }, status: { type: String } },
  filters: { active: { where: { status: 'active' } } },
});
defineEntity(Bill, {
  fields: { id: { type: Number, isId: true } },
  filters: {
    // @ts-expect-error 'statuz' is not a field of Bill
    active: { where: { statuz: 'active' } },
  },
});

// ─── a security filter fails closed, and `softDelete` is the built-in filter's name ───
// @ts-expect-error a security filter never skips a missing value
export const skippingSecurityFilter: FilterOptions<Invoice> = { where: {}, security: true, onMissing: 'skip' };
export const skippingFilter: FilterOptions<Invoice> = { where: { status: 'active' }, onMissing: 'skip' };

// @ts-expect-error `softDelete` is reserved for the filter `@Field({ softDelete })` registers
@Filter('softDelete', { where: { status: 'active' } })
class ReservedInvoice {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) status?: string | null;
}
void ReservedInvoice;

// @ts-expect-error likewise imperatively
defineFilter(Bill, 'softDelete', { where: { status: 'active' } });
defineEntity(Bill, {
  fields: { id: { type: Number, isId: true } },
  // @ts-expect-error and among an entity's filters
  filters: { softDelete: { where: { status: 'active' } } },
});
