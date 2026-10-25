import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { defineEntity, f } from '../entity/index.js';
import { Migrator } from '../migrate/migrator.js';
import { mongoUri, provisioningTimeout } from '../test/index.js';
import { MongodbQuerierPool } from './mongodbQuerierPool.js';

const Shelf = defineEntity({
  name: 'Shelf',
  fields: { id: f.string().id().onInsert(randomUUID), label: f.string() },
}).relations(
  (rel) => ({ notes: () => rel.oneToMany(Note, { mappedBy: (note) => note.shelf }) }),
  (rel) => ({ noteCount: () => rel.notes.count(), topStars: () => rel.notes.max((note) => note.stars) }),
);

const Note = defineEntity({
  name: 'Note',
  fields: {
    id: f.string().id().onInsert(randomUUID),
    body: f.string(),
    stars: f.number().onInsert(0),
    settings: f.json({ theme: String }).nullable(),
    shelfId: f.string(),
  },
})
  .hooks({
    beforeInsert: [
      (note) => {
        note.settings ??= { theme: 'light' };
      },
    ],
  })
  .relations((rel) => ({ shelf: () => rel.manyToOne(Shelf, { references: (note) => note.shelfId }) }));

/** A schema entity is a document collection too: a filled column, a hook, a JSON payload and relations, on MongoDB. */
const pool = new MongodbQuerierPool(mongoUri('uql_schema_entity'));

beforeAll(async () => {
  await pool.withQuerier((querier) => querier.db.dropDatabase());
  await new Migrator(pool, { entities: [Shelf, Note] }).sync({ logging: false });
}, provisioningTimeout);

afterAll(async () => {
  await pool.withQuerier((querier) => querier.db.dropDatabase());
  await pool.end();
});

it('should write and read a schema entity, a filled column, hook, JSON payload and relations', async () => {
  const shelfId = await pool.insertOne(Shelf, { label: 'Ideas' });
  await pool.insertOne(Note, { body: 'try', shelfId: String(shelfId) });
  const [note] = await pool.findMany(Note, { $populate: { shelf: { $required: true } } });
  const [shelf] = await pool.findMany(Shelf, { $populate: { notes: true } });

  expect(note).toMatchObject({ body: 'try', stars: 0, settings: { theme: 'light' }, shelf: { label: 'Ideas' } });
  expect(shelf.notes).toHaveLength(1);
  expect(await pool.count(Note, { $where: { 'settings.theme': 'light' } })).toBe(1);
});

/** An aggregate over a to-many reads as a column on MongoDB too, filtered and sorted like one. */
it('should read an aggregate over a relation as a column', async () => {
  const [busy] = await pool.insertMany(Shelf, [{ label: 'Busy' }, { label: 'Empty' }]);
  await pool.insertMany(Note, [
    { body: 'a', stars: 2, shelfId: String(busy) },
    { body: 'b', stars: 5, shelfId: String(busy) },
  ]);

  const shelves = await pool.findMany(Shelf, {
    $select: { label: true, noteCount: true, topStars: true },
    $where: { label: { $in: ['Busy', 'Empty'] } },
    $sort: { noteCount: 'desc' },
  });

  expect(shelves).toEqual([
    { label: 'Busy', noteCount: 2, topStars: 5 },
    { label: 'Empty', noteCount: 0, topStars: null },
  ]);
});
