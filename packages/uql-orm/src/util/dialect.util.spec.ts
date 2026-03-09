import { expect, it } from 'vitest';
import { getMeta } from '../entity/decorator/index.js';
import { User } from '../test/entityMock.js';
import {
  augmentWhere,
  buildSortMap,
  fillOnFields,
  filterFieldKeys,
  filterRelationKeys,
  getFieldCallbackValue,
  isCascadable,
  isSelectingRelations,
  parseGroupMap,
} from './dialect.util.js';
import { raw } from './raw.js';

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
  const payload: any = { id: 1 };
  fillOnFields(meta, payload, 'onInsert');
  expect(payload.createdAt).toBeLessThanOrEqual(Date.now());
});

it('filterRelationKeys', () => {
  const meta = getMeta(User);
  expect(filterRelationKeys(meta, { id: 1, profile: 1 })).toEqual(['profile']);
  expect(filterRelationKeys(meta, { id: true, profile: true })).toEqual(['profile']);
});

it('isSelectingRelations', () => {
  const meta = getMeta(User);
  expect(isSelectingRelations(meta, { id: 1 })).toBe(false);
  expect(isSelectingRelations(meta, { profile: 1 })).toBe(true);
});

it('isCascadable', () => {
  expect(isCascadable('persist', true)).toBe(true);
  expect(isCascadable('persist', false)).toBe(false);
  expect(isCascadable('persist', 'persist')).toBe(true);
  expect(isCascadable('persist', 'delete')).toBe(false);
});

it('buildSortMap', () => {
  expect(buildSortMap({ id: 1 } as any)).toEqual({ id: 1 });
  expect(buildSortMap(undefined)).toEqual({});
});

it('parseGroupMap keys and fns', () => {
  const entries = parseGroupMap({
    code: true,
    count: { $count: '*' },
    total: { $sum: 'price' },
  } as any);
  expect(entries).toEqual([
    { kind: 'key', alias: 'code' },
    { kind: 'fn', alias: 'count', op: '$count', fieldRef: '*' },
    { kind: 'fn', alias: 'total', op: '$sum', fieldRef: 'price' },
  ]);
});

it('parseGroupMap skips falsy and non-object values', () => {
  const entries = parseGroupMap({
    a: false,
    b: 0,
    c: '',
    d: true,
  } as any);
  // Only `true` is a valid group key; false/0/'' are ignored
  expect(entries).toEqual([{ kind: 'key', alias: 'd' }]);
});
