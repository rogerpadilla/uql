import { afterAll, expect, it } from 'vitest';
import { Migrator } from '../../migrate/migrator.js';
import { Sqlite3QuerierPool } from '../../sqlite/sqliteQuerierPool.js';
import type { Json, Scalar, Type } from '../../type/index.js';
import { defineEntity, defineField, defineId, defineRelation, getMeta } from './definition.js';

/**
 * A content type an admin creates through a UI: its shape is a row in a table, not a class in the
 * source. Nothing in uql reads a TypeScript type at runtime, so the metadata a hand-written entity
 * registers can be assembled from data instead. What that costs at compile time - which is the only
 * thing it costs - is pinned in `defineEntity.runtime.test-d.ts`.
 */

/** What the admin UI stored. */
type ContentType = { name: string; fields: { name: string; kind: keyof typeof KINDS }[] };

const KINDS = { text: String, number: Number } as const;

/** A row of a content type nobody declared: every key is a column, so every value is a scalar. */
type ContentRow = { [column: string]: Scalar | Json<Record<string, unknown>> };

/** Named after the content type, so its DDL and its errors read like a hand-written entity's. */
function register({ name, fields }: ContentType): Type<ContentRow> {
  const entity = {
    [name]: class {
      [column: string]: Scalar | Json<Record<string, unknown>>;
    },
  }[name];
  defineId(entity, 'id', { type: Number });
  for (const field of fields) {
    defineField(entity, field.name, { type: KINDS[field.kind] });
  }
  defineEntity(entity, { name });
  return entity;
}

const pool = new Sqlite3QuerierPool(':memory:');

/** Applies the entity schema to the database, the same additive diff the CLI's `sync` runs. */
const sync = (entities: Type<ContentRow>[]) => new Migrator(pool, { entities }).sync();

afterAll(() => pool.end());

it('registers the metadata a hand-written entity would', () => {
  const Runtime = register({
    name: 'recipe',
    fields: [
      { name: 'title', kind: 'text' },
      { name: 'servings', kind: 'number' },
    ],
  });

  class Written {
    id?: number;
    title?: string;
    servings?: number;
  }
  defineEntity(Written, {
    name: 'recipe',
    fields: { id: { type: Number, isId: true }, title: { type: String }, servings: { type: Number } },
  });

  expect(getMeta(Runtime)).toMatchObject({ name: 'recipe', fields: getMeta(Written).fields, ids: ['id'] });
});

it('creates its table from the definition, and the rows read back', async () => {
  const Post = register({
    name: 'post',
    fields: [
      { name: 'title', kind: 'text' },
      { name: 'views', kind: 'number' },
    ],
  });
  await sync([Post]);

  const querier = await pool.getQuerier();
  await querier.insertMany(Post, [
    { title: 'Arepas', views: 10 },
    { title: 'Bandeja', views: 2 },
  ]);
  const found = await querier.findMany(Post, { $where: { views: 10 }, $sort: { title: 'asc' } });
  await querier.release();

  expect(found).toEqual([{ id: 1, title: 'Arepas', views: 10 }]);
});

it('relates two content types to each other', async () => {
  const Author = register({ name: 'author', fields: [{ name: 'name', kind: 'text' }] });
  const Article = register({ name: 'article', fields: [{ name: 'title', kind: 'text' }] });
  defineField(Article, 'authorId', { references: () => Author });
  defineRelation(Article, 'author', { cardinality: 'm1', entity: () => Author });
  await sync([Author, Article]);

  const querier = await pool.getQuerier();
  await querier.insertOne(Author, { id: 1, name: 'Ada' });
  await querier.insertOne(Article, { id: 1, title: 'Notes', authorId: 1 });
  const [article] = await querier.findMany(Article, { $populate: { author: true } });
  await querier.release();

  expect(article).toEqual({ id: 1, title: 'Notes', authorId: 1, author: { id: 1, name: 'Ada' } });
});

it('decodes a field added after the entity has already been used', async () => {
  const Doc = register({ name: 'doc', fields: [{ name: 'title', kind: 'text' }] });
  await sync([Doc]);

  const querier = await pool.getQuerier();
  await querier.insertOne(Doc, { id: 1, title: 'About' });
  await querier.findOneById(Doc, 1);

  // A column that needs decoding, added to an entity the dialect has already classified. Its cached
  // list is keyed by the metadata's revision, so this one is not read back as the text it is stored as.
  defineField(Doc, 'settings', { type: 'jsonb' });
  await sync([Doc]);

  await querier.updateOneById(Doc, 1, { settings: { theme: 'dark' } });
  const updated = await querier.findOneById(Doc, 1);
  await querier.release();

  expect(updated).toEqual({ id: 1, title: 'About', settings: { theme: 'dark' } });
});

it('joins a relation added after the entity has already been used', async () => {
  const Owner = register({ name: 'owner', fields: [{ name: 'name', kind: 'text' }] });
  const Note = register({ name: 'note', fields: [{ name: 'title', kind: 'text' }] });
  await sync([Owner, Note]);

  const querier = await pool.getQuerier();
  await querier.insertOne(Owner, { id: 1, name: 'Ada' });

  // `note` was settled before this relation existed. Registering one marks its metadata changed, so
  // the next read settles it again rather than joining on columns nothing ever resolved.
  defineField(Note, 'ownerId', { references: () => Owner });
  defineRelation(Note, 'owner', { cardinality: 'm1', entity: () => Owner });
  await sync([Note]);

  await querier.insertOne(Note, { id: 1, title: 'Notes', ownerId: 1 });
  const [note] = await querier.findMany(Note, { $populate: { owner: true } });
  await querier.release();

  expect(note).toEqual({ id: 1, title: 'Notes', ownerId: 1, owner: { id: 1, name: 'Ada' } });
});

it('takes a field added after the entity has already been used', async () => {
  const Page = register({ name: 'page', fields: [{ name: 'title', kind: 'text' }] });
  await sync([Page]);

  const querier = await pool.getQuerier();
  await querier.insertOne(Page, { id: 1, title: 'About' });

  // The admin adds a field to the content type. The insert above already resolved and cached its
  // metadata, and the column does not exist yet: the next sync adds it, no restart in between.
  defineField(Page, 'subtitle', { type: String });
  await sync([Page]);

  await querier.updateOneById(Page, 1, { subtitle: 'the team' });
  const updated = await querier.findOneById(Page, 1);
  await querier.release();

  expect(updated).toEqual({ id: 1, title: 'About', subtitle: 'the team' });
});
