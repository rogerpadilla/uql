import { describe, expect, it } from 'vitest';
import { getMeta } from '../entity/index.js';
import { Company, Item, Parcel, Profile, Shipment, User } from '../test/index.js';
import { assertExposed, exposedQuery, exposuresOf, hideUnreadable, serve } from './exposure.js';

const exposures = exposuresOf([
  serve(User, { ops: ['read', 'insert', 'update'], members: { password: ['insert'], email: ['read'], users: false } }),
  serve(Profile, { members: { picture: ['read'] } }),
]);

const user = getMeta(User);

describe('assertExposed', () => {
  it.each([
    { op: 'deleteMany', refusal: "'User' cannot be deleted through this API" },
    { op: 'deleteOneById', refusal: "'User' cannot be deleted through this API" },
  ] as const)('should refuse $op on an entity that does not take it', ({ op, refusal }) => {
    expect(() => assertExposed(user, op, {}, undefined, exposures)).toThrow(refusal);
  });

  it('should refuse a save on an entity taking inserts alone, a save updating as well', () => {
    const insertOnly = exposuresOf([serve(User, { ops: ['insert'] })]);

    expect(() => assertExposed(user, 'insertOne', {}, { name: 'a' }, insertOnly)).not.toThrow();
    expect(() => assertExposed(user, 'saveOne', {}, { name: 'a' }, insertOnly)).toThrow(
      "'User' cannot be updated through this API",
    );
  });

  /** Filtering, sorting or tallying by a value reads it as surely as selecting it does, a character at a time. */
  it.each([
    { clause: '$select', query: { $select: { password: true } }, path: 'password' },
    { clause: '$select', query: { $select: { password: false } }, path: 'password' },
    { clause: '$where', query: { $where: { password: { $startsWith: 'a' } } }, path: 'password' },
    { clause: '$where', query: { $where: { $or: [{ name: 'a' }, { password: 'b' }] } }, path: 'password' },
    { clause: '$where', query: { $where: { creator: { password: 'b' } } }, path: 'creator.password' },
    { clause: '$sort', query: { $sort: { password: 1 } }, path: 'password' },
    { clause: '$sort', query: { $sort: { creator: { password: 1 } } }, path: 'creator.password' },
    {
      clause: '$populate',
      query: { $populate: { creator: { $select: { password: true } } } },
      path: 'creator.password',
    },
    { clause: '$populate', query: { $populate: { users: true } }, path: 'users' },
    { clause: '$count', query: { $count: { users: true } }, path: 'users' },
  ])('should refuse a read of what is not readable, in $clause', ({ query, path }) => {
    expect(() => assertExposed(user, 'findMany', query, undefined, exposures)).toThrow(
      `'${path}' cannot be read through this API`,
    );
  });

  /** What a form highlights the field by: every key from the call's root, clauses and list indexes included. */
  it.each([
    {
      op: 'findMany',
      query: { $where: { $or: [{ name: 'a' }, { password: 'b' }] } },
      payload: undefined,
      path: ['query', '$where', '$or', 1, 'password'],
    },
    {
      op: 'findMany',
      query: { $where: { creator: { password: 'b' } } },
      payload: undefined,
      path: ['query', '$where', 'creator', 'password'],
    },
    {
      op: 'findMany',
      query: { $populate: { company: true } },
      payload: undefined,
      path: ['query', '$populate', 'company'],
    },
    { op: 'insertMany', query: {}, payload: [{ name: 'a' }, { email: 'a@b.c' }], path: ['payload', 1, 'email'] },
  ] as const)('should point at what it refuses: $path', ({ op, query, payload, path }) => {
    expect(() => assertExposed(user, op, query, payload, exposures)).toThrow(expect.objectContaining({ path }));
  });

  it('should refuse a filter on what is not readable in a write too', () => {
    expect(() => assertExposed(user, 'updateMany', { $where: { password: 'a' } }, { name: 'b' }, exposures)).toThrow(
      "'password' cannot be read through this API",
    );
  });

  it.each([
    { op: 'insertOne', payload: { email: 'a@b.c' }, refusal: "'email' cannot be inserted through this API" },
    { op: 'insertMany', payload: [{ name: 'a' }, { email: 'a@b.c' }], refusal: "'email' cannot be inserted" },
    { op: 'updateMany', payload: { password: 'x' }, refusal: "'password' cannot be updated through this API" },
    { op: 'updateOneById', payload: { email: 'a@b.c' }, refusal: "'email' cannot be updated through this API" },
    { op: 'saveOne', payload: { password: 'x' }, refusal: "'password' cannot be updated through this API" },
    {
      op: 'insertOne',
      payload: { profile: { picture: 'a.png' } },
      refusal: "'profile.picture' cannot be inserted through this API",
    },
  ] as const)('should refuse $op writing what it does not take', ({ op, payload, refusal }) => {
    expect(() => assertExposed(user, op, {}, payload, exposures)).toThrow(refusal);
  });

  it('should take what each field takes', () => {
    expect(() => assertExposed(user, 'insertOne', {}, { name: 'a', password: 'x' }, exposures)).not.toThrow();
    expect(() => assertExposed(user, 'updateMany', { $where: { email: 'a' } }, { name: 'b' }, exposures)).not.toThrow();
    expect(() =>
      assertExposed(
        user,
        'findMany',
        { $select: { name: true, email: true }, $populate: { profile: true } },
        undefined,
        exposures,
      ),
    ).not.toThrow();
  });

  it('should refuse a relation reaching an entity it does not serve', () => {
    expect(() => assertExposed(user, 'findMany', { $populate: { company: true } }, undefined, exposures)).toThrow(
      "'company' reaches 'Company', which this API does not serve",
    );
  });

  /** A JSON path reads the member it starts at, so a hidden column is no more readable a key at a time. */
  it.each([
    { query: { $where: { 'kind.plan': { $startsWith: 'a' } } } },
    { query: { $sort: { 'kind.plan': 1 } } },
    { query: { $where: { $or: [{ 'kind.plan': 'pro' }] } } },
  ])('should refuse a JSON path into what is not readable: $query', ({ query }) => {
    const hidden = exposuresOf([serve(Company, { members: { kind: false } })]);

    expect(() => assertExposed(getMeta(Company), 'findMany', query, undefined, hidden)).toThrow(
      "'kind.plan' cannot be read through this API",
    );
  });

  /** A cascade saves the rows a write nests, inserting new ones and updating listed ones, whatever the op. */
  it('should hold a relation a write nests to what a save takes', () => {
    const updateOnly = exposuresOf([User, serve(Profile, { ops: ['read', 'update'] })]);
    const insertOnly = exposuresOf([User, serve(Profile, { ops: ['read', 'insert'] })]);

    expect(() => assertExposed(user, 'updateMany', {}, { profile: { picture: 'a' } }, updateOnly)).toThrow(
      "'Profile' cannot be inserted through this API",
    );
    expect(() => assertExposed(user, 'insertOne', {}, { profile: { picture: 'a' } }, insertOnly)).toThrow(
      "'Profile' cannot be updated through this API",
    );
  });

  /** An update of a to-many replaces its rows: those it does not list are deleted. */
  it('should hold a to-many an update nests to deleting the rows it no longer lists', () => {
    const savesOnly = exposuresOf([Shipment, serve(Parcel, { ops: ['read', 'insert', 'update'] })]);
    const shipment = getMeta(Shipment);

    expect(() => assertExposed(shipment, 'updateMany', {}, { parcels: [{}] }, savesOnly)).toThrow(
      "'Parcel' cannot be deleted through this API",
    );
    expect(() => assertExposed(shipment, 'insertOne', {}, { parcels: [{}] }, savesOnly)).not.toThrow();
  });

  /** The querier writes a relation a payload names only where it cascades: any other it leaves as it is. */
  it('should leave alone a relation a write names that does not cascade', () => {
    const readOnly = exposuresOf([serve(User, { ops: ['read', 'update'] })]);

    expect(() => assertExposed(user, 'updateMany', {}, { users: [{ name: 'a' }] }, readOnly)).not.toThrow();
  });

  it('should take nothing on an entity it does not serve', () => {
    expect(() => assertExposed(getMeta(Company), 'findMany', {}, undefined, exposures)).toThrow(
      "'Company' cannot be read through this API",
    );
  });

  it('should take everything on an entity served as it is', () => {
    const whole = exposuresOf([User, Company]);

    expect(() =>
      assertExposed(user, 'deleteMany', { $where: { password: 'a', company: { name: 'b' } } }, undefined, whole),
    ).not.toThrow();
  });
});

describe('serve', () => {
  /** An API hands an entity's middleware that entity's calls alone, and the guard holds the same off it. */
  it("should run an entity's middleware on its own calls, handing any other on as it is", async () => {
    const seen: string[] = [];
    const { around } = serve(User, {
      use: [
        (call, _context, next) => {
          seen.push(call.entity.name);
          return next(call);
        },
      ],
    });
    const next = async () => 'answered';

    expect(await around?.({ entity: Item, op: 'count', query: {}, hardDelete: false }, undefined, next)).toBe(
      'answered',
    );
    expect(await around?.({ entity: User, op: 'count', query: {}, hardDelete: false }, undefined, next)).toBe(
      'answered',
    );
    expect(seen).toEqual(['User']);
  });

  it('should wrap nothing for an entity naming no middleware', () => {
    expect(serve(User, {}).around).toBeUndefined();
  });
});

describe('exposedQuery', () => {
  it('should leave out what is not readable on a read answering rows, and nothing on a count', () => {
    expect(exposedQuery(user, 'findMany', {}, undefined, exposures)).toEqual({ $select: { password: false } });
    expect(exposedQuery(user, 'count', {}, undefined, exposures)).toEqual({});
  });

  it('should refuse before it projects', () => {
    expect(() => exposedQuery(user, 'findMany', { $sort: { password: 1 } }, undefined, exposures)).toThrow(
      "'password' cannot be read through this API",
    );
  });
});

describe('hideUnreadable', () => {
  it('should leave out what is not readable where the read names no projection', () => {
    expect(hideUnreadable(user, {}, exposures)).toEqual({ $select: { password: false } });
  });

  it('should add to a projection leaving fields out, and keep one naming the fields it reads', () => {
    expect(hideUnreadable(user, { $select: { name: false } }, exposures)).toEqual({
      $select: { name: false, password: false },
    });
    expect(hideUnreadable(user, { $select: { name: true } }, exposures)).toEqual({ $select: { name: true } });
  });

  it('should leave out what a populated relation cannot read, at any depth', () => {
    const profiles = exposuresOf([
      serve(User, { members: { password: false } }),
      serve(Profile, { members: { picture: false } }),
    ]);

    expect(hideUnreadable(user, { $populate: { profile: { $populate: { creator: true } } } }, profiles)).toEqual({
      $select: { password: false },
      $populate: {
        profile: { $select: { picture: false }, $populate: { creator: { $select: { password: false } } } },
      },
    });
  });

  it('should leave alone what a $populate does not populate: a relation turned off, a key no relation has', () => {
    const query = { $populate: { profile: false, nothing: true } };
    const hidden = exposuresOf([serve(User, {}), serve(Profile, { members: { picture: false } })]);

    expect(hideUnreadable(user, query, hidden)).toBe(query);
  });

  it('should leave a read of an entity with nothing hidden as it is', () => {
    const query = { $where: { name: 'a' } };

    expect(hideUnreadable(user, query, exposuresOf([User]))).toBe(query);
  });
});
