/**
 * What a schema derives and refuses: its row from the columns, each section typed by them once fixed, and the
 * relations last, entities pointing at each other in either order. Type-checked by `bun run ts` only.
 */
import { expectTypeOf } from 'vitest';
import { filledKey, idKey, type Json, sql, versionKey } from '../../index.js';
import { f } from '../column.js';
import { defineEntity } from './definition.js';

export const Book = defineEntity({
  name: 'Book',
  fields: {
    id: f.number().id(),
    title: f.string(),
    subtitle: f.string().nullable(),
    stock: f.number().default(0),
    status: f.enum(['draft', 'published']).default('draft'),
    meta: f.json({ lang: String }).nullable(),
    version: f.version(),
    authorId: f.number(),
    editorId: f.number().nullable(),
  },
})
  .computed((book) => ({ shout: f.string().as(sql`upper(${book.title})`) }))
  .indexes((book, index) => [index([book.title], { unique: true, where: { status: 'published' } })])
  .checks((book, check) => [check(sql`${book.stock} >= 0`)])
  .hooks({
    beforeInsert: [
      (book) => {
        book.stock ??= 0;
      },
    ],
  })
  .references({ editorId: () => Author })
  .relations((rel) => ({ author: () => rel.manyToOne(Author, { references: (book) => book.authorId }) }));
export type Book = InstanceType<typeof Book>;

export const Author = defineEntity({ name: 'Author', fields: { id: f.number().id(), name: f.string() } }).relations(
  (rel) => ({ books: () => rel.oneToMany(Book, { mappedBy: (book) => book.author }) }),
  (agg) => ({ bookCount: () => agg.books.count(), topStock: () => agg.books.max((book) => book.stock) }),
);
export type Author = InstanceType<typeof Author>;

export const Node = defineEntity({ name: 'Node', fields: { id: f.number().id(), parentId: f.number().nullable() } })
  .references({ parentId: () => Node })
  .relations((rel) => ({ parent: () => rel.manyToOne(Node, { references: (node) => node.parentId }) }));

export function row(book: Book, author: Author) {
  expectTypeOf(book.title).toEqualTypeOf<string>();
  expectTypeOf(book.subtitle).toEqualTypeOf<string | null | undefined>();
  expectTypeOf(book.status).toEqualTypeOf<'draft' | 'published'>();
  expectTypeOf(book.meta).toEqualTypeOf<Json<{ lang: string }> | null | undefined>();
  expectTypeOf(book.shout).toEqualTypeOf<string | undefined>();
  expectTypeOf(book.author).toEqualTypeOf<Author | undefined>();
  expectTypeOf(author.books).toEqualTypeOf<Book[] | undefined>();
  expectTypeOf(author.bookCount).toEqualTypeOf<number | undefined>();
  expectTypeOf(author.topStock).toEqualTypeOf<number | null | undefined>();
  expectTypeOf(book[idKey]).toEqualTypeOf<'id' | undefined>();
  expectTypeOf(book[versionKey]).toEqualTypeOf<'version' | undefined>();
  expectTypeOf(book[filledKey]).toEqualTypeOf<'stock' | 'status' | undefined>();
}

export const Mistakes = defineEntity({ name: 'Mistakes', fields: { id: f.number().id(), email: f.string() } })
  // @ts-expect-error an index option is checked, the helper's literal being an argument
  .indexes((mistakes, index) => [index([mistakes.email], { uniqe: true })])
  // @ts-expect-error and so is a predicate's column
  .checks((mistakes, check) => [check({ emial: '' })])
  // @ts-expect-error a foreign key names a column of the entity
  .references({ emial: () => Author })
  .relations(() => ({}));

defineEntity({
  name: 'InFields',
  // @ts-expect-error a foreign key is declared in `.references()`, once every entity exists
  fields: { id: f.number().id(), ownerId: f.references(() => Author) },
});

// @ts-expect-error a section takes only what its helper made
defineEntity({ name: 'Raw', fields: { id: f.number().id(), a: f.string() } }).indexes((r) => [{ columns: [r.a] }]);

defineEntity({ name: 'Last', fields: { id: f.number().id() } })
  .relations(() => ({}))
  // @ts-expect-error nothing follows the relations
  .indexes(() => []);
