import { expect, it } from 'vitest';
import { getMeta } from '../entity/index.js';
import { User } from '../test/entityMock.js';
import type { QueryPopulate } from '../type/index.js';
import {
  getRelationRequestSummary,
  isPopulatingRelations,
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

it('a key of the wrong type is not a relation query', () => {
  expect(() => parseRelationQueryValue({ $where: { id: 1 }, $distinct: 2 })).toThrow('Invalid relation query value');
  expect(() => parseRelationQueryValue({ $where: { id: 1 }, $skip: Number.NaN })).toThrow(
    'Invalid relation query value',
  );
  expect(() => parseRelationQueryValue({ $where: { id: 1 }, $sort: 'asc' })).toThrow('Invalid relation query value');
  expect(() => parseRelationQueryValue({ $where: { id: 1 }, $select: null })).toThrow('Invalid relation query value');
  expect(() => parseRelationQueryValue({ id: 1 })).toThrow('Invalid relation query value');
  expect(() => parseRelationQueryValue({ $limit: '10' })).toThrow('Invalid relation query value');
  expect(() => parseRelationQueryValue({ $where: null })).toThrow('Invalid relation query value');
});

it('parseRelationQueryValue', () => {
  expect(parseRelationQueryValue({ $where: { id: 1 } }).nested).toBe(true);
  expect(parseRelationQueryValue({ $required: 1 }).nested).toBe(true);

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
