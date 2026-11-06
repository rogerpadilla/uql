import { describe, expect, it } from 'vitest';
import { defineEntity, Entity, f, Field, getMeta, OneToMany } from '../entity/index.js';
import type { Json } from '../type/index.js';
import { readWireData, readWirePayload, readWireQuery, writeWireData } from './wireRow.js';

@Entity()
class WireAccount {
  @Field(f.bigint().autoIncrement()) id?: bigint;
  @Field(f.string()) name?: string;
  @OneToMany(() => Ledger) ledgers?: InstanceType<typeof Ledger>[];
}

@Entity()
class WireTransfer {
  @Field(f.number().autoIncrement()) id?: number;
  @Field(f.references(() => WireAccount)) accountId?: bigint;
}

@Entity()
class WireOrder {
  @Field(f.number().autoIncrement()) id?: number;
  @Field(f.bigint()) total?: bigint;
  @Field(f.json()) items?: Json<string[]>;
}

@Entity()
class WireNote {
  @Field(f.number().autoIncrement()) id?: number;
  @Field(f.string()) text?: string;
}

const Ledger = defineEntity({
  name: 'WireLedger',
  fields: { id: f.number().autoIncrement(), at: f.date(), code: f.string(), accountId: f.bigint() },
}).relations((rel) => ({ account: () => rel.manyToOne(WireAccount, { references: (ledger) => ledger.accountId }) }));

describe('wire rows', () => {
  it('sends a foreign key typed by its bigint reference as its digits, and reads it back exact', () => {
    const meta = getMeta(WireTransfer);
    const sent = writeWireData(meta, [{ id: 1, accountId: 2n ** 60n }], 'rows');
    expect(sent).toEqual([{ id: 1, accountId: '1152921504606846976' }]);
    expect(readWireData(meta, sent, 'rows')).toEqual([{ id: 1, accountId: 2n ** 60n }]);
  });

  it('reads a row holding an `items` array as a row, a page only where the route answers one', () => {
    expect(writeWireData(getMeta(WireOrder), { id: 1, total: 5n, items: ['a'] }, 'rows')).toEqual({
      id: 1,
      total: '5',
      items: ['a'],
    });
  });

  it('carries rows beside their count, converting the rows alone', () => {
    const meta = getMeta(WireOrder);
    const sent = writeWireData(meta, [[{ id: 1, total: 5n }], 9], 'rowsAndCount');
    expect(sent).toEqual([[{ id: 1, total: '5' }], 9]);
    expect(readWireData(meta, sent, 'rowsAndCount')).toEqual([[{ id: 1, total: 5n }], 9]);
  });

  it('reads a composite key back as the row of its columns', () => {
    const Line = defineEntity({ name: 'WireLine', fields: { orderId: f.bigint().id(), lineNo: f.number().id() } });
    expect(readWireData(getMeta(Line), [{ orderId: '9007199254740993', lineNo: 1 }], 'ids')).toEqual([
      { orderId: 9007199254740993n, lineNo: 1 },
    ]);
  });

  it('hands back a counted answer that is no pair as it is, for the querier to refuse', () => {
    expect(readWireData(getMeta(WireOrder), 3, 'rowsAndCount')).toBe(3);
  });

  /** A transport with a serializer of its own (superjson) hands over values already as the entity holds them. */
  it('reads back a row its transport already typed as it is', () => {
    const at = new Date('2026-06-01T10:00:00.123Z');
    expect(readWireData(getMeta(Ledger), { id: 1, at, accountId: 2n ** 60n }, 'rows')).toEqual({
      id: 1,
      at,
      accountId: 2n ** 60n,
    });
  });

  it('hands back the rows and the page it converts nothing of as they are', () => {
    const page = { items: [{ id: 1, text: 'a' }], count: 1 };
    expect(writeWireData(getMeta(WireNote), page, 'page')).toBe(page);
    expect(readWireData(getMeta(WireNote), page.items, 'rows')).toBe(page.items);
  });

  it("reads a query's compared values back by the entity, through groups and relations, leaving patterns as text", () => {
    const at = '2026-06-01T00:00:00.000Z';
    const query = {
      $where: {
        at: { $gte: at, $not: { $lt: at }, $isNull: false },
        accountId: ['1', '2'],
        code: { $startsWith: '20' },
        $or: [{ at }, { at: null }],
        account: { id: '5' },
      },
      $limit: 1,
    };
    expect(readWireQuery(getMeta(Ledger), query)).toEqual({
      $where: {
        at: { $gte: new Date(at), $not: { $lt: new Date(at) }, $isNull: false },
        accountId: [1n, 2n],
        code: { $startsWith: '20' },
        $or: [{ at: new Date(at) }, { at: null }],
        account: { id: 5n },
      },
      $limit: 1,
    });
    expect(readWireQuery(getMeta(Ledger), {})).toEqual({});
    expect(readWireQuery(getMeta(Ledger), { $where: { account: null } })).toEqual({ $where: { account: null } });
  });

  it('reads keys back by the sole key, a composite one as its row, and passes a count and a non-page as they are', () => {
    const meta = getMeta(WireAccount);
    expect(writeWireData(meta, 5n, 'ids')).toBe('5');
    expect(readWireData(meta, ['5', null], 'ids')).toEqual([5n, null]);
    expect(readWireData(meta, { id: '5' }, 'ids')).toEqual({ id: 5n });
    expect(readWireData(meta, 3, 'count')).toBe(3);
    expect(readWireData(meta, null, 'page')).toBe(null);
    expect(readWireData(meta, { items: [{ id: '5' }], count: 1 }, 'page')).toEqual({ items: [{ id: 5n }], count: 1 });
  });

  it("reads an update's operands back, and a query's populated and counted relations", () => {
    expect(readWirePayload(getMeta(WireOrder), { total: { $inc: '1' } })).toEqual({ total: { $inc: 1n } });
    expect(readWirePayload(getMeta(WireOrder), { total: 'abc' })).toEqual({ total: 'abc' });
    const at = '2026-06-01T00:00:00.000Z';
    expect(
      readWireQuery(getMeta(WireAccount), {
        $populate: { ledgers: { $where: { at } }, other: true },
        $count: { ledgers: { $where: { at } } },
      }),
    ).toEqual({
      $populate: { ledgers: { $where: { at: new Date(at) } }, other: true },
      $count: { ledgers: { $where: { at: new Date(at) } } },
    });
  });
});
