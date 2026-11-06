import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { defineEntity, f } from '../../entity/index.js';
import type { WireCall } from '../../http/wireCall.js';
import { User, VectorItem } from '../../test/index.js';
import type { ClientQuerier } from '../type/index.js';
import { createClientQuerier } from './clientQuerier.js';

/** A transport answering `answer` to every call, recording each. */
function recording(answer: unknown) {
  return vi.fn(async (_call: WireCall, _opts?: unknown) => answer);
}

const Parcel = defineEntity({
  name: 'ClientParcel',
  fields: { id: f.bigint().autoIncrement(), at: f.date(), weight: f.bigint() },
});

describe('createClientQuerier', () => {
  it('should address an entity by the path it is given, for a build that renames classes', async () => {
    const send = recording([]);
    await createClientQuerier(send, { entityPath: () => 'people' }).findMany(User, {});

    expect(send).toHaveBeenCalledWith({ entity: 'people', op: 'findMany', query: {} }, undefined);
  });

  it.each([
    {
      op: 'findOneById',
      run: (q: ClientQuerier) => q.findOneById(User, '1', { $select: { name: true } }),
      call: { id: '1', query: { $select: { name: true } } },
    },
    {
      op: 'findOne',
      run: (q: ClientQuerier) => q.findOne(User, { $where: { name: 'a' } }),
      call: { query: { $where: { name: 'a' } } },
    },
    {
      op: 'findManyPage',
      run: (q: ClientQuerier) => q.findManyPage(User, { $sort: { id: 1 }, $limit: 2 }),
      call: { query: { $sort: { id: 1 }, $limit: 2 } },
    },
    {
      op: 'insertMany',
      run: (q: ClientQuerier) => q.insertMany(User, [{ name: 'a' }]),
      call: { payload: [{ name: 'a' }] },
    },
    {
      op: 'saveOne',
      run: (q: ClientQuerier) => q.saveOne(User, { id: '1', name: 'a' }),
      call: { payload: { id: '1', name: 'a' } },
    },
    {
      op: 'saveMany',
      run: (q: ClientQuerier) => q.saveMany(User, [{ id: '1' }]),
      call: { payload: [{ id: '1' }] },
    },
    {
      op: 'updateMany',
      run: (q: ClientQuerier) => q.updateMany(User, { $where: { name: 'a' } }, { name: 'b' }),
      call: { query: { $where: { name: 'a' } }, payload: { name: 'b' } },
    },
    {
      op: 'deleteOneById',
      run: (q: ClientQuerier) => q.deleteOneById(User, '1', { hardDelete: true }),
      call: { id: '1', hardDelete: true },
    },
  ])('should send $op as the call it is', async ({ op, run, call }) => {
    const send = recording(undefined);

    await run(createClientQuerier(send));

    expect(send.mock.calls[0]?.[0]).toEqual({ entity: 'user', op, ...call });
  });

  it('should hand its transport the options a call takes', async () => {
    const send = recording(0);
    const signal = AbortSignal.timeout(1000);

    await createClientQuerier(send).count(User, {}, { headers: { a: '1' }, signal });

    expect(send).toHaveBeenCalledWith({ entity: 'user', op: 'count', query: {} }, { headers: { a: '1' }, signal });
  });

  /** The route is one path segment, and `[object Object]` in it is a request no server can answer. */
  it('should refuse an id object, which a call has no spelling for', async () => {
    const send = recording(undefined);
    // @ts-expect-error: `User` has a single key
    await expect(createClientQuerier(send).findOneById(User, { id: 1 })).rejects.toThrow(
      /'User' was addressed by an id object, which a call cannot carry/,
    );
    expect(send).not.toHaveBeenCalled();
  });

  /** JSON carries a `Date` and a `bigint` as text: the client reads each back as the row holds it. */
  it('should answer what the server querier answers, read back by the entity', async () => {
    const at = new Date('2026-06-01T10:00:00.123Z');
    const row = { id: '9007199254740993', at: at.toISOString(), weight: '1' };
    const querier = createClientQuerier(recording([[row], 7]));

    const [rows, count] = await querier.findManyAndCount(Parcel, {});

    expect(rows).toEqual([{ id: 9007199254740993n, at, weight: 1n }]);
    expect(count).toBe(7);
    expect(await createClientQuerier(recording('9007199254740993')).insertOne(Parcel, { at, weight: 1n })).toBe(
      9007199254740993n,
    );
  });

  /** No op of its own: the count capped at one row, as a yes or no. */
  it('should tell whether anything matches', async () => {
    const send = recording(1);

    expect(await createClientQuerier(send).exists(User, { $where: { name: 'a' } })).toBe(true);
    expect(send).toHaveBeenCalledWith(
      { entity: 'user', op: 'count', query: { $where: { name: 'a' }, $limit: 1 } },
      undefined,
    );
    expect(await createClientQuerier(recording(0)).exists(User, {})).toBe(false);
  });

  it('should type each read by the query it was given', async () => {
    const querier = createClientQuerier(recording(undefined));
    const query = { $sort: { vec: { $vector: [1, 2, 3], $project: 'distance' } } } as const;
    type Ranked = VectorItem & { readonly distance: number };

    expectTypeOf(await querier.findOneById(VectorItem, 1, query)).toEqualTypeOf<Ranked | undefined>();
    expectTypeOf(await querier.findMany(VectorItem, query)).toEqualTypeOf<Ranked[]>();
    expectTypeOf(await querier.findManyAndCount(VectorItem, query)).toEqualTypeOf<[Ranked[], number]>();
    expectTypeOf(querier.findManyPage(User, { $sort: { id: 1 }, $limit: 2 }))
      .resolves.toHaveProperty('items')
      .toEqualTypeOf<User[]>();
  });
});
