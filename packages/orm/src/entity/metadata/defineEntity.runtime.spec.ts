import { afterAll, expect, it } from 'vitest';
import { Migrator } from '../../migrate/migrator.js';
import { SqlSchemaGenerator } from '../../migrate/schemaGenerator.js';
import { SqliteDialect } from '../../sqlite/sqliteDialect.js';
import { SqliteQuerierPool } from '../../sqlite/sqliteQuerierPool.js';
import type { ColumnType, DefinedClass, DefinedFields, AbstractType } from '../../type/index.js';
import { getKeys } from '../../util/index.js';
import { f } from '../column.js';
import { Field } from '../decorator/members.js';
import { defineEntity, getEntities, getMeta, removeEntity } from './definition.js';

/**
 * A content type an admin creates through a UI: its shape is a row in a table, not a class in the
 * source. Nothing in uql reads a TypeScript type at runtime, so an entity can be defined from data.
 * What that costs at compile time - which is the only thing it costs - is pinned in
 * `defineEntity.runtime.test-d.ts`.
 */

/** What the admin UI stored: a column per field, which is the shape a CMS keeps its own schema in. */
type ContentType = { name: string; fields: { name: string; type: ColumnType }[] };

/** Its columns as `defineEntity` takes them, keyed by whatever the admin named each field. */
function columnsOf({ fields }: ContentType): DefinedFields {
  return {
    id: f.column('bigint').id(),
    ...Object.fromEntries(fields.map((field) => [field.name, f.column(field.type).nullable()])),
  };
}

/** Named after the content type, so its DDL and its errors read like a hand-written entity's. */
function register(contentType: ContentType, base?: DefinedClass<object>) {
  return defineEntity({ name: contentType.name, extends: base, fields: columnsOf(contentType) });
}

const pool = new SqliteQuerierPool(':memory:');

/** Applies the entity schema to the database, the same additive diff the CLI's `sync` runs. */
const sync = (entities: AbstractType<object>[]) => new Migrator(pool, { entities }).sync();

afterAll(() => pool.end());

it('should register the table a hand-written entity would, whichever way the type is spelled', () => {
  const Runtime = register({
    name: 'recipe',
    fields: [
      { name: 'title', type: 'text' },
      { name: 'servings', type: 'bigint' },
    ],
  });

  const Written = defineEntity({
    name: 'recipe',
    fields: { id: f.number().id(), title: f.string().nullable(), servings: f.number().nullable() },
  });

  // The runtime one names SQL types, the hand-written one JS constructors: the same table either way.
  const generator = new SqlSchemaGenerator(new SqliteDialect());
  expect(generator.generateCreateSchema([Runtime])).toEqual(generator.generateCreateSchema([Written]));
  expect(getMeta(Runtime)).toMatchObject({ name: 'recipe', ids: ['id'] });
});

it('should create its table from the definition, and the rows read back', async () => {
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

it('should relate two content types to each other', async () => {
  const Author = register({ name: 'author', fields: [{ name: 'name', type: 'text' }] });
  const Article = defineEntity({
    name: 'article',
    fields: columnsOf({
      name: 'article',
      fields: [
        { name: 'title', type: 'text' },
        { name: 'authorId', type: 'bigint' },
      ],
    }),
  }).relations((rel) => ({ author: () => rel.manyToOne(Author, { references: (article) => article['authorId'] }) }));
  await sync([Author, Article]);

  const querier = await pool.getQuerier();
  await querier.insertOne(Author, { id: 1, name: 'Ada' });
  await querier.insertOne(Article, { id: 1, title: 'Notes', authorId: 1 });
  const [article] = await querier.findMany(Article, { $populate: { author: true } });
  await querier.release();

  expect(article).toEqual({ id: 1, title: 'Notes', authorId: 1, author: { id: 1, name: 'Ada' } });
});

/** An edit is a new declaration of the content type, the old one removed, so nothing is read stale. */
it('should decode a field the admin added to a content type already in use', async () => {
  const doc = { name: 'doc', fields: [{ name: 'title', type: 'text' as const }] };
  const Doc = register(doc);
  await sync([Doc]);

  const querier = await pool.getQuerier();
  await querier.insertOne(Doc, { id: 1, title: 'About' });
  await querier.findOneById(Doc, 1);

  removeEntity(Doc);
  const Edited = register({ ...doc, fields: [...doc.fields, { name: 'settings', type: 'jsonb' }] });
  await sync([Edited]);

  await querier.updateOneById(Edited, 1, { settings: { theme: 'dark' } });
  const updated = await querier.findOneById(Edited, 1);
  await querier.release();

  expect(updated).toEqual({ id: 1, title: 'About', settings: { theme: 'dark' } });
});

it('should join a relation the admin added to a content type already in use', async () => {
  const Owner = register({ name: 'owner', fields: [{ name: 'name', type: 'text' }] });
  const note = { name: 'note', fields: [{ name: 'title', type: 'text' as const }] };
  const Note = register(note);
  await sync([Owner, Note]);

  const querier = await pool.getQuerier();
  await querier.insertOne(Owner, { id: 1, name: 'Ada' });
  await querier.findMany(Note, {});

  removeEntity(Note);
  const Edited = defineEntity({
    name: 'note',
    fields: columnsOf({ ...note, fields: [...note.fields, { name: 'ownerId', type: 'bigint' }] }),
  }).relations((rel) => ({ owner: () => rel.manyToOne(Owner, { references: (row) => row['ownerId'] }) }));
  await sync([Edited]);

  await querier.insertOne(Edited, { id: 1, title: 'Notes', ownerId: 1 });
  const [found] = await querier.findMany(Edited, { $populate: { owner: true } });
  await querier.release();

  expect(found).toEqual({ id: 1, title: 'Notes', ownerId: 1, owner: { id: 1, name: 'Ada' } });
});

it('should create one content type, whatever the migrator was configured with', async () => {
  const Memo = register({ name: 'memo', fields: [{ name: 'body', type: 'text' }] });
  // Pinned to an explicit list, which a content type created after startup is never in.
  await new Migrator(pool, { entities: [] }).sync({ entity: Memo });

  const querier = await pool.getQuerier();
  await querier.insertOne(Memo, { id: 1, body: 'hi' });
  const found = await querier.findOneById(Memo, 1);
  await querier.release();

  expect(found).toEqual({ id: 1, body: 'hi' });
});

it('should add a field the admin added, and leave one they retyped', async () => {
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
  removeEntity(Tag);
  const Edited = register({
    name: 'tag',
    fields: [
      { name: 'label', type: 'text' },
      { name: 'weight', type: 'text' },
      { name: 'colour', type: 'text' },
    ],
  });
  await migrator.sync({ entity: Edited });

  const querier = await pool.getQuerier();
  await querier.insertOne(Edited, { id: 1, label: 'news', colour: 'red', weight: 2 });
  const found = await querier.findOneById(Edited, 1);
  await querier.release();

  expect(found).toEqual({ id: 1, label: 'news', colour: 'red', weight: 2 });
});

/** The audit columns every content type carries: a base it extends, a bag of columns rather than an entity of its own. */
it('should give every content type a base its class cannot extend', async () => {
  class Audited {
    @Field(f.string().nullable()) createdBy?: string | null;
  }

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

it('should forget a content type the admin deleted', () => {
  const Draft = register({ name: 'draft', fields: [{ name: 'title', type: 'text' }] });
  expect(getEntities()).toContain(Draft);

  expect(removeEntity(Draft)).toBe(true);
  expect(getEntities()).not.toContain(Draft);
  expect(() => getMeta(Draft)).toThrow('is not an entity');
  // Removing is not a reset: the same class registers afresh, carrying nothing from before.
  expect(removeEntity(Draft)).toBe(false);
});
