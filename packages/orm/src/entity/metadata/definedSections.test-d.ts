/**
 * What a defined entity derives and refuses: its row from the columns, each section typed by them once fixed, and the
 * relations last but for filters, entities pointing at each other in either order. Type-checked by `bun run ts` only.
 */
import { expectTypeOf } from 'vitest';
import { filledKey, idKey, type Json, sql, versionKey } from '../../index.js';
import type { RelationBuilder, StandardSchemaV1 } from '../../type/index.js';
import { f } from '../column.js';
import { defineEntity } from './definition.js';

declare const langSchema: StandardSchemaV1<unknown, { lang: string }>;

export const Book = defineEntity({
  name: 'Book',
  fields: {
    id: f.number().id(),
    title: f.string(),
    subtitle: f.string().nullable(),
    stock: f.number().default(0),
    status: f.enum(['draft', 'published']).default('draft'),
    meta: f.json(langSchema).nullable(),
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
  .relations((rel) => ({ author: () => rel.manyToOne(Author, { references: (book) => book.authorId }) }));
export type Book = InstanceType<typeof Book>;

export const Author = defineEntity({ name: 'Author', fields: { id: f.number().id(), name: f.string() } }).relations(
  (rel) => ({ books: () => rel.oneToMany(Book, { mappedBy: (book) => book.author }) }),
  (author) => ({ bookCount: () => author.books.count(), topStock: () => author.books.max((book) => book.stock) }),
);
export type Author = InstanceType<typeof Author>;

export const Node = defineEntity({
  name: 'Node',
  fields: { id: f.number().id(), parentId: f.number().nullable() },
}).relations((rel) => ({ parent: () => rel.manyToOne(Node, { references: (node) => node.parentId }) }));

export function row(book: Book, author: Author) {
  expectTypeOf(book.title).toEqualTypeOf<string>();
  expectTypeOf(book.subtitle).toEqualTypeOf<string | null | undefined>();
  expectTypeOf(book.status).toEqualTypeOf<'draft' | 'published'>();
  expectTypeOf(book.meta).toEqualTypeOf<Json<{ lang: string }> | null | undefined>();
  expectTypeOf(book.shout).toEqualTypeOf<string>();
  expectTypeOf(book.author).toEqualTypeOf<Author | undefined>();
  expectTypeOf(author.books).toEqualTypeOf<Book[] | undefined>();
  expectTypeOf(author.bookCount).toEqualTypeOf<number>();
  expectTypeOf(author.topStock).toEqualTypeOf<number | null>();
  expectTypeOf(book[idKey]).toEqualTypeOf<'id' | undefined>();
  expectTypeOf(book[versionKey]).toEqualTypeOf<'version' | undefined>();
  expectTypeOf(book[filledKey]).toEqualTypeOf<'stock' | 'status' | undefined>();
}

export const Mistakes = defineEntity({ name: 'Mistakes', fields: { id: f.number().id(), email: f.string() } })
  // @ts-expect-error an index option is checked, the helper's literal being an argument
  .indexes((mistakes, index) => [index([mistakes.email], { uniqe: true })])
  // @ts-expect-error and so is a predicate's column
  .checks((mistakes, check) => [check({ emial: '' })])
  // @ts-expect-error a defined entity has no `.references()` section: a foreign key is a relation
  .references({ emial: () => Author })
  .relations(() => ({}));

defineEntity({
  name: 'InFields',
  // @ts-expect-error a column names no target: a foreign key is a relation in `.relations()`
  fields: { id: f.number().id(), ownerId: f.references(() => Author) },
});

// @ts-expect-error a section takes only what its helper made
defineEntity({ name: 'Raw', fields: { id: f.number().id(), a: f.string() } }).indexes((r) => [{ columns: [r.a] }]);

defineEntity({ name: 'Last', fields: { id: f.number().id() } })
  .relations(() => ({}))
  // @ts-expect-error nothing follows the relations
  .indexes(() => []);

defineEntity({ name: 'HooksLast', fields: { id: f.number().id() } })
  .relations(() => ({}))
  // @ts-expect-error hooks are declared before the relations, only filters follow them
  .hooks({});

/** A computed field read only when a query names it is optional on the row; a default read always carries it. */
export const Lazy = defineEntity({ name: 'Lazy', fields: { id: f.number().id() } }).computed((lazy) => ({
  eagerCount: f.number().as(sql`${lazy.id}`),
  lazyCount: f
    .number()
    .eager(false)
    .as(sql`${lazy.id}`),
}));
expectTypeOf<InstanceType<typeof Lazy>['eagerCount']>().toEqualTypeOf<number>();
expectTypeOf<InstanceType<typeof Lazy>['lazyCount']>().toEqualTypeOf<number | undefined>();

/** A foreign key shared by several entities is one relation helper, typed by the key's shape rather than its entity. */
const workspaceOf = (rel: RelationBuilder<{ readonly workspaceId: string }>) => ({
  workspace: () => rel.manyToOne(SharedWorkspace, { references: (row) => row.workspaceId }),
});
export const SharedWorkspace = defineEntity({ name: 'SharedWorkspace', fields: { id: f.uuid().id() } }).relations(
  (rel) => ({ docs: () => rel.oneToMany(SharedDoc) }),
);
export const SharedDoc = defineEntity({
  name: 'SharedDoc',
  fields: { id: f.uuid().id(), workspaceId: f.uuid().narrow<string>() },
}).relations((rel) => workspaceOf(rel));
expectTypeOf<InstanceType<typeof SharedDoc>['workspace']>().toMatchTypeOf<{ readonly id: string } | undefined>();
expectTypeOf<InstanceType<typeof SharedWorkspace>['docs']>().toMatchTypeOf<
  readonly InstanceType<typeof SharedDoc>[] | undefined
>();
