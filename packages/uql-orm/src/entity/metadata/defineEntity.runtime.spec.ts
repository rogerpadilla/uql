import { afterAll, expect, it, vi } from 'vitest';
import { Migrator } from '../../migrate/migrator.js';
import { SqlSchemaGenerator } from '../../migrate/schemaGenerator.js';
import { SqliteDialect } from '../../sqlite/sqliteDialect.js';
import { Sqlite3QuerierPool } from '../../sqlite/sqliteQuerierPool.js';
import type { ColumnType, Json, Scalar, Type } from '../../type/index.js';
import { getKeys } from '../../util/index.js';
import {
  defineEntity,
  defineField,
  defineId,
  defineRelation,
  getEntities,
  getMeta,
  removeEntity,
} from './definition.js';

/**
 * A content type an admin creates through a UI: its shape is a row in a table, not a class in the
 * source. Nothing in uql reads a TypeScript type at runtime, so the metadata a hand-written entity
 * registers can be assembled from data instead. What that costs at compile time - which is the only
 * thing it costs - is pinned in `defineEntity.runtime.test-d.ts`.
 */

/** What the admin UI stored: a column per field, which is the shape a CMS keeps its own schema in. */
type ContentType = { name: string; fields: { name: string; type: ColumnType }[] };

/** A row of a content type nobody declared: every key is a column, so every value is a scalar. */
type ContentRow = { [column: string]: Scalar | Json<Record<string, unknown>> };

/** Named after the content type, so its DDL and its errors read like a hand-written entity's. */
function register({ name, fields }: ContentType, base?: Type<object>): Type<ContentRow> {
  const entity = {
    [name]: class {
      id!: number;
      [column: string]: Scalar | Json<Record<string, unknown>>;
    },
  }[name];
  defineEntity(entity, {
    extends: base,
    name,
    fields: {
      id: { type: 'bigint', isId: true },
      ...Object.fromEntries(fields.map((field) => [field.name, { type: field.type }])),
    },
  });
  return entity;
}

const pool = new Sqlite3QuerierPool(':memory:');

/** Applies the entity schema to the database, the same additive diff the CLI's `sync` runs. */
const sync = (entities: Type<ContentRow>[]) => new Migrator(pool, { entities }).sync();

afterAll(() => pool.end());

it('registers the table a hand-written entity would, whichever way the type is spelled', () => {
  const Runtime = register({
    name: 'recipe',
    fields: [
      { name: 'title', type: 'text' },
      { name: 'servings', type: 'bigint' },
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

  // The runtime one names SQL types, the hand-written one JS constructors: the same table either way.
  const generator = new SqlSchemaGenerator(new SqliteDialect());
  expect(generator.generateCreateSchema([Runtime])).toEqual(generator.generateCreateSchema([Written]));
  expect(getMeta(Runtime)).toMatchObject({ name: 'recipe', ids: ['id'] });
});

it('creates its table from the definition, and the rows read back', async () => {
  const Post = register({
    name: 'post',
    fields: [
      { name: 'title', type: 'text' },
      { name: 'views', type: 'bigint' },
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
  const Author = register({ name: 'author', fields: [{ name: 'name', type: 'text' }] });
  const Article = register({ name: 'article', fields: [{ name: 'title', type: 'text' }] });
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
  const Doc = register({ name: 'doc', fields: [{ name: 'title', type: 'text' }] });
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
  const Owner = register({ name: 'owner', fields: [{ name: 'name', type: 'text' }] });
  const Note = register({ name: 'note', fields: [{ name: 'title', type: 'text' }] });
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
  const Page = register({ name: 'page', fields: [{ name: 'title', type: 'text' }] });
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

it('creates one content type, whatever the migrator was configured with', async () => {
  const Memo = register({ name: 'memo', fields: [{ name: 'body', type: 'text' }] });
  // Pinned to an explicit list, which a content type created after startup is never in.
  await new Migrator(pool, { entities: [] }).sync({ entity: Memo });

  const querier = await pool.getQuerier();
  await querier.insertOne(Memo, { id: 1, body: 'hi' });
  const found = await querier.findOneById(Memo, 1);
  await querier.release();

  expect(found).toEqual({ id: 1, body: 'hi' });
});

it('adds a field the admin added, and leaves one they retyped', async () => {
  const Tag = register({
    name: 'tag',
    fields: [
      { name: 'label', type: 'text' },
      { name: 'weight', type: 'bigint' },
    ],
  });
  const migrator = new Migrator(pool);
  await migrator.sync({ entity: Tag });

  // A column is additive and reaches the table; retyping one is not, on any engine, so it stays a
  // migration and the sync says nothing about it.
  defineField(Tag, 'colour', { type: String });
  defineField(Tag, 'weight', { type: String });
  await migrator.sync({ entity: Tag });

  const querier = await pool.getQuerier();
  await querier.insertOne(Tag, { id: 1, label: 'news', colour: 'red', weight: 2 });
  const found = await querier.findOneById(Tag, 1);
  await querier.release();

  expect(found).toEqual({ id: 1, label: 'news', colour: 'red', weight: 2 });
});

/**
 * The audit columns every content type carries. A minted class has no base to extend, so `extends`
 * names one: the same merge, and the base is a bag of columns rather than an entity of its own.
 */
it('gives every content type a base its class cannot extend', async () => {
  class Audited {
    createdBy?: string;
  }
  defineField(Audited, 'createdBy', { type: String });

  const Faq = register({ name: 'faq', fields: [{ name: 'question', type: 'text' }] }, Audited);
  const Guide = register({ name: 'guide', fields: [{ name: 'body', type: 'text' }] }, Audited);
  await sync([Faq, Guide]);

  expect(getKeys(getMeta(Faq).fields).sort()).toEqual(['createdBy', 'id', 'question']);
  expect(getEntities()).not.toContain(Audited);

  const querier = await pool.getQuerier();
  await querier.insertOne(Faq, { question: 'why', createdBy: 'ada' });
  await querier.insertOne(Guide, { body: 'how', createdBy: 'ada' });
  const [faq] = await querier.findMany(Faq, {});
  await querier.release();

  expect(faq).toEqual({ id: 1, question: 'why', createdBy: 'ada' });
});

it('forgets a content type the admin deleted', () => {
  const Draft = register({ name: 'draft', fields: [{ name: 'title', type: 'text' }] });
  expect(getEntities()).toContain(Draft);

  expect(removeEntity(Draft)).toBe(true);
  expect(getEntities()).not.toContain(Draft);
  expect(() => getMeta(Draft)).toThrow('is not an entity');
  // Removing is not a reset: the same class registers afresh, carrying nothing from before.
  expect(removeEntity(Draft)).toBe(false);
});
