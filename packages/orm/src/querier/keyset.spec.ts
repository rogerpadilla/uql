import { afterAll, describe, expect, it } from 'vitest';
import { Entity, Field, getMeta, Id, Index, ManyToOne, OneToMany, removeEntity } from '../entity/index.js';
import { assertDefined } from '../test/index.js';
import type { Json, QueryKeyset } from '../type/index.js';
import { raw } from '../util/raw.js';
import { UqlUsageError } from '../util/uqlError.js';
import { keysetRead } from './keyset.js';

@Entity()
@Index((order) => [order.region, order.serial], { unique: true })
@Index((order) => [order.batch], { unique: true, where: { status: 'open' } })
class Order {
  @Id({ type: String }) id?: string;
  @Field({ type: Number }) createdAt?: number | null;
  @Field({ type: String, unique: true, nullable: false }) code?: string;
  @Field({ type: String, unique: true }) ref?: string | null;
  @Field({ type: String, nullable: false }) region?: string;
  @Field({ type: Number, nullable: false }) serial?: number;
  @Field({ type: String }) batch?: string | null;
  @Field({ type: String }) status?: string | null;
  @Field({ type: Date }) placedAt?: Date | null;
  @Field({ type: BigInt }) wide?: bigint | null;
  @Field({ type: 'jsonb' }) meta?: Json<{ rank?: number }> | null;
  @Field({ type: 'blob' }) digest?: Uint8Array | null;
  @Field({ type: Date, precision: 6 }) exactAt?: Date | null;
  /** A type of the engine's own, which no column family names, so only its value can say what it holds. */
  @Field({ type: String, columnType: raw`point` }) spot?: string | null;
  @Field({ type: 'vector', dimensions: 3 }) embedding?: number[] | null;
  @Field({ references: () => Customer }) customerId?: string | null;
  @ManyToOne({ entity: () => Customer, references: (order) => order.customerId }) customer?: Customer;
}

@Entity()
class Customer {
  @Id({ type: String }) id?: string;
  @Field({ type: String }) name?: string | null;
  @Field({ computed: (customer) => customer.orders.count() }) orderCount?: number;
  @OneToMany({ entity: () => Order, mappedBy: (order) => order.customer }) orders?: Order[];
}

const meta = getMeta(Order);
const lowest = (q: QueryKeyset<Order>) => keysetRead(meta, q, true);
const highest = (q: QueryKeyset<Order>) => keysetRead(meta, q, false);
/** The cursor at `row`, read off the page it alone makes. */
const cursorAt = (q: QueryKeyset<Order>, row: Order): string => {
  const { endCursor } = lowest(q).page([row]);
  assertDefined(endCursor);
  return endCursor;
};

afterAll(() => {
  removeEntity(Order);
  removeEntity(Customer);
});

describe('keysetRead', () => {
  it('should read one row past the page, sorted and filtered as asked', () => {
    const { query } = lowest({ $where: { status: 'open' }, $sort: { id: 1 }, $limit: 2 });
    expect(query).toEqual({ $where: { status: 'open' }, $sort: { id: 1 }, $limit: 3 });
  });

  it('should take a unique field declared non-null as a total sort', () => {
    expect(lowest({ $sort: { createdAt: -1, code: 1 }, $limit: 2 }).query.$sort).toEqual({ createdAt: -1, code: 1 });
  });

  it('should take a unique index whose columns are all declared non-null as a total sort', () => {
    expect(lowest({ $sort: { serial: 1, region: 1 }, $limit: 2 }).query.$sort).toEqual({ serial: 1, region: 1 });
  });

  /** A key of no columns proves no sort total, as an entity with none, a view, will have. */
  it('should not take an empty key as making every sort total', () => {
    expect(() => keysetRead({ ...meta, ids: [] }, { $sort: { createdAt: -1 }, $limit: 2 }, true)).toThrow(
      "a page of 'Order' sorts by createdAt, which two rows can share: add a unique, non-null field to the end of $sort",
    );
  });

  it.each<[string, QueryKeyset<Order>, string]>([
    [
      'no sort',
      { $limit: 2 },
      "a page of 'Order' sorts by nothing, which two rows can share: add 'id' or a unique, non-null field to the end of $sort",
    ],
    [
      'a sort two rows can share',
      { $sort: { createdAt: -1 }, $limit: 2 },
      "a page of 'Order' sorts by createdAt, which two rows can share: add 'id' or a unique, non-null field to the end of $sort",
    ],
    [
      'a unique field holding nulls, which every engine lets repeat',
      { $sort: { ref: 1 }, $limit: 2 },
      "a page of 'Order' sorts by ref, which two rows can share: add 'id' or a unique, non-null field to the end of $sort",
    ],
    [
      'a partial unique index, which leaves the rows outside it free to tie',
      { $sort: { batch: 1 }, $limit: 2 },
      "a page of 'Order' sorts by batch, which two rows can share: add 'id' or a unique, non-null field to the end of $sort",
    ],
    [
      'a JSON column',
      { $sort: { meta: 1, id: 1 }, $limit: 2 },
      "cannot page 'Order' by 'meta': a json column holds no one value a cursor can compare past",
    ],
    [
      'a vector column',
      { $sort: { embedding: 1, id: 1 }, $limit: 2 },
      "cannot page 'Order' by 'embedding': a vector column holds no one value a cursor can compare past",
    ],
    [
      'a blob column',
      { $sort: { digest: 1, id: 1 }, $limit: 2 },
      "cannot page 'Order' by 'digest': a blob column holds no one value a cursor can compare past",
    ],
    [
      'a timestamp keeping digits past the millisecond a Date holds',
      { $sort: { exactAt: 1, id: 1 }, $limit: 2 },
      "cannot page 'Order' by 'exactAt': it keeps 6 fractional digits, and a cursor the milliseconds a Date holds",
    ],
    [
      'a relation',
      { $sort: { customer: { name: 1 }, id: 1 }, $limit: 2 },
      "cannot page 'Order' by 'customer': a relation's value is read through a join that its filter would not keep",
    ],
    [
      'a JSON path',
      { $sort: { 'meta.rank': 1, id: 1 }, $limit: 2 },
      "cannot page 'Order' by 'meta.rank': a cursor compares fields, and this is none",
    ],
    [
      'a relevance',
      { $sort: { $text: 'desc', id: 1 }, $limit: 2 },
      "cannot page 'Order' by '$text': a relevance is scored per row, not stored on it",
    ],
    [
      'a vector distance',
      { $sort: { embedding: { $vector: [1, 2, 3] }, id: 1 }, $limit: 2 },
      `cannot page 'Order' by 'embedding': a vector distance is approximate, so "past this one" is no stable page`,
    ],
    [
      'a deduplication',
      { $sort: { id: 1 }, $limit: 2, $distinct: true },
      "a page of 'Order' takes no $distinct: its rows are a grouping, which the cursor compares no column of",
    ],
    [
      'both cursors',
      { $sort: { id: 1 }, $limit: 2, $after: 'a', $before: 'b' },
      "a page of 'Order' reads past one cursor, $after or $before, not both",
    ],
    [
      'a size of no rows',
      { $sort: { id: 1 }, $limit: 0 },
      "a page of 'Order' holds a positive whole number of rows, and $limit is 0",
    ],
    [
      'a fractional size',
      { $sort: { id: 1 }, $limit: 1.5 },
      "a page of 'Order' holds a positive whole number of rows, and $limit is 1.5",
    ],
    [
      'a raw projection',
      { $select: [raw`1`], $sort: { id: 1 }, $limit: 2 },
      "a page of 'Order' selects fields, which its cursor is read off",
    ],
  ])('should refuse %s', (_, q, message) => {
    expect(() => lowest(q)).toThrow(new UqlUsageError(message));
  });

  it('should refuse an offset, which reaches here untyped through `/http`', () => {
    const untyped = { $sort: { id: 1 }, $limit: 2, $skip: 4 } as const;
    expect(() => lowest(untyped)).toThrow(
      new UqlUsageError("a page of 'Order' takes no $skip: an offset reintroduces the drift a cursor removes"),
    );
  });

  it('should take the key alone as a total sort, on an entity declaring no index', () => {
    expect(keysetRead(getMeta(Customer), { $sort: { id: 1 }, $limit: 2 }, true).query.$sort).toEqual({ id: 1 });
  });

  it('should refuse sorting by a relation aggregate', () => {
    expect(() => keysetRead(getMeta(Customer), { $sort: { orderCount: -1, id: 1 }, $limit: 2 }, true)).toThrow(
      new UqlUsageError("cannot page 'Customer' by 'orderCount': an aggregate is computed per row, not stored on it"),
    );
  });

  it('should carry a sort key the projection leaves out, and strip it off the page', () => {
    const read = lowest({ $select: { code: true }, $sort: { createdAt: -1, id: 1 }, $limit: 1 });
    expect(read.query.$select).toEqual({ code: true, createdAt: true, id: true });

    const page = read.page([
      { id: 'a', code: 'x', createdAt: 5 },
      { id: 'b', code: 'y', createdAt: 4 },
    ]);
    expect(page.items).toEqual([{ code: 'x' }]);
    expect(page.hasNextPage).toBe(true);
  });

  it('should carry an excluded sort key by reading the projection out', () => {
    const read = lowest({ $exclude: { createdAt: true, meta: true }, $sort: { createdAt: -1, id: 1 }, $limit: 1 });
    expect(read.query.$exclude).toBeUndefined();
    expect(read.query.$select).toEqual(
      Object.fromEntries(
        [
          'id',
          'createdAt',
          'code',
          'ref',
          'region',
          'serial',
          'batch',
          'status',
          'placedAt',
          'wide',
          'digest',
          'exactAt',
          'spot',
          'embedding',
          'customerId',
        ].map((key) => [key, true]),
      ),
    );
  });

  it('should compare a key that holds no null by its value alone', () => {
    const $after = cursorAt({ $sort: { id: 1 }, $limit: 2 }, { id: 'b', code: 'c' });
    const { query } = lowest({ $where: { status: 'open' }, $sort: { id: 1 }, $limit: 2, $after });
    expect(query.$where).toEqual({ status: 'open', $and: [{ id: { $gt: 'b' } }] });
  });

  it('should bound the leading key, which is what lets Postgres seek', () => {
    const q: QueryKeyset<Order> = { $sort: { serial: -1, code: 1 }, $limit: 2 };
    const $after = cursorAt(q, { serial: 7, code: 'k', region: 'r' });
    expect(lowest({ ...q, $after }).query.$where).toEqual({
      $and: [{ serial: { $lte: 7 } }, { $or: [{ serial: { $lt: 7 } }, { code: { $gt: 'k' } }] }],
    });
  });

  it("should keep a caller's own $and beside the keyset", () => {
    const q: QueryKeyset<Order> = { $where: { $and: [{ status: 'open' }] }, $sort: { id: 1 }, $limit: 2 };
    const $after = cursorAt(q, { id: 'b', code: 'c' });
    expect(lowest({ ...q, $after }).query.$where).toEqual({ $and: [{ status: 'open' }, { id: { $gt: 'b' } }] });
  });

  it('should walk into the null block where it lies ahead of a value', () => {
    // Descending on an engine sorting nulls lowest puts the null block last.
    const q: QueryKeyset<Order> = { $sort: { createdAt: -1, id: 1 }, $limit: 2 };
    const $after = cursorAt(q, { id: 'b', createdAt: 100, code: 'c' });
    expect(lowest({ ...q, $after }).query.$where).toEqual({
      $and: [
        { $or: [{ createdAt: { $lte: 100 } }, { createdAt: null }] },
        { $or: [{ createdAt: { $lt: 100 } }, { createdAt: null }, { id: { $gt: 'b' } }] },
      ],
    });
  });

  it('should stay out of the null block where it lies behind a value', () => {
    const q: QueryKeyset<Order> = { $sort: { createdAt: -1, id: 1 }, $limit: 2 };
    const $after = cursorAt(q, { id: 'b', createdAt: 100, code: 'c' });
    expect(highest({ ...q, $after }).query.$where).toEqual({
      $and: [{ createdAt: { $lte: 100 } }, { $or: [{ createdAt: { $lt: 100 } }, { id: { $gt: 'b' } }] }],
    });
  });

  it('should page within the null block, and out of it where rows lie past it', () => {
    const q: QueryKeyset<Order> = { $sort: { createdAt: -1, id: 1 }, $limit: 2 };
    const $after = cursorAt(q, { id: 'b', createdAt: null, code: 'c' });
    expect(lowest({ ...q, $after }).query.$where).toEqual({ $and: [{ createdAt: null }, { id: { $gt: 'b' } }] });
    expect(highest({ ...q, $after }).query.$where).toEqual({
      $and: [{ $or: [{ createdAt: { $ne: null } }, { id: { $gt: 'b' } }] }],
    });
  });

  it('should read where a placement puts the nulls, whatever the engine does unqualified', () => {
    const q: QueryKeyset<Order> = { $sort: { createdAt: 'descNullsFirst', id: 1 }, $limit: 2 };
    const $after = cursorAt(q, { id: 'b', createdAt: 100, code: 'c' });
    expect(lowest({ ...q, $after }).query.$where).toEqual(highest({ ...q, $after }).query.$where);
    expect(lowest({ ...q, $after }).query.$where).toEqual({
      $and: [{ createdAt: { $lte: 100 } }, { $or: [{ createdAt: { $lt: 100 } }, { id: { $gt: 'b' } }] }],
    });
  });

  it('should read backward by inverting the order and the comparison, then the rows', () => {
    const q: QueryKeyset<Order> = { $sort: { createdAt: 'descNullsLast', id: 1 }, $limit: 1 };
    const $before = cursorAt(q, { id: 'b', createdAt: 100, code: 'c' });
    const read = lowest({ ...q, $before });
    expect(read.query.$sort).toEqual({ createdAt: 'ascNullsFirst', id: 'desc' });
    expect(read.query.$where).toEqual({
      $and: [{ createdAt: { $gte: 100 } }, { $or: [{ createdAt: { $gt: 100 } }, { id: { $lt: 'b' } }] }],
    });

    const page = read.page([
      { id: 'a', createdAt: 100, code: 'x' },
      { id: 'z', createdAt: 101, code: 'y' },
    ]);
    expect(page.items).toEqual([{ id: 'a', createdAt: 100, code: 'x' }]);
    expect(page.hasPrevPage).toBe(true);
    expect(page.hasNextPage).toBe(true);
  });

  it('should compare past the leading keys that prove the sort total, never past the rest', () => {
    const q: QueryKeyset<Order> = { $sort: { id: 1, createdAt: -1 }, $limit: 2 };
    const $after = cursorAt(q, { id: 'b', createdAt: null, code: 'c' });
    expect(lowest({ ...q, $after }).query.$where).toEqual({ $and: [{ id: { $gt: 'b' } }] });
  });
});

describe('a page', () => {
  const q: QueryKeyset<Order> = { $sort: { placedAt: 1, wide: 1, id: 1 }, $limit: 2 };

  it('should answer the first page with no cursor behind it', () => {
    const page = lowest(q).page([{ id: 'a', code: 'x' }]);
    expect(page.hasPrevPage).toBe(false);
    expect(page.hasNextPage).toBe(false);
    expect(page.startCursor).toBe(page.endCursor);
  });

  it('should answer an empty page with no cursors', () => {
    expect(lowest(q).page([])).toEqual({ items: [], hasNextPage: false, hasPrevPage: false });
  });

  it('should carry a date and a bigint through the cursor as they were', () => {
    const at = new Date('2026-09-28T10:00:00.123Z');
    const $after = lowest(q).page([{ id: 'a', code: 'x', placedAt: at, wide: 2n ** 70n }]).endCursor;
    // Ascending where nulls sort lowest: the null block lies behind, so no arm enters it.
    expect(lowest({ ...q, $after }).query.$where).toEqual({
      $and: [
        { placedAt: { $gte: at } },
        {
          $or: [
            { placedAt: { $gt: at } },
            { $and: [{ wide: { $gte: 2n ** 70n } }, { $or: [{ wide: { $gt: 2n ** 70n } }, { id: { $gt: 'a' } }] }] },
          ],
        },
      ],
    });
  });

  it('should refuse to mint a cursor over a value no scalar carries', () => {
    const point: Order = { id: 'a' };
    // What a driver hands back for a point, whatever the entity declares.
    Reflect.set(point, 'spot', { x: 1, y: 2 });
    expect(() => cursorAt({ $sort: { spot: 1, id: 1 }, $limit: 2 }, point)).toThrow(
      new UqlUsageError("cannot page 'Order' by 'spot': a cursor carries scalars, and it holds an object"),
    );
  });

  const dated: QueryKeyset<Order> = { $sort: { placedAt: 1, id: 1 }, $limit: 2 };
  const minted = cursorAt(dated, { id: 'a', placedAt: new Date(0) });

  it.each<[string, unknown[]]>([
    ['a date that is none', [{ d: 'yesterday' }, 'a']],
    ['a bigint that is no integer', [{ n: '1.5' }, 'a']],
    ['a tag it never writes', [{ x: 'zz' }, 'a']],
    ['two tags', [{ d: 'x', n: '1' }, 'a']],
    ['a tag holding no text', [{ d: 1 }, 'a']],
    ['an array', [[1], 'a']],
    ['a null where the key holds none', [null, null]],
    ['too few values', [null]],
  ])('should refuse a cursor holding %s', (_, values) => {
    expect(() => lowest({ ...dated, $after: reminted(minted, values) })).toThrow(
      new UqlUsageError("not a cursor: pass a page's startCursor or endCursor as it came"),
    );
  });

  it('should take a null where the key holds one', () => {
    expect(lowest({ ...dated, $after: reminted(minted, [null, 'a']) }).query.$where).toEqual({
      $and: [{ $or: [{ placedAt: { $ne: null } }, { id: { $gt: 'a' } }] }],
    });
  });

  it('should refuse a cursor minted for another sort, or tampered with', () => {
    const $after = cursorAt({ $sort: { id: 1 }, $limit: 2 }, { id: 'b', code: 'c' });
    expect(() => lowest({ $sort: { id: -1 }, $limit: 2, $after })).toThrow(
      new UqlUsageError("the cursor was not minted by a page of 'Order' sorted this way"),
    );
    expect(() => lowest({ $sort: { id: 1 }, $limit: 2, $after: `${$after}x` })).toThrow(UqlUsageError);
    expect(() => lowest({ $sort: { id: 1 }, $limit: 2, $after: 'not a cursor' })).toThrow(UqlUsageError);
  });
});

/** `cursor` holding `values` in place of its own, under the fingerprint it was minted with. */
function reminted(cursor: string, values: readonly unknown[]): string {
  const [fingerprint]: unknown[] = JSON.parse(atob(cursor.replace(/-/g, '+').replace(/_/g, '/')));
  return btoa(JSON.stringify([fingerprint, ...values]))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
