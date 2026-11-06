import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { TypedRow, User } from '../../test/index.js';
import { createQueryOptions } from './queryOptions.js';

describe('createQueryOptions', () => {
  const transport = vi.fn(async () => [{ id: 1, name: 'a' }]);
  const uql = createQueryOptions(transport);

  it('should key a read by the call it makes: the entity, the op and the rest of the call', () => {
    const { queryKey } = uql((db) => db.findMany(User, { $where: { name: 'a' }, $limit: 2 }));

    expect(queryKey).toEqual(['uql', 'user', 'findMany', { query: { $where: { name: 'a' }, $limit: 2 } }]);
    expect(transport).not.toHaveBeenCalled();
  });

  /** The same query counted and listed answers two different shapes, so the two can never share an entry. */
  it('should key two ops on one query apart', () => {
    const query = { $where: { name: 'a' } };

    expect(uql((db) => db.count(User, query)).queryKey).not.toEqual(uql((db) => db.findMany(User, query)).queryKey);
  });

  /** TanStack hashes a key with `JSON.stringify`, which throws on a `bigint`: the key holds what JSON carries. */
  it('should key a date and a bigint as the JSON a call carries', () => {
    const { queryKey } = uql((db) => db.findMany(TypedRow, { $where: { at: new Date(0), wide: 10n } }));

    expect(queryKey[3]).toEqual({ query: { $where: { at: '1970-01-01T00:00:00.000Z', wide: '10' } } });
  });

  it('should key every read of an entity under its prefix, for invalidation', () => {
    expect(uql.key(User)).toEqual(['uql', 'user']);
    expect(uql((db) => db.findOneById(User, '1')).queryKey.slice(0, 2)).toEqual(uql.key(User));
  });

  it('should key by the entity path the client is given', () => {
    const named = createQueryOptions(transport, { entityPath: () => 'people' });

    expect(named((db) => db.count(User)).queryKey).toEqual(['uql', 'people', 'count', {}]);
    expect(named.key(User)).toEqual(['uql', 'people']);
  });

  it("should fetch with the read itself, passing TanStack's signal on", async () => {
    const signal = new AbortController().signal;
    const options = uql((db) => db.findMany(User, { $select: { name: true } }));

    const rows = await options.queryFn({ signal });

    expect(rows).toEqual([{ id: 1, name: 'a' }]);
    expect(transport).toHaveBeenCalledWith(
      { entity: 'user', op: 'findMany', query: { $select: { name: true } } },
      { signal },
    );
    expectTypeOf(rows).toEqualTypeOf<Pick<User, 'name'>[]>();
  });

  it('should refuse a read making other than one call, which one key cannot name', () => {
    expect(() => uql(async () => 1)).toThrow(
      'a query reads by one call to the API, not 0: run the read outside `uql()` to see whether it failed before its call',
    );
    expect(() =>
      uql(async () => {
        throw new Error('before the call');
      }),
    ).toThrow('a query reads by one call to the API, not 0');
    expect(() => uql((db) => Promise.all([db.count(User), db.findMany(User, {})]))).toThrow(
      'a query reads by one call to the API, not 2',
    );
  });
});
