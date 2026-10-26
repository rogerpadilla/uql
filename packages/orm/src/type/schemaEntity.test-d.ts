/**
 * An entity declared by its schema: the row type is derived from it, so nothing is written twice, and a class
 * extending it adds behaviour. Type-checked by `bun run ts` only.
 */
import { expectTypeOf } from 'vitest';
import { f } from '../entity/column.js';
import { defineEntity } from '../entity/metadata/definition.js';
import { Entity, Field, type Json, type Querier, type StandardSchemaV1 } from '../index.js';
import { currentTimestamp, sql } from '../util/index.js';

export const Author = defineEntity({
  name: 'Author',
  fields: {
    id: f.number().id(),
    name: f.string(),
    bio: f.string().nullable(),
    mentorId: f.number().nullable(),
    createdAt: f.date().default(currentTimestamp),
  },
})
  .indexes((author, index) => [index([author.name])])
  .hooks({
    beforeInsert: [
      (author) => {
        author.bio ??= null;
      },
    ],
  })
  .relations(
    (rel) => ({
      mentor: () => rel.manyToOne(Author, { references: (author) => author.mentorId }),
      books: () => rel.oneToMany(Book, { mappedBy: (book) => book.author }),
    }),
    (author) => ({
      bookCount: () => author.books.count(),
      topStock: () => author.books.max((book) => book.stock),
      // @ts-expect-error a sum reads a numeric column, and a title is text
      titleSum: () => author.books.sum((book) => book.title),
      // A derived field may combine an own column with an aggregate, as a `dueBy` does.
      stockGap: () =>
        f
          .number()
          .nullable()
          .as(sql`${author.books.max((book) => book.stock)} - ${author.id}`),
    }),
  );
export type Author = InstanceType<typeof Author>;

/** Behaviour over a row is a function of it: a read row is plain data. */
export const label = (author: Author): string => `${author.name} (${author.books?.length ?? 0})`;

export const Book = defineEntity({
  name: 'Book',
  fields: {
    id: f.number().id(),
    title: f.string(),
    subtitle: f.string().nullable(),
    stock: f.number().default(0),
    status: f.enum(['draft', 'published']),
    version: f.version(),
    authorId: f.number(),
  },
})
  .computed((book) => ({
    shout: f
      .string()
      .nullable()
      .as(sql`upper(${book.title})`),
  }))
  .relations((rel) => ({
    author: () => rel.manyToOne(Author, { references: (book) => book.authorId }),
    tags: () => rel.manyToMany(Tag, { through: () => BookTag }),
  }));

export const Tag = defineEntity({
  name: 'Tag',
  fields: { id: f.number().id(), label: f.string().unique() },
});

export const BookTag = defineEntity({
  name: 'BookTag',
  fields: {
    bookId: f.number().id(),
    tagId: f.number().id(),
  },
}).relations((rel) => ({
  book: () => rel.manyToOne(Book, { references: (link) => link.bookId }),
  tag: () => rel.manyToOne(Tag, { references: (link) => link.tagId }),
}));

declare const querier: Querier;

export async function rowsAreDerived() {
  const [book] = await querier.findMany(Book, { $select: { title: true, subtitle: true, status: true } });
  const title: string = book.title;
  const subtitle: string | null | undefined = book.subtitle;
  const status: 'draft' | 'published' = book.status;
  // @ts-expect-error a nullable column reads `null`
  const definite: string = book.subtitle;
  // @ts-expect-error not selected
  book.stock;
  return [title, subtitle, status, definite];
}

export async function relationsAreTypedThroughCycles() {
  const [book] = await querier.findMany(Book, {
    $select: { title: true },
    $populate: { author: { $select: { name: true }, $required: true }, tags: true },
  });
  const name: string = book.author.name;
  const labels: string[] = book.tags.map((tag) => tag.label);
  const [author] = await querier.findMany(Author, { $populate: { books: true, mentor: true } });
  const count: number = author.books.length;
  return [name, labels, count, label(author)];
}

export async function writesReadTheDerivedKeys() {
  await querier.insertOne(Book, { title: 'a', status: 'draft', authorId: 1 });
  // @ts-expect-error `title` is NOT NULL with no default
  await querier.insertOne(Book, { status: 'draft', authorId: 1 });
  // @ts-expect-error not one of the enum
  await querier.insertOne(Book, { title: 'a', status: 'archived', authorId: 1 });
  // @ts-expect-error computed, never written
  await querier.insertOne(Book, { title: 'a', status: 'draft', authorId: 1, shout: 'A' });
  await querier.updateOneById(Book, 1, { title: 'b', version: 1 });
  // @ts-expect-error an update says which version it read
  await querier.updateOneById(Book, 1, { title: 'b' });
  await querier.insertOne(Author, { name: 'a' });
  await querier.findOneById(BookTag, { bookId: 1, tagId: 2 });
}

export function definitionsAreChecked() {
  defineEntity({
    name: 'Typo',
    fields: { id: f.number().id() },
  })
    // @ts-expect-error a column the schema does not declare
    .indexes((typo, index) => [index([typo.idd])]);
  defineEntity({
    name: 'BadInverse',
    fields: { id: f.number().id() },
  })
    // @ts-expect-error `mappedBy` names a member of the target
    .relations((rel) => ({ books: () => rel.oneToMany(Book, { mappedBy: (book) => book.auther }) }));
  defineEntity({
    name: 'BadComputed',
    fields: { id: f.number().id(), title: f.string().nullable() },
  }).computed((badComputed) => ({
    shout: f
      .string()
      .nullable()
      // @ts-expect-error a column the schema does not declare
      .as(sql`upper(${badComputed.titel})`),
  }));
  defineEntity({
    name: 'BadHook',
    fields: { id: f.number().id(), title: f.string().nullable() },
  })
    // @ts-expect-error a hook reads the row's columns
    .hooks({ beforeInsert: [(row) => row.titel] });
  defineEntity({
    name: 'BadOption',
    // @ts-expect-error an option no column takes
    fields: { id: f.number().id().nulable() },
  });
  defineEntity({
    name: 'BadFamily',
    fields: {
      id: f.number().id(),
      // @ts-expect-error 'length' belongs to a string column
      count: f.number().nullable().length(10),
      // @ts-expect-error a version starts at 0 and the lock owns it from there
      version: f.version().default(7),
      exact: f.decimal(30, 2).nullable(),
    },
  });
}

declare const settingsSchema: StandardSchemaV1<
  unknown,
  { theme: string; rating: number; nickname?: string; billing: { plan: string } }
>;
declare const tagsSchema: StandardSchemaV1<unknown, string[]>;

/** An untyped `json` column reads any path, as a bare `Json` does; a Standard Schema types the payload. */
export const Profiled = defineEntity({
  name: 'Profiled',
  fields: {
    id: f.number().id(),
    loose: f.json().nullable(),
    settings: f.json(settingsSchema).nullable(),
    tags: f.jsonb(tagsSchema).nullable(),
  },
}).indexes((profiled, index) => [
  index([profiled.loose['anything']['deep']]),
  index([profiled.settings.theme, profiled.settings.billing.plan, profiled.settings.nickname]),
  index([{ column: profiled.settings.rating, type: Number }]),
  index([{ column: profiled.tags, type: [String], charLength: 64 }]),
  // @ts-expect-error a payload typed by its schema checks its paths
  index([profiled.settings.them]),
]);

export async function readsPayload(querier: Querier) {
  const [row] = await querier.findMany(Profiled, { $where: { 'settings.theme': 'dark' } });
  expectTypeOf(row.settings?.theme).toEqualTypeOf<string | undefined>();
  expectTypeOf(row.settings?.rating).toEqualTypeOf<number | undefined>();
  expectTypeOf(row.settings?.billing.plan).toEqualTypeOf<string | undefined>();
  expectTypeOf(row.settings?.nickname).toEqualTypeOf<string | undefined>();
  expectTypeOf(row.tags?.[0]).toEqualTypeOf<string | undefined>();
  expectTypeOf(row.loose).toEqualTypeOf<Json | null | undefined>();
}

/** An aggregate over a to-many is declared with it, typed by its target's columns, and reads as a computed column. */
export async function aggregatesReadAsColumns() {
  const [author] = await querier.findMany(Author, { $select: { bookCount: true, topStock: true } });
  const count: number | undefined = author.bookCount;
  const top: number | null | undefined = author.topStock;
  await querier.findMany(Author, { $sort: { bookCount: 'desc' }, $where: { bookCount: { $gt: 1 } } });
  // @ts-expect-error an aggregate is computed, never written
  await querier.insertOne(Author, { name: 'a', bookCount: 1 });
  return [count, top];
}

/** Each cardinality takes the options it can join by, and a to-many naming none is mapped back. */
export const Shelf = defineEntity({
  name: 'Shelf',
  fields: { id: f.number().id(), bookId: f.number().nullable() },
}).relations((rel) => ({
  books: () => rel.oneToMany(Book),
  // @ts-expect-error a many-to-one holds the foreign key, so it names it
  noKey: () => rel.manyToOne(Book, {}),
  // @ts-expect-error a many-to-one joins by its own column, not a junction
  viaJunction: () => rel.manyToOne(Book, { references: (shelf) => shelf.bookId, through: () => BookTag }),
  // @ts-expect-error a many-to-one is the owning side, mapped by nothing
  mapped: () => rel.manyToOne(Book, { mappedBy: (book) => book.author }),
  // @ts-expect-error the target's rows may be other rows' too, so the owner cascades 'persist' only
  cascaded: () => rel.manyToOne(Book, { references: (shelf) => shelf.bookId, cascade: true }),
  // @ts-expect-error a to-many holds no foreign key of its own, so it pairs the columns
  oneColumn: () => rel.oneToMany(Book, { references: (shelf) => shelf.id }),
  // @ts-expect-error a junction or the columns, never both
  both: () => rel.manyToMany(Tag, { through: () => BookTag, mappedBy: (tag) => tag.id }),
  // @ts-expect-error a one-to-one names its join
  unjoined: () => rel.oneToOne(Book),
}));

expectTypeOf<NonNullable<InstanceType<typeof Shelf>['books']>>().toEqualTypeOf<InstanceType<typeof Book>[]>();

/** An entity extending a schema aggregates over the relations it inherits. */
export const Anthology = defineEntity({
  name: 'Anthology',
  extends: Author,
  fields: {},
}).relations(
  () => ({}),
  (anthology) => ({
    lowStock: () => anthology.books.min((book) => book.stock),
    // @ts-expect-error `title` is no number to add up
    titleSum: () => anthology.books.sum((book) => book.title),
  }),
);

defineEntity({ name: 'EarlyCount', fields: { id: f.number().id() } }).computed((early) => ({
  // @ts-expect-error a computed field reads its own columns, never a relation
  n: early.books.count(),
}));

export async function inheritedRelationsAggregate() {
  const [anthology] = await querier.findMany(Anthology, { $select: { lowStock: true, bookCount: true } });
  const low: number | null | undefined = anthology.lowStock;
  const count: number | undefined = anthology.bookCount;
  return [low, count];
}

/** A foreign key holds its target's key, read beside the target so a relation through a cycle can check it. */
export const Review = defineEntity({
  name: 'Review',
  fields: {
    id: f.number().id(),
    bookId: f.number(),
    slug: f.string().nullable(),
    replyToId: f.number().nullable(),
  },
}).relations((rel) => ({
  book: () => rel.manyToOne(Book, { references: (review) => review.bookId }),
  // @ts-expect-error `slug` is a string, and a book's key a number
  misjoined: () => rel.manyToOne(Book, { references: (review) => review.slug }),
  // @ts-expect-error a composite key is joined column by column
  link: () => rel.manyToOne(BookTag, { references: (review) => review.bookId }),
  linkByPairs: () =>
    rel.manyToOne(BookTag, {
      references: () => [
        { local: 'bookId', foreign: 'bookId' },
        { local: 'replyToId', foreign: 'tagId' },
      ],
    }),
  replyTo: () => rel.manyToOne(Review, { references: (review) => review.replyToId }),
}));

/** A class declares its key's type outright, so a relation reads it off the class. */
class Publisher {
  id?: number;
  name?: string;
}
defineEntity({
  name: 'Imprint',
  fields: { id: f.number().id(), publisherId: f.number().nullable(), label: f.string().nullable() },
}).relations((rel) => ({
  publisher: () => rel.manyToOne(Publisher, { references: (imprint) => imprint.publisherId }),
  // @ts-expect-error `label` is a string, and a publisher's key a number
  mislabeled: () => rel.manyToOne(Publisher, { references: (imprint) => imprint.label }),
}));

/** An inherited key is the one a relation to the subtype holds. */
export const Ebook = defineEntity({ name: 'Ebook', extends: Book, fields: { format: f.string().nullable() } });
defineEntity({
  name: 'Download',
  fields: { id: f.number().id(), ebookId: f.number().nullable(), code: f.string().nullable() },
}).relations((rel) => ({
  ebook: () => rel.manyToOne(Ebook, { references: (download) => download.ebookId }),
  // @ts-expect-error `code` is a string, and an ebook's inherited key a number
  miscoded: () => rel.manyToOne(Ebook, { references: (download) => download.code }),
}));

defineEntity({
  name: 'Misnumbered',
  // @ts-expect-error a String column cannot hold a numeric member
  fields: { id: f.number().id(), status: f.enum(['draft', 2]).nullable() },
});

defineEntity({
  name: 'Misshapen',
  // @ts-expect-error a shape describes a JSON column's payload, so only a JSON column takes one
  fields: { id: f.number().id(), title: f.string().nullable().shape({ lang: String }) },
});

defineEntity({
  name: 'Watched',
  fields: { id: f.number().id(), title: f.string().nullable(), live: f.boolean().nullable() },
})
  // @ts-expect-error a trigger watches the schema's columns
  .triggers((watched, trigger) => [trigger({ on: 'beforeUpdate', of: [watched.titl], run: () => sql`select 1` })])
  .filters({
    // @ts-expect-error a filter's predicate names the schema's columns
    live: { where: { lve: true } },
  });

/** A section takes only what its helper made: TypeScript never checks a literal a callback returns, so `uniqe` would pass. */
defineEntity({ name: 'Bare', fields: { id: f.number().id(), title: f.string() } })
  // @ts-expect-error an index is `index(columns, options)`, never a bare literal
  .indexes((bare) => [{ columns: [bare.title], uniqe: true }])
  // @ts-expect-error a check is `check(where, name)`
  .checks((bare) => [{ where: { title: { $ne: '' } } }])
  // @ts-expect-error a trigger is `trigger({ ... })`
  .triggers((bare) => [{ on: 'beforeUpdate', of: [bare.title], run: () => sql`select 1` }]);

@Entity({
  // @ts-expect-error and in `@Entity`'s options alike
  indexes: (bare) => [{ columns: [bare.title] }],
})
export class BareDecorated {
  @Field(f.number().id()) id?: number;
  @Field(f.string()) title?: string;
}

/** Columns paired by hand hold the same type, as a single foreign key holds its target's key. */
export const Coded = defineEntity({
  name: 'Coded',
  fields: { id: f.number().id(), code: f.string() },
});
export const CodeHolder = defineEntity({
  name: 'CodeHolder',
  fields: { id: f.number().id(), coded: f.string().nullable(), counted: f.number().nullable() },
}).relations((rel) => ({
  byCode: () => rel.manyToOne(Coded, { references: (h, c) => [{ local: h.coded, foreign: c.code }] }),
  // @ts-expect-error a number column cannot hold a text code
  misCoded: () => rel.manyToOne(Coded, { references: (h, c) => [{ local: h.counted, foreign: c.code }] }),
}));

export const Pointed = defineEntity({ name: 'Pointed', fields: { id: f.string().id() } });
export const Pointing = defineEntity({
  name: 'Pointing',
  fields: {
    id: f.number().id(),
    pointedId: f.string().nullable(),
  },
}).relations((rel) => ({
  pointed: () => rel.manyToOne(Pointed, { references: (pointing) => pointing.pointedId }),
}));

export const Shouting = defineEntity({
  name: 'Shouting',
  fields: {
    id: f.number().id(),
    // @ts-expect-error a computed column belongs in `.computed()`, else the row would make an insert write it
    shout: f.string().as(sql`'x'`),
  },
});

/** A foreign key is a relation: a column never names its target, and a schema section names none. */
export const RelationOnlyNode = defineEntity({
  name: 'RelationOnlyNode',
  fields: { id: f.number().id(), parentId: f.number().nullable() },
}).relations((rel) => ({
  parent: () => rel.manyToOne(RelationOnlyNode, { references: (node) => node.parentId }),
}));

export const Ledger = defineEntity({ name: 'Ledger', fields: { id: f.number().id() } });
/** A bigint foreign key over a number key: the runtime holds both as numbers, so the type takes either way. */
export const BigintEntry = defineEntity({
  name: 'BigintEntry',
  fields: { id: f.number().id(), ledgerId: f.bigint().nullable() },
}).relations((rel) => ({
  ledger: () => rel.manyToOne(Ledger, { references: (entry) => entry.ledgerId }),
}));
export const NumberEntry = defineEntity({
  name: 'NumberEntry',
  fields: { id: f.bigint().id(), ledgerId: f.number().nullable() },
}).relations((rel) => ({
  ledger: () => rel.manyToOne(Ledger, { references: (entry) => entry.ledgerId }),
}));

/** A join holds the kind a key is, so a text column joins on an enum's literal key: the runtime compares kinds. */
export const LiteralKey = defineEntity({ name: 'LiteralKey', fields: { code: f.enum(['a', 'b']).id() } });
export const TextHolder = defineEntity({
  name: 'TextHolder',
  fields: { id: f.number().id(), codeId: f.string().nullable() },
}).relations((rel) => ({
  literal: () => rel.manyToOne(LiteralKey, { references: (holder) => holder.codeId }),
}));

const AbstractHolder = defineEntity({ name: 'AbstractHolder', abstract: true, fields: { id: f.number().id() } });
defineEntity({ name: 'HoldsAbstract', fields: { id: f.number().id(), holderId: f.number() } })
  // @ts-expect-error a relation needs a table to join, and an abstract base is never one
  .relations((rel) => ({ holder: () => rel.manyToOne(AbstractHolder, { references: (r) => r.holderId }) }));
