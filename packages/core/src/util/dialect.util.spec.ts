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
  expect(augmentWhere(meta, { name: 'a' }, { $and: [1, 2] })).toEqual({ name: 'a', $and: [1, 2] });
  expect(augmentWhere(meta, 1, { $or: [2, 3] })).toEqual({ id: 1, $or: [2, 3] });
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
  expect(filterRelationKeys(meta, { id: 1, profile: 1 } as any)).toEqual(['profile']);
  expect(filterRelationKeys(meta, ['id', 'profile'] as any)).toEqual(['profile']);
});

it('isSelectingRelations', () => {
  const meta = getMeta(User);
  expect(isSelectingRelations(meta, { id: 1 })).toBe(false);
  expect(isSelectingRelations(meta, { profile: 1 } as any)).toBe(true);
});

it('isCascadable', () => {
  expect(isCascadable('persist', true)).toBe(true);
  expect(isCascadable('persist', false)).toBe(false);
  expect(isCascadable('persist', 'persist')).toBe(true);
  expect(isCascadable('persist', 'delete')).toBe(false);
});

it('buildSortMap', () => {
  expect(buildSortMap({ id: 1 } as any)).toEqual({ id: 1 });
  expect(buildSortMap([{ field: 'id', sort: 1 }])).toEqual({ id: 1 });
  expect(buildSortMap([['id', -1]])).toEqual({ id: -1 });
});
