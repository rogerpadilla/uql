import { describe, expect, it } from 'vitest';
import { UqlSecurityError, withContext } from '../context/context.js';
import { Entity, Field, Filter, getMeta, Id } from '../entity/index.js';
import { type Item, User } from '../test/entityMock.js';
import { idKey } from '../type/index.js';
import type { QueryAggMap, QueryGroupMap, QuerySelect, QueryWhere } from '../type/index.js';
import {
  applyFilters,
  asSelectMap,
  assertWhere,
  fillOnFields,
  filterFieldKeys,
  getFieldCallbackValue,
  getSoftDeleteValue,
  insertShapeOf,
  isCascadable,
  normalizeScalarFieldSelection,
  parseGroupMap,
  whereIds,
  withoutSoftDeleteFilter,
} from './dialect.util.js';
import { raw } from './raw.js';

@Filter('active', { condition: { status: 'active' }, default: false })
@Filter('recent', { condition: () => ({ status: 'new' }), default: false })
@Entity()
class Filtered {
  @Field({ type: Number, isId: true })
  id?: number;
  @Field({ type: String })
  status?: string;
  @Field({ type: Date, softDelete: true })
  deletedAt?: Date;
}

function applied(where: QueryWhere<Filtered>, opts?: Parameters<typeof applyFilters>[2]) {
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

it('applyFilters skips a convenience filter whose condition does not resolve', () => {
  @Filter('mine', { condition: (ctx) => (ctx?.['userId'] ? { ownerId: ctx['userId'] as number } : undefined) })
  @Entity()
  class Owned {
    @Id({ type: Number }) id?: number;
    @Field({ type: Number }) ownerId?: number;
  }
  expect(applyFilters(getMeta(Owned), {})).toEqual({});
});

it('withoutSoftDeleteFilter disables soft-delete alone, and keeps filters:false as it is', () => {
  expect(withoutSoftDeleteFilter({ active: true })).toEqual({ active: true, softDelete: false });
  expect(withoutSoftDeleteFilter(undefined)).toEqual({ softDelete: false });
  expect(withoutSoftDeleteFilter(false)).toBe(false);
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
  @Field({ type: Number, isId: true })
  id?: number;
  @Field({ type: Number })
  companyId?: number;
  @Field({ type: Date, softDelete: true })
  deletedAt?: Date;
}

function tenantApplied(where: QueryWhere<Tenanted>, opts?: Parameters<typeof applyFilters>[2]) {
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
    @Field({ type: Number, isId: true })
    id?: number;
    @Field({ type: Number })
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
  const input: QueryWhere<Filtered> = { status: 'x' };
  const out = applied(input);
  expect(input).toEqual({ status: 'x' }); // input untouched - no injected `deletedAt`
  expect(out).not.toBe(input);
});

it('applyFilters does not mutate a client $and array when AND-merging a security filter', () => {
  const clientAnd: QueryWhere<Tenanted>[] = [{ companyId: 1 }];
  const input: QueryWhere<Tenanted> = { $and: clientAnd };
  const out = withContext({ tenantId: 5 }, () => tenantApplied(input));
  expect(clientAnd).toEqual([{ companyId: 1 }]); // original array untouched
  expect(out.$and).toEqual([{ companyId: 1 }, { companyId: 5 }]);
});

/** Deliberately invalid entries plus one valid key - exercises parseGroupMap defensive parsing. */
function malformedGroupMapFixture(): QueryGroupMap<Item> {
  return { a: false, b: 0, c: '', d: true } as unknown as QueryGroupMap<Item>;
}

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
  expect(filterFieldKeys(meta, { id: '1', name: 'John' }, 'onInsert')).toEqual(['id', 'name']);
  // email is not updatable
  expect(filterFieldKeys(meta, { email: 'a@b.com' }, 'onUpdate')).toEqual([]);
});

it('fillOnFields', () => {
  const meta = getMeta(User);
  const payload: Partial<User> & { id: string } = { id: '1' };
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

@Entity()
class LazyId {
  @Id({ type: Number, eager: false })
  id?: number;
  @Field({ type: String })
  name?: string;
}

it('normalizeScalarFieldSelection drops an eager:false id field from the default set (no isId carve-out)', () => {
  const meta = getMeta(LazyId);
  expect(normalizeScalarFieldSelection(meta)).not.toContain('id');
});

it('normalizeScalarFieldSelection drops id when excluded via $exclude on a plain top-level query', () => {
  const meta = getMeta(User);
  expect(normalizeScalarFieldSelection(meta, undefined, { id: true } satisfies QuerySelect<User>)).not.toContain('id');
});

it('normalizeScalarFieldSelection allows a falsy $select map alongside $exclude', () => {
  const meta = getMeta(User);
  const fields = normalizeScalarFieldSelection(
    meta,
    { name: false } satisfies QuerySelect<User>,
    {
      id: true,
    } satisfies QuerySelect<User>,
  );
  expect(fields).not.toContain('name');
  expect(fields).not.toContain('id');
});

it('isCascadable', () => {
  expect(isCascadable('persist', 'delete')).toBe(false);
});

it('parseGroupMap keys and fns', () => {
  const group: QueryGroupMap<Item> = { code: true };
  const agg: QueryAggMap<Item> = {
    count: { $count: '*' },
    total: { $sum: 'salePrice' },
  };
  const entries = parseGroupMap(group, agg);
  expect(entries).toEqual([
    { kind: 'key', alias: 'code' },
    { kind: 'fn', alias: 'count', op: '$count', fieldRef: '*', distinct: false },
    { kind: 'fn', alias: 'total', op: '$sum', fieldRef: 'salePrice', distinct: false },
  ]);
});

it('parseGroupMap normalizes a flat distinct op to its base op', () => {
  const agg: QueryAggMap<Item> = { codes: { $countDistinct: 'code' } };
  const entries = parseGroupMap(undefined, agg);
  expect(entries).toEqual([{ kind: 'fn', alias: 'codes', op: '$count', fieldRef: 'code', distinct: true }]);
});

it('parseGroupMap rejects an aggregate function given no field', () => {
  expect(() => parseGroupMap(undefined, { total: { $sum: undefined } } as never)).toThrow(
    'empty aggregate function for: total',
  );
});

it('asSelectMap reads a raw-array $select as no map', () => {
  expect(asSelectMap<User>([raw`1`])).toBeUndefined();
  expect(asSelectMap<User>({ name: true })).toEqual({ name: true });
});

it('insertShapeOf names only the insertable keys a row carries', () => {
  const meta = getMeta(User);
  expect(insertShapeOf(meta, { name: 'a', email: undefined, unknown: 1 } as Partial<User>)).toBe('name,');
});

it('parseGroupMap skips falsy and non-object values', () => {
  const entries = parseGroupMap(malformedGroupMapFixture());
  // Only `true` is a valid group key; false/0/'' are ignored
  expect(entries).toEqual([{ kind: 'key', alias: 'd' }]);
});

@Entity()
class Enrolled {
  [idKey]?: 'studentId' | 'courseId';
  @Id({ type: Number }) studentId?: number;
  @Id({ type: String }) courseId?: string;
  @Field({ type: String }) grade?: string;
}

describe('whereIds', () => {
  it('names the one key column for a bare value, and an `IN` for a list of them', () => {
    expect(whereIds(getMeta(User), '1')).toEqual({ id: '1' });
    expect(whereIds(getMeta(User), ['1', '2'])).toEqual({ id: ['1', '2'] });
    expect(whereIds(getMeta(User), [])).toEqual({ id: [] });
  });

  it('names a composite row by its key map, which is a `$where` already, and a list of them by an OR', () => {
    const id = { studentId: 1, courseId: 'maths' };
    expect(whereIds(getMeta(Enrolled), id)).toBe(id);
    expect(whereIds(getMeta(Enrolled), [id])).toEqual({ $or: [id] });
  });

  /** A scalar names one column, which on a composite would address every row agreeing on it. */
  it('refuses a bare value where the key is composite', () => {
    expect(() => whereIds(getMeta(Enrolled), 1)).toThrow(
      /composite primary key \(studentId, courseId\), which addressing by a bare id value does not support/,
    );
    expect(() => whereIds(getMeta(Enrolled), [1, 2])).toThrow(/addressing by a bare id value/);
  });
});

describe('assertWhere', () => {
  it('passes a map, with or without a prototype', () => {
    expect(() => assertWhere(getMeta(User), { id: '1' })).not.toThrow();
    expect(() => assertWhere(getMeta(User), Object.assign(Object.create(null), { id: '1' }))).not.toThrow();
  });

  /** Untyped JS and parsed JSON can still pass these; read as a map, a scalar has no keys and filters nothing. */
  it.each([
    ['an id', '1'],
    ['a list of ids', [1, 2]],
    ['a bare raw()', raw`a > 1`],
    ['null', null],
  ])('refuses %s', (_, where) => {
    expect(() => assertWhere(getMeta(User), where)).toThrow("$where on 'User' must be a map of conditions");
  });
});
