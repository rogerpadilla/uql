import { expect, it } from 'vitest';
import { UqlSecurityError, withContext } from '../context/context.js';
import { Entity, Field, Filter, getMeta } from '../entity/decorator/index.js';
import { type Item, User } from '../test/entityMock.js';
import type { QueryGroupMap, QuerySelect, QueryWhereMap } from '../type/index.js';
import {
  applyFilters,
  augmentWhere,
  buildSortMap,
  fillOnFields,
  filterFieldKeys,
  getFieldCallbackValue,
  getSoftDeleteValue,
  isCascadable,
  normalizeScalarFieldSelection,
  parseGroupMap,
} from './dialect.util.js';
import { raw } from './raw.js';

@Filter('active', { condition: { status: 'active' }, default: false })
@Filter('recent', { condition: () => ({ status: 'new' }), default: false })
@Entity()
class Filtered {
  @Field({ isId: true })
  id?: number;
  @Field()
  status?: string;
  @Field({ softDelete: true })
  deletedAt?: Date;
}

function applied(where: QueryWhereMap<Filtered>, opts?: Parameters<typeof applyFilters>[2]) {
  return applyFilters(getMeta(Filtered), where, opts);
}

it('applyFilters applies default-on filters (soft-delete) and skips default-off', () => {
  expect(applied({})).toEqual({ deletedAt: null });
});

it('applyFilters filters:false disables all', () => {
  expect(applied({}, { filters: false })).toEqual({});
});

it('applyFilters disables one by name, force-enables a default-off one', () => {
  expect(applied({}, { filters: { softDelete: false } })).toEqual({});
  expect(applied({}, { filters: { active: true } })).toEqual({ status: 'active', deletedAt: null });
});

it('applyFilters resolves thunk conditions', () => {
  expect(applied({}, { filters: { recent: true } })).toEqual({ status: 'new', deletedAt: null });
});

it('applyFilters escape hatch: does not overwrite a key already in $where', () => {
  const d = new Date();
  expect(applied({ deletedAt: d })).toEqual({ deletedAt: d });
});

@Filter('tenant', {
  condition: (ctx) => (ctx?.['tenantId'] != null ? { companyId: ctx['tenantId'] as number } : undefined),
  security: true,
})
@Entity()
class Tenanted {
  @Field({ isId: true })
  id?: number;
  @Field()
  companyId?: number;
  @Field({ softDelete: true })
  deletedAt?: Date;
}

function tenantApplied(where: QueryWhereMap<Tenanted>, opts?: Parameters<typeof applyFilters>[2]) {
  return applyFilters(getMeta(Tenanted), where, opts);
}

it('security filter AND-appends its condition from ambient context', () => {
  const where = withContext({ tenantId: 5 }, () => tenantApplied({}));
  expect(where).toEqual({ deletedAt: null, $and: [{ companyId: 5 }] });
});

it('security filter is not bypassable (filters:false ignored)', () => {
  const where = withContext({ tenantId: 5 }, () => tenantApplied({}, { filters: false }));
  expect(where).toEqual({ $and: [{ companyId: 5 }] }); // softDelete bypassed, tenant still applied
});

it('security filter cannot be overridden by a client $where on the same field', () => {
  const where = withContext({ tenantId: 5 }, () => tenantApplied({ companyId: 99 }));
  // client value stays, but the security predicate is AND-ed, so it is self-contradictory: no leak
  expect(where).toEqual({ companyId: 99, deletedAt: null, $and: [{ companyId: 5 }] });
});

it('security filter fails closed when context is missing', () => {
  expect(() => tenantApplied({})).toThrow(UqlSecurityError);
});

it('a condition resolving to {} means "no restriction" and merges nothing (trusted system context)', () => {
  @Filter('workspace', {
    condition: (ctx) =>
      ctx?.['system'] ? {} : ctx?.['tenantId'] != null ? { companyId: ctx['tenantId'] as number } : undefined,
    security: true,
  })
  @Entity()
  class SystemScoped {
    @Field({ isId: true })
    id?: number;
    @Field()
    companyId?: number;
  }
  const meta = getMeta(SystemScoped);
  // system context: security filter resolves to {} -> no $and appended, no broken predicate
  expect(withContext({ system: true }, () => applyFilters(meta, {}))).toEqual({});
  // tenant context still scopes
  expect(withContext({ tenantId: 3 }, () => applyFilters(meta, {}))).toEqual({ $and: [{ companyId: 3 }] });
  // missing context still fails closed
  expect(() => applyFilters(meta, {})).toThrow(UqlSecurityError);
});

it('applyFilters never mutates the input where map (returns a new object)', () => {
  const input: QueryWhereMap<Filtered> = { status: 'x' };
  const out = applied(input);
  expect(input).toEqual({ status: 'x' }); // input untouched - no injected `deletedAt`
  expect(out).not.toBe(input);
});

it('applyFilters does not mutate a client $and array when AND-merging a security filter', () => {
  const clientAnd: QueryWhereMap<Tenanted>[] = [{ companyId: 1 }];
  const input: QueryWhereMap<Tenanted> = { $and: clientAnd };
  const out = withContext({ tenantId: 5 }, () => tenantApplied(input));
  expect(clientAnd).toEqual([{ companyId: 1 }]); // original array untouched
  expect(out.$and).toEqual([{ companyId: 1 }, { companyId: 5 }]);
});

/** Deliberately invalid entries plus one valid key - exercises parseGroupMap defensive parsing. */
function malformedGroupMapFixture(): QueryGroupMap<Item> {
  return { a: false, b: 0, c: '', d: true } as unknown as QueryGroupMap<Item>;
}

it('augmentWhere empty', () => {
  const meta = getMeta(User);
  expect(augmentWhere(meta)).toEqual({});
  expect(augmentWhere(meta, {})).toEqual({});
  expect(augmentWhere(meta, {}, {})).toEqual({});
});

it('augmentWhere', () => {
  const meta = getMeta(User);
  expect(augmentWhere(meta, { name: 'a' }, { name: 'b' })).toEqual({ name: 'b' });
  expect(augmentWhere(meta, { name: 'a' }, { id: 1 })).toEqual({ name: 'a', id: 1 });
  expect(augmentWhere(meta, { name: 'a' }, { $and: [{ id: 1 }, { id: 2 }] })).toEqual({
    name: 'a',
    $and: [{ id: 1 }, { id: 2 }],
  });
  expect(augmentWhere(meta, 1, { $or: [{ id: 2 }, { id: 3 }] })).toEqual({ id: 1, $or: [{ id: 2 }, { id: 3 }] });
  const rawFilter = raw(() => 'a > 1');
  expect(augmentWhere(meta, rawFilter, 1)).toEqual({ $and: [rawFilter], id: 1 });
  expect(augmentWhere(meta, 1, rawFilter)).toEqual({ id: 1, $and: [rawFilter] });
});

it('getFieldCallbackValue', () => {
  expect(getFieldCallbackValue(() => 'fn')).toBe('fn');
  expect(getFieldCallbackValue('val')).toBe('val');
});

it('getSoftDeleteValue', () => {
  // `true` stamps the current timestamp
  expect(getSoftDeleteValue({ softDelete: true })).toBeInstanceOf(Date);
  // a callback stamps its result
  expect(getSoftDeleteValue({ softDelete: () => 42 })).toBe(42);
  // a scalar stamps as-is
  expect(getSoftDeleteValue({ softDelete: 'DELETED' })).toBe('DELETED');
});

it('filterFieldKeys', () => {
  const meta = getMeta(User);
  expect(filterFieldKeys(meta, { id: 1, name: 'John' }, 'onInsert')).toEqual(['id', 'name']);
  // email is not updatable
  expect(filterFieldKeys(meta, { email: 'a@b.com' }, 'onUpdate')).toEqual([]);
});

it('fillOnFields', () => {
  const meta = getMeta(User);
  const payload: Partial<User> & { id: number } = { id: 1 };
  fillOnFields(meta, payload, 'onInsert');
  expect(payload.createdAt).toBeLessThanOrEqual(Date.now());
});

it('normalizeScalarFieldSelection', () => {
  const meta = getMeta(User);
  expect(normalizeScalarFieldSelection(meta, { name: true } satisfies QuerySelect<User>)).toEqual(['name']);
  expect(normalizeScalarFieldSelection(meta, undefined, { name: true } satisfies QuerySelect<User>)).not.toContain(
    'name',
  );
  expect(normalizeScalarFieldSelection(meta, { name: false } satisfies QuerySelect<User>)).not.toContain('name');
});

it('isCascadable', () => {
  expect(isCascadable('persist', 'delete')).toBe(false);
});

it('buildSortMap', () => {
  expect(buildSortMap<User>({ name: 1 })).toEqual({ name: 1 });
  expect(buildSortMap(undefined)).toEqual({});
});

it('parseGroupMap keys and fns', () => {
  const group = {
    code: true,
    count: { $count: '*' },
    total: { $sum: 'salePrice' },
  } satisfies QueryGroupMap<Item>;
  const entries = parseGroupMap(group);
  expect(entries).toEqual([
    { kind: 'key', alias: 'code' },
    { kind: 'fn', alias: 'count', op: '$count', fieldRef: '*' },
    { kind: 'fn', alias: 'total', op: '$sum', fieldRef: 'salePrice' },
  ]);
});

it('parseGroupMap skips falsy and non-object values', () => {
  const entries = parseGroupMap(malformedGroupMapFixture());
  // Only `true` is a valid group key; false/0/'' are ignored
  expect(entries).toEqual([{ kind: 'key', alias: 'd' }]);
});
