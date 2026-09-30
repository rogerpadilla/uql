// The browser client against the fetch handler, over a real database and a real HTTP server. Each side's
// own spec mocks the other, so only here does a route have to answer what the client's method promises.

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HttpQuerier } from '../browser/querier/httpQuerier.js';
import { Entity, Field, Id } from '../entity/index.js';
import { Migrator } from '../migrate/migrator.js';
import { Sqlite3QuerierPool } from '../sqlite/sqliteQuerierPool.js';
import { createFetchHandler } from './fetchHandler.js';

@Entity()
class Gadget {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) name?: string | null;
}

@Entity()
class Widget {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) name?: string | null;
  @Field({ type: Date, softDelete: true }) deletedAt?: Date | null;
}

describe('the browser client against the fetch handler', () => {
  const pool = new Sqlite3QuerierPool(':memory:');
  let server: Server;
  let querier: HttpQuerier;

  beforeAll(async () => {
    await new Migrator(pool, { entities: [Gadget, Widget] }).sync({ logging: false });
    await pool.insertMany(Gadget, [{ name: 'a' }, { name: 'b' }, { name: 'c' }]);
    const handle = createFetchHandler({ pool, include: [Gadget, Widget] });
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
    const { port } = server.address() as AddressInfo;
    querier = new HttpQuerier(`http://127.0.0.1:${port}`);
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
});
