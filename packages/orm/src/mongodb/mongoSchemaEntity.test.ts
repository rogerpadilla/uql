import { randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { defineEntity, f } from '../entity/index.js';
import { Migrator } from '../migrate/migrator.js';
import { mongoUri, provisioningTimeout } from '../test/index.js';
import { unvalidatedSchema } from '../test/unvalidatedSchema.js';
import { MongodbQuerierPool } from './mongodbQuerierPool.js';

const Shelf = defineEntity({
  name: 'Shelf',
  fields: { id: f.string().id().onInsert(randomUUID), label: f.string() },
}).relations(
  (rel) => ({ notes: () => rel.oneToMany(Note, { mappedBy: (note) => note.shelf }) }),
  (shelf) => ({ noteCount: () => shelf.notes.count(), topStars: () => shelf.notes.max((note) => note.stars) }),
);

const Note = defineEntity({
  name: 'Note',
  fields: {
    id: f.string().id().onInsert(randomUUID),
    body: f.string(),
    stars: f.number().onInsert(0),
    settings: f.json(unvalidatedSchema<{ theme: string }>()).nullable(),
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

const objectId = () => new ObjectId().toHexString();

const Writer = defineEntity({
  name: 'Writer',
  fields: { id: f.string().id().onInsert(objectId), name: f.string() },
}).relations((rel) => ({ essays: () => rel.oneToMany(Essay, { mappedBy: (essay) => essay.writer }) }));

const Essay = defineEntity({
  name: 'Essay',
  fields: { id: f.string().id().onInsert(objectId), title: f.string(), writerId: f.string().name('writer') },
}).relations((rel) => ({ writer: () => rel.manyToOne(Writer, { references: (essay) => essay.writerId }) }));

/** A schema entity is a document collection too: a filled column, a hook, a JSON payload and relations, on MongoDB. */
const pool = new MongodbQuerierPool(mongoUri('uql_schema_entity'));

beforeAll(async () => {
  await pool.withQuerier((querier) => querier.db.dropDatabase());
  await new Migrator(pool, { entities: [Shelf, Note, Writer, Essay] }).sync({ logging: false });
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

/** Keyed by `ObjectId`s, a schema's foreign key is stored as one, so a lookup on `_id` finds its rows both ways. */
it("should store a schema's foreign key to an ObjectId key as an ObjectId", async () => {
  const writerId = objectId();
  await pool.insertOne(Writer, { id: writerId, name: 'Ada' });
  await pool.insertMany(Essay, [
    { title: 'Notes', writerId },
    { title: 'Sketch', writerId },
  ]);

  const stored = await pool.withQuerier((querier) => querier.db.collection('Essay').findOne({ title: 'Notes' }));
  const [essay] = await pool.findMany(Essay, {
    $select: { title: true },
    $populate: { writer: { $select: { name: true } } },
    $where: { writerId, title: 'Notes' },
  });
  const [writer] = await pool.findMany(Writer, { $select: { name: true }, $count: { essays: true } });

  expect(stored?.['writer']).toEqual(new ObjectId(writerId));
  expect(essay).toEqual({ title: 'Notes', writer: { id: writerId, name: 'Ada' } });
  expect(writer).toEqual({ name: 'Ada', _count: { essays: 2 } });
});
