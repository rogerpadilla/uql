import { getMeta } from '../entity/decorator/index.js';
import { User } from '../test/entityMock.js';
import { augmentFilter } from './dialect.util.js';
import { raw } from './raw.js';

it('augmentFilter empty', () => {
  const meta = getMeta(User);
  expect(augmentFilter(meta)).toEqual({});
  expect(augmentFilter(meta, {})).toEqual({});
  expect(augmentFilter(meta, {}, {})).toEqual({});
});

it('augmentFilter', () => {
  const meta = getMeta(User);
  expect(augmentFilter(meta, { name: 'a' }, { name: 'b' })).toEqual({ name: 'b' });
  expect(augmentFilter(meta, { name: 'a' }, { id: 1 })).toEqual({ name: 'a', id: 1 });
  expect(augmentFilter(meta, { name: 'a' }, { $and: [1, 2] })).toEqual({ name: 'a', $and: [1, 2] });
  expect(augmentFilter(meta, 1, { $or: [2, 3] })).toEqual({ id: 1, $or: [2, 3] });
  const rawFilter = raw(() => 'a > 1');
  expect(augmentFilter(meta, rawFilter, 1)).toEqual({ $and: [rawFilter], id: 1 });
  expect(augmentFilter(meta, 1, rawFilter)).toEqual({ id: 1, $and: [rawFilter] });
});
