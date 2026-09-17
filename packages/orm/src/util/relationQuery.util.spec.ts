import { describe, expect, it } from 'vitest';
import { getMeta } from '../entity/index.js';
import { User } from '../test/entityMock.js';
import type { QueryPopulate } from '../type/index.js';
import { raw } from './raw.js';
import {
  childrenOf,
  getRelationRequestSummary,
  type JoinedRelationRejectedKey,
  parseRelationAtKey,
  parseRelationQueryValue,
  parentJoins,
  populatesRelations,
  targetKeyColumns,
} from './relationQuery.util.js';

/** `/http` parses a populate out of client JSON, so a key the types would refuse can still arrive. */
it('should pass over a relation populated false and a key that is no relation', () => {
  // @ts-expect-error: no such relation
  expect(getRelationRequestSummary(getMeta(User), { company: false, nope: true })).toEqual({
    requestedKeys: [],
    joinableKeys: [],
    toManyKeys: [],
  });
});

it('should summarize the relations a populate requests', () => {
  const meta = getMeta(User);
  const popProfile = { profile: 1 } satisfies QueryPopulate<User>;
  expect(getRelationRequestSummary(meta, popProfile).requestedKeys).toEqual(['profile']);

  const popProfileTrue = { profile: true } satisfies QueryPopulate<User>;
  expect(getRelationRequestSummary(meta, popProfileTrue).requestedKeys).toEqual(['profile']);

  const popNone = {} satisfies QueryPopulate<User>;
  expect(populatesRelations(meta, popNone)).toBe(false);

  expect(populatesRelations(meta, popProfile)).toBe(true);

  const popBoth: QueryPopulate<User> = { profile: true, users: true };
  const summary = getRelationRequestSummary(meta, popBoth);
  expect(summary.requestedKeys).toEqual(['profile', 'users']);
  expect(summary.joinableKeys).toEqual(['profile']);
  expect(summary.toManyKeys).toEqual(['users']);
});

/**
 * A joined relation brings one row per parent, so ordering, paging and de-duplicating it mean nothing
 * and are refused. A to-many loads through a query of its own, where all four apply.
 */
it('should reject in a joined relation the keys only its own query can carry', () => {
  const meta = getMeta(User);
  // A `Record` of the rejected-key union: adding one to the rule fails this until it is covered here.
  const rejected = {
    $sort: { bio: 1 },
    $limit: 5,
    $skip: 5,
    $distinct: true,
  } as const satisfies Record<JoinedRelationRejectedKey, unknown>;

  for (const [key, value] of Object.entries(rejected)) {
    expect(() => getRelationRequestSummary(meta, { profile: { [key]: value } })).toThrow(
      `'${key}' is not supported inside $populate of the to-one relation 'profile'`,
    );
  }

  // The very same keys on a to-many order and page its own rows.
  const paged = { $sort: { name: 1 }, $limit: 5, $skip: 5, $distinct: true } as const;
  expect(getRelationRequestSummary(meta, { users: paged }).toManyKeys).toEqual(['users']);

  // Nothing to inspect in the boolean and array forms.
  expect(getRelationRequestSummary(meta, { profile: true }).joinableKeys).toEqual(['profile']);
  // @ts-expect-error: the array form is plain JSON's
  expect(getRelationRequestSummary(meta, { profile: ['bio'] }).joinableKeys).toEqual(['profile']);
});

it('should read the relation at a populate key', () => {
  const pop: QueryPopulate<User> = { profile: { $select: { picture: true } } };
  expect(parseRelationAtKey('profile' as const, pop)).toEqual(parseRelationQueryValue(pop.profile));
});

it('should not read a key of the wrong type as a relation query', () => {
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

it("should parse a relation's query value", () => {
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

it('should take a raw $select in a relation query, as the statement does', () => {
  const $select = [raw`1`.as('one')];
  expect(parseRelationQueryValue({ $select })).toEqual({ query: { $select }, required: false, nested: true });
});

/**
 * A statement-level clause inside a populated relation is caught before the shape check, so the
 * message names the key rather than reporting the whole object as an unrecognized relation query.
 */
it.each([['$lock'], ['$candidates'], ['$count']])('should reject %s inside a populated relation', (clause) => {
  expect(() => parseRelationQueryValue({ [clause]: 1 })).toThrow(
    `'${clause}' applies to the whole statement, not to a populated relation`,
  );
});

describe('the columns a relation joins its parent by', () => {
  /** A junction's pairs are the parent's followed by the target's, so the boundary decides both. */
  const through = {
    through: () => class {},
    references: [
      { local: 'membershipUserId', foreign: 'userId' },
      { local: 'membershipGroupId', foreign: 'groupId' },
      { local: 'tagId', foreign: 'id' },
    ],
  };

  it('should split a junction at the parent key count', () => {
    expect(parentJoins(through, 2)).toEqual([
      { parent: 'userId', joined: 'membershipUserId' },
      { parent: 'groupId', joined: 'membershipGroupId' },
    ]);
    expect(targetKeyColumns(through, 2)).toEqual(['tagId']);
  });

  /** Guessing 1 returned the parent's second column as the target's - a real column of the wrong side. */
  it('should do not take a parent column for a target one', () => {
    expect(targetKeyColumns(through, 2)).not.toContain('membershipGroupId');
  });

  /** The ends swap between the two shapes, which is the whole reason this is answered in one place. */
  it('should read a direct relation from the other end', () => {
    const direct = { references: [{ local: 'id', foreign: 'userId' }] };
    expect(parentJoins(direct, 1)).toEqual([{ parent: 'id', joined: 'userId' }]);
  });

  /** Whole keys, so a delete has no chance to take a row no parent pairs with. */
  it('should name the children of a set of parents by whole keys, not by independent lists', () => {
    const joins = parentJoins(through, 2);
    expect(childrenOf(joins, [{ userId: 1, groupId: 2 }])).toEqual({
      $or: [{ membershipUserId: 1, membershipGroupId: 2 }],
    });
    // One column takes the `IN` it always did, rather than an OR of one-key maps.
    expect(childrenOf(parentJoins({ references: [{ local: 'id', foreign: 'userId' }] }, 1), [1, 2])).toEqual({
      userId: [1, 2],
    });
  });
});
