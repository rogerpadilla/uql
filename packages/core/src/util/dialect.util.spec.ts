import { expect, it } from 'bun:test';
import { getMeta } from '../entity/decorator/index.js';
import { User } from '../test/entityMock.js';
import { augmentWhere } from './dialect.util.js';
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
