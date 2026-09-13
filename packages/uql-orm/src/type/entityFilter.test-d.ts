/**
 * Type-level regression tests for named `$where` filters (`@Filter` / `defineFilter` /
 * `EntityOptions.filters`). A filter's `where` is either a plain `QueryWhere<E>` fragment or a
 * function of the ambient {@link UqlContext}, and both are checked against the entity the filter is
 * declared on.
 *
 * Not a runtime test: it is type-checked by `bun run ts`, skipped by vitest, and left out of the
 * build (excluded by the `.test-d.ts` suffix, Vitest's and `tsd`'s own convention for type-only tests). Each `@ts-expect-error` fails the type-check if the
 * error it guards ever stops happening, keeping the negatives locked in.
 */

import type { FilterOptions } from '../index.js';
import { defineEntity, Field, Filter, Id } from '../index.js';

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
// Note: a typo'd fragment *returned* from a where callback is not rejected at compile time -
// its object literal is checked once the callback's own return type has already been inferred and
// widened, so the excess-property check that catches `where: { statuz: 'active' }` above never
// sees it fresh. Annotating the callback's return type (`(): QueryWhere<Invoice> | undefined => ...`)
// restores the check; the plain-fragment form above is the one that matters in practice.
export const contextFilterReturningFragment: FilterOptions<Invoice> = {
  where: () => ({ status: 'active' }),
};

// ─── @Filter decorator: `E` is inferred from the class it decorates ───
@Filter('active', { where: { status: 'active' }, default: false })
// @ts-expect-error 'statuz' is not a field of the decorated entity
@Filter('broken', { where: { statuz: 'active' } })
class DecoratedInvoice {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) status?: string;
}
void DecoratedInvoice;

// ─── EntityOptions.filters: reached through defineEntity, same as decorators ───
class Bill {
  id?: number;
  status?: string;
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
