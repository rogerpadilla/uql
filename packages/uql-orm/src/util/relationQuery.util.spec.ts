import { expect, it } from 'vitest';
import { getMeta } from '../entity/index.js';
import { User } from '../test/entityMock.js';
import type { QueryPopulate } from '../type/index.js';
import {
  getRelationRequestSummary,
  type JoinedRelationRejectedKey,
  parseRelationAtKey,
  parseRelationQueryValue,
  populatesRelations,
} from './relationQuery.util.js';

it('getRelationRequestSummary', () => {
  const meta = getMeta(User);
  const popProfile = { profile: 1 } satisfies QueryPopulate<User>;
  expect(getRelationRequestSummary(meta, popProfile).requestedKeys).toEqual(['profile']);

  const popProfileTrue = { profile: true } satisfies QueryPopulate<User>;
  expect(getRelationRequestSummary(meta, popProfileTrue).requestedKeys).toEqual(['profile']);

  const popNone = {} satisfies QueryPopulate<User>;
  expect(populatesRelations(meta, popNone)).toBe(false);

  expect(populatesRelations(meta, popProfile)).toBe(true);

  const popBoth = { profile: true, users: true } as QueryPopulate<User>;
  const summary = getRelationRequestSummary(meta, popBoth);
  expect(summary.requestedKeys).toEqual(['profile', 'users']);
  expect(summary.joinableKeys).toEqual(['profile']);
  expect(summary.toManyKeys).toEqual(['users']);
});

/**
 * A joined relation brings exactly one row per parent, so ordering, paging and de-duplicating it are
 * meaningless - and every backend used to drop them silently. A to-many is loaded by a query of its
 * own, where all four mean what they say.
 */
it('a joined relation rejects the keys only its own query can carry', () => {
  const meta = getMeta(User);
  // A `Record` of the rejected-key union: adding one to the rule fails this until it is covered here.
  const rejected = {
    $sort: { bio: 1 },
    $limit: 5,
    $skip: 5,
    $distinct: true,
  } as const satisfies Record<JoinedRelationRejectedKey, unknown>;

  for (const [key, value] of Object.entries(rejected)) {
    expect(() => getRelationRequestSummary(meta, { profile: { [key]: value } } as QueryPopulate<User>)).toThrow(
      `'${key}' is not supported inside $populate of the to-one relation 'profile'`,
    );
  }

  // The very same keys on a to-many are what order and page its second query.
  expect(getRelationRequestSummary(meta, { users: rejected } as QueryPopulate<User>).toManyKeys).toEqual(['users']);

  // Nothing to inspect in the boolean and array forms.
  expect(getRelationRequestSummary(meta, { profile: true } as QueryPopulate<User>).joinableKeys).toEqual(['profile']);
  expect(getRelationRequestSummary(meta, { profile: ['bio'] } as QueryPopulate<User>).joinableKeys).toEqual([
    'profile',
  ]);
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

/**
 * A statement-level clause inside a populated relation is caught before the shape check, so the
 * message names the key rather than reporting the whole object as an unrecognized relation query.
 * Neither clause had a runtime test before `$candidates` joined `$lock` here.
 */
it.each([['$lock'], ['$candidates']])('rejects %s inside a populated relation', (clause) => {
  expect(() => parseRelationQueryValue({ [clause]: 1 })).toThrow(
    `'${clause}' applies to the whole statement, not to a populated relation`,
  );
});
