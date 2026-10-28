import { describe, expect, it } from 'vitest';
import { sql } from '../../util/sql.js';
import { f } from '../column.js';
import { defineEntity, getEntities, getMeta, removeEntity } from './definition.js';

describe('a defined entity', () => {
  it('should register its columns and every section on first read', () => {
    const Author = defineEntity({ name: 'Author', fields: { id: f.number().id(), name: f.string() } }).relations(
      (rel) => ({ books: () => rel.oneToMany(Book, { mappedBy: (book) => book.author }) }),
      (author) => ({
        bookCount: () => author.books.count(),
        stockGap: () =>
          f
            .number()
            .nullable()
            .as(sql`${author.books.count()} - ${author.id}`),
      }),
    );
    const Book = defineEntity({
      name: 'Book',
      table: 'books',
      fields: {
        id: f.number().id(),
        title: f.string(),
        authorId: f.number(),
        editorId: f.number().nullable(),
      },
    })
      .computed((book) => ({ shout: f.string().as(sql`upper(${book.title})`) }))
      .indexes((book, index) => [index([book.title], { include: [book.authorId], unique: true })])
      .checks((book, check) => [check(sql`${book.title} <> ''`, 'titled')])
      .hooks({ beforeInsert: [() => undefined] })
      .relations((rel) => ({
        author: () => rel.manyToOne(Author, { references: (book) => book.authorId }),
        editor: () => rel.manyToOne(Author, { references: (book) => book.editorId, onDelete: 'SET NULL' }),
      }));

    const meta = getMeta(Book);
    expect(meta.name).toBe('books');
    expect(meta.ids).toEqual(['id']);
    expect(meta.fields.title).toMatchObject({ type: String });
    expect(meta.fields.shout?.computed).toBeDefined();
    expect(meta.fields.editorId).toMatchObject({ nullable: true });
    expect(meta.relations.editor).toMatchObject({
      onDelete: 'SET NULL',
      references: [{ local: 'editorId', foreign: 'id' }],
    });
    expect(meta.indexes).toMatchObject([{ entries: [{ column: 'title' }], include: ['authorId'], unique: true }]);
    expect(meta.checks).toMatchObject([{ name: 'titled' }]);
    expect(meta.hooks?.beforeInsert).toHaveLength(1);
    expect(meta.relations.author).toMatchObject({
      cardinality: 'm1',
      references: [{ local: 'authorId', foreign: 'id' }],
    });
    expect(getMeta(Author).fields.bookCount?.computed).toBeDefined();
    expect(getMeta(Author).fields.stockGap?.computed).toBeDefined();
    expect(getMeta(Author).relations.books).toMatchObject({ cardinality: '1m', mappedBy: 'author' });
    removeEntity(Book);
    removeEntity(Author);
  });

  it('should refuse a relation to an abstract base at run time, which an entity defined from data reaches', () => {
    const Base = defineEntity({ name: 'Base', abstract: true, fields: { id: f.number().id() } });
    const Holder = defineEntity({ name: 'Holder', fields: { id: f.number().id(), baseId: f.number() } }).relations(
      (rel) => ({
        // @ts-expect-error an abstract base is never a table
        base: () => rel.manyToOne(Base, { references: (holder) => holder.baseId }),
      }),
    );
    expect(() => getMeta(Holder)).toThrow("'Base' is abstract: a relation needs a table to join");
    removeEntity(Holder);
  });

  it('should refuse a section declared twice, or after its first read', () => {
    const Tag = defineEntity({ name: 'Tag', fields: { id: f.number().id(), label: f.string() } });
    Tag.indexes((tag, index) => [index([tag.label])]);
    expect(() => Tag.indexes(() => [])).toThrow("'Tag' declares its indexes twice");
    getMeta(Tag);
    expect(() => Tag.checks(() => [])).toThrow("'Tag' was read already");
    removeEntity(Tag);
  });

  it('should be listed, its sections in, before anything read it', () => {
    const Listed = defineEntity({ name: 'Listed', fields: { id: f.number().id() } });
    expect(getEntities()).toContain(Listed);
    removeEntity(Listed);
  });

  it('should report a mistake on every read until it is fixed', () => {
    const Keyless = defineEntity({ name: 'Keyless', fields: { name: f.string() } });
    expect(() => getMeta(Keyless)).toThrow("'Keyless' must have at least one id field");
    expect(() => getMeta(Keyless)).toThrow("'Keyless' must have at least one id field");
    removeEntity(Keyless);
  });

  it('should report the same mistake again after one registered part of it', () => {
    const Unkeyed = defineEntity({ name: 'Unkeyed', fields: { body: f.text() } }).triggers((unkeyed, trigger) => [
      trigger({ name: 'touch', on: 'beforeUpdate', of: [unkeyed.body], run: () => sql`SELECT 1` }),
    ]);
    expect(() => getMeta(Unkeyed)).toThrow("'Unkeyed' must have at least one id field");
    expect(() => getMeta(Unkeyed)).toThrow("'Unkeyed' must have at least one id field");
    removeEntity(Unkeyed);
  });

  it('should inherit its base sections, the base read first', () => {
    const Base = defineEntity({
      name: 'Base',
      abstract: true,
      fields: { id: f.number().id(), createdAt: f.date() },
    }).indexes((base, index) => [index([base.createdAt])]);
    const Child = defineEntity({ name: 'Child', extends: Base, fields: { label: f.string() } }).indexes(
      (child, index) => [index([child.label, child.createdAt])],
    );
    const meta = getMeta(Child);
    expect(Object.keys(meta.fields)).toEqual(['id', 'createdAt', 'label']);
    expect(meta.indexes?.map(({ entries }) => entries.map(({ column }) => column))).toEqual([
      ['createdAt'],
      ['label', 'createdAt'],
    ]);
    expect(new Child()).toBeInstanceOf(Base);
    removeEntity(Child);
    removeEntity(Base);
  });

  it('should read the refs a section is handed off the entity it declares', () => {
    const Post = defineEntity({ name: 'Post', fields: { id: f.number().id(), body: f.text() } }).triggers(
      (post, trigger) => [trigger({ on: 'beforeUpdate', of: [post.body], run: () => sql`SELECT 1` })],
    );
    expect(getMeta(Post).triggers).toMatchObject([{ on: 'beforeUpdate', of: ['body'] }]);
    removeEntity(Post);
  });

  it('should refuse a member two sections declare', () => {
    const Twice = defineEntity({ name: 'Twice', fields: { id: f.number().id(), title: f.string() } }).computed(() => ({
      title: f.string().as(sql`'x'`),
    }));
    expect(() => getMeta(Twice)).toThrow("'Twice.title' is declared twice: name each member once");
    removeEntity(Twice);
  });
});
