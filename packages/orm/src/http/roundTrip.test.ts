// The browser client against the fetch handler, over a real database and a real HTTP server. Each side's
// own spec mocks the other, so only here does a route have to answer what the client's method promises.

import { ok } from 'node:assert';
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HttpQuerier } from '../browser/querier/httpQuerier.js';
import { defineEntity, Entity, f, Field } from '../entity/index.js';
import { Migrator } from '../migrate/migrator.js';
import { SqliteQuerierPool } from '../sqlite/sqliteQuerierPool.js';
import { createFetchHandler } from './fetchHandler.js';

@Entity()
class Gadget {
  @Field(f.number().autoIncrement()) id?: number;
  @Field(f.string().nullable()) name?: string | null;
}

@Entity()
class Widget {
  @Field(f.number().autoIncrement()) id?: number;
  @Field(f.string().nullable()) name?: string | null;
  @Field(f.date().nullable().softDelete()) deletedAt?: Date | null;
}

const Parcel = defineEntity({
  name: 'WireParcel',
  fields: {
    id: f.number().autoIncrement(),
    pickupDate: f.column('date').nullable(),
    weight: f.bigint(),
    createdAt: f.date(),
    courierId: f.number(),
  },
}).relations((rel) => ({ courier: () => rel.manyToOne(Courier, { references: (parcel) => parcel.courierId }) }));

/** A key past 2^53, which JSON carries as its digits. */
const Ledger = defineEntity({ name: 'WireLedger', fields: { id: f.bigint().autoIncrement(), note: f.string() } });

const Courier = defineEntity({
  name: 'WireCourier',
  fields: { id: f.number().autoIncrement(), name: f.string() },
}).relations(
  (rel) => ({ parcels: () => rel.oneToMany(Parcel, { mappedBy: (parcel) => parcel.courier }) }),
  (courier) => ({ firstPickup: () => courier.parcels.min((parcel) => parcel.pickupDate) }),
);

/** A day as a `date` column holds it: its UTC midnight. */
const day = (text: string) => new Date(`${text}T00:00:00Z`);

describe('the browser client against the fetch handler', () => {
  const pool = new SqliteQuerierPool(':memory:');
  let server: Server;
  let querier: HttpQuerier;
  // What the `post` hook was handed, which is the server's rows as it holds them, not as JSON carries them.
  const seen: unknown[] = [];

  beforeAll(async () => {
    await new Migrator(pool, { entities: [Gadget, Widget, Parcel, Courier, Ledger] }).sync({ logging: false });
    await pool.insertMany(Gadget, [{ name: 'a' }, { name: 'b' }, { name: 'c' }]);
    const handle = createFetchHandler({
      pool,
      include: [Gadget, Widget, Parcel, Courier, Ledger],
      post: (_ctx, envelope) => {
        seen.push(envelope.data);
      },
    });
    server = createServer(async (req, res) => {
      const body = await Array.fromAsync(req);
      const response = await handle(
        new Request(`http://${req.headers.host}${req.url}`, {
          method: req.method,
          body: body.length ? Buffer.concat(body) : undefined,
        }),
      );
      res.writeHead(response.status, { 'content-type': 'application/json' });
      res.end(await response.text());
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    ok(typeof address === 'object' && address);
    querier = new HttpQuerier(`http://127.0.0.1:${address.port}`);
  });

  afterAll(async () => {
    await new Promise((resolve) => {
      server.close(resolve);
    });
    await pool.end();
  });

  it('should count every matching row beside a page of them', async () => {
    const { data, count } = await querier.findManyAndCount(Gadget, { $sort: { id: 1 }, $limit: 2 });

    expect(data.map((gadget) => gadget.name)).toEqual(['a', 'b']);
    expect(count).toBe(3);
  });

  /** `fetch` sends a method as written save the classic verbs, and a server refuses a lower-case `patch`. */
  it('should update a row through the verb a server takes', async () => {
    await querier.updateOneById(Gadget, 3, { name: 'renamed' });

    expect(await pool.findOneById(Gadget, 3)).toEqual({ id: 3, name: 'renamed' });
  });

  /** Every write answers how many rows it changed, as the client declares, not the ids it was asked for. */
  it('should answer the number of rows a write changed', async () => {
    await pool.insertMany(Widget, [{ name: 'x' }, { name: 'y' }, { name: 'z' }]);

    expect(await querier.updateOneById(Widget, 1, { name: 'x2' })).toEqual({ data: 1, count: 1 });
    expect(await querier.deleteOneById(Widget, 2)).toEqual({ data: 1, count: 1 });
    expect(await querier.deleteMany(Widget, { $where: { name: 'z' } })).toEqual({ data: 1, count: 1 });
  });

  it('should refuse a delete that names no rows, as the pool does', async () => {
    await expect(querier.deleteMany(Gadget, {})).rejects.toThrow(/names no rows/);

    expect(await pool.count(Gadget, {})).toBe(3);
  });

  it('should delete for good the rows a soft delete left, with hardDelete', async () => {
    await pool.insertOne(Widget, { name: 'gone' });
    await querier.deleteMany(Widget, { $where: { name: 'gone' } });

    expect(await querier.deleteMany(Widget, { $where: { name: 'gone' } }, { hardDelete: true })).toEqual({
      data: 1,
      count: 1,
    });
  });

  /** JSON carries a `Date` and a `bigint` as text: the client reads each back as the row holds it. */
  it('should read a row as the server holds it, through a page and its relations', async () => {
    const courierId = Number(await pool.insertOne(Courier, { name: 'Coordinadora' }));
    const createdAt = new Date('2026-06-01T10:00:00.123Z');
    await pool.insertMany(
      Parcel,
      ['2026-06-02', '2026-06-03'].map((pickup) => ({
        pickupDate: day(pickup),
        weight: 2n ** 60n,
        createdAt,
        courierId,
      })),
    );

    const { data } = await querier.findMany(Parcel, {
      $where: { courierId },
      $populate: { courier: true },
      $sort: { pickupDate: 'asc' },
    });
    const { data: page } = await querier.findManyPage(Parcel, {
      $where: { courierId },
      $sort: { id: 'asc' },
      $limit: 1,
    });
    const { data: courier } = await querier.findOneById(Courier, courierId, {
      $select: { firstPickup: true },
      $populate: { parcels: true },
    });

    expect(data).toMatchObject([
      { pickupDate: day('2026-06-02'), weight: 2n ** 60n, createdAt, courier: { name: 'Coordinadora' } },
      { pickupDate: day('2026-06-03'), weight: 2n ** 60n, createdAt },
    ]);
    expect(page.items).toMatchObject([{ pickupDate: day('2026-06-02'), createdAt }]);
    expect(seen.at(-3)).toMatchObject([{ pickupDate: day('2026-06-02'), weight: 2n ** 60n }, {}]);
    expect(courier).toMatchObject({ firstPickup: day('2026-06-02'), parcels: [{ weight: 2n ** 60n }, {}] });
  });

  it('should filter by a date and a bigint the client sends as text, as the server compares them', async () => {
    const courierId = Number(await pool.insertOne(Courier, { name: 'Interrapidisimo' }));
    const createdAt = new Date('2026-06-01T10:00:00.123Z');
    await pool.insertMany(
      Parcel,
      ['2026-06-02', '2026-06-03'].map((pickup) => ({
        pickupDate: day(pickup),
        weight: 2n ** 60n,
        createdAt,
        courierId,
      })),
    );

    const picked = async (pickupDate: Date) =>
      (
        await querier.findMany(Parcel, {
          $select: { pickupDate: true },
          $where: { courierId, pickupDate: { $gte: pickupDate }, weight: { $in: [2n ** 60n] } },
        })
      ).data;

    expect(await picked(day('2026-06-03'))).toMatchObject([{ pickupDate: day('2026-06-03') }]);
    expect(await picked(day('2026-06-04'))).toEqual([]);
  });

  it('should answer a bigint key the client reads back, and update a bigint by an operator', async () => {
    await pool.insertOne(Ledger, { id: 9007199254740993n, note: 'seed' });
    const { data: id } = await querier.insertOne(Ledger, { note: 'a' });
    const { data: ids } = await querier.insertMany(Ledger, [{ note: 'b' }]);

    expect(id).toBe(9007199254740994n);
    expect(ids).toEqual([9007199254740995n]);

    const courierId = Number(await pool.insertOne(Courier, { name: 'Deprisa' }));
    const parcelId = await pool.insertOne(Parcel, {
      pickupDate: null,
      weight: 2n ** 60n,
      createdAt: new Date(),
      courierId,
    });
    await querier.updateOneById(Parcel, parcelId, { weight: { $inc: 1n } });

    expect(await pool.findOneById(Parcel, parcelId)).toMatchObject({ weight: 2n ** 60n + 1n });
  });

  it('should filter a populated relation by a date the client sends, as the server compares it', async () => {
    const courierId = Number(await pool.insertOne(Courier, { name: 'TCC' }));
    const createdAt = new Date('2026-06-01T10:00:00.123Z');
    await pool.insertMany(
      Parcel,
      ['2026-06-02', '2026-06-03'].map((pickup) => ({ pickupDate: day(pickup), weight: 1n, createdAt, courierId })),
    );

    const { data: courier } = await querier.findOneById(Courier, courierId, {
      $populate: { parcels: { $select: { pickupDate: true }, $where: { pickupDate: { $gte: day('2026-06-03') } } } },
    });

    expect(courier?.parcels).toMatchObject([{ pickupDate: day('2026-06-03') }]);
  });

  it('should write back a row the client read, its bigint and dates as the entity holds them', async () => {
    const courierId = Number(await pool.insertOne(Courier, { name: 'Envia' }));
    const createdAt = new Date('2026-06-01T10:00:00.123Z');
    const { data: id } = await querier.insertOne(Parcel, {
      pickupDate: day('2026-06-02'),
      weight: 2n ** 60n,
      createdAt,
      courierId,
    });
    ok(id);
    const { data: row } = await querier.findOneById(Parcel, id);
    await querier.saveOne(Parcel, { ...row!, weight: 2n ** 60n + 1n });

    expect(await pool.findOneById(Parcel, id)).toMatchObject({
      pickupDate: day('2026-06-02'),
      weight: 2n ** 60n + 1n,
      createdAt,
    });
  });
});
