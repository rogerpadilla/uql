import { expect, it } from 'vitest';
import { getMeta } from '../entity/decorator/index.js';
import { type Item, User } from '../test/entityMock.js';
import type { QueryGroupMap, QuerySelect } from '../type/index.js';
import {
  augmentWhere,
  buildSortMap,
  fillOnFields,
  filterFieldKeys,
  getFieldCallbackValue,
  isCascadable,
  normalizeScalarFieldSelection,
  parseGroupMap,
} from './dialect.util.js';
import { raw } from './raw.js';

/** Deliberately invalid entries plus one valid key — exercises parseGroupMap defensive parsing. */
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
  expect(isCascadable('persist', true)).toBe(true);
  expect(isCascadable('persist', false)).toBe(false);
  expect(isCascadable('persist', 'persist')).toBe(true);
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
