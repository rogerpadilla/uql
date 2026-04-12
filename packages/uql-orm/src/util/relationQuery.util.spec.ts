import { expect, it } from 'vitest';
import { getMeta } from '../entity/decorator/index.js';
import { User } from '../test/entityMock.js';
import type { QueryPopulate } from '../type/index.js';
import {
  getRelationRequestSummary,
  isPopulatingRelations,
  isRelationQueryObject,
  parseRelationAtKey,
  parseRelationQueryValue,
} from './relationQuery.util.js';

it('getRelationRequestSummary', () => {
  const meta = getMeta(User);
  const popProfile = { profile: 1 } satisfies QueryPopulate<User>;
  expect(getRelationRequestSummary(meta, popProfile).requestedKeys).toEqual(['profile']);

  const popProfileTrue = { profile: true } satisfies QueryPopulate<User>;
  expect(getRelationRequestSummary(meta, popProfileTrue).requestedKeys).toEqual(['profile']);

  const popNone = {} satisfies QueryPopulate<User>;
  expect(isPopulatingRelations(meta, popNone)).toBe(false);

  expect(isPopulatingRelations(meta, popProfile)).toBe(true);

  const popBoth = { profile: true, users: true } as QueryPopulate<User>;
  const summary = getRelationRequestSummary(meta, popBoth);
  expect(summary.requestedKeys).toEqual(['profile', 'users']);
  expect(summary.joinableKeys).toEqual(['profile']);
  expect(summary.toManyKeys).toEqual(['users']);
});

it('parseRelationAtKey fetches populate properly', () => {
  const pop = { profile: { $select: { bio: true } } } as QueryPopulate<User>;
  expect(parseRelationAtKey('profile' as const, pop)).toEqual(parseRelationQueryValue(pop.profile));
});

it('relation query shape rejects invalid boolean, number, and object-typed keys', () => {
  expect(isRelationQueryObject({ $where: { id: 1 }, $distinct: 2 })).toBe(false);
  expect(isRelationQueryObject({ $where: { id: 1 }, $skip: Number.NaN })).toBe(false);
  expect(isRelationQueryObject({ $where: { id: 1 }, $sort: 'asc' })).toBe(false);
  expect(isRelationQueryObject({ $where: { id: 1 }, $select: null })).toBe(false);
});

it('parseRelationQueryValue and relation guard', () => {
  expect(isRelationQueryObject({ $where: { id: 1 } })).toBe(true);
  expect(isRelationQueryObject({ $required: 1 })).toBe(true);
  expect(isRelationQueryObject({ id: 1 })).toBe(false);
  expect(isRelationQueryObject({ $select: 123 })).toBe(false);
  expect(isRelationQueryObject({ $limit: '10' })).toBe(false);
  expect(isRelationQueryObject({ $where: null })).toBe(false);

  expect(parseRelationQueryValue({ $select: { id: true }, $required: true })).toEqual({
    query: { $select: { id: true }, $required: true },
    required: true,
    nested: true,
  });
  expect(parseRelationQueryValue(['id'])).toEqual({
    query: { $select: { id: 1 } },
    required: false,
    nested: false,
  });
  expect(parseRelationQueryValue(true)).toEqual({ query: {}, required: false, nested: false });
  expect(parseRelationQueryValue(1)).toEqual({ query: {}, required: false, nested: false });
  expect(() => parseRelationQueryValue({ $select: 123 })).toThrow('Invalid relation query value');
});
