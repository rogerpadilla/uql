# defineEntity

An entity declared as data, whose row type is derived from its definition, so nothing is written twice and no
decorator or class is involved. Decorators stay as the class-first API. Settled by a spike (2026-10-23) on
uql's real types, against MikroORM 7.2.5, Drizzle 1.0.0-rc.5 and Prisma 8.0.0-rc.20 on the same model.

## The API

```ts
import { z } from 'zod';

// Any Standard Schema types the payload.
const Meta = z.object({ lang: z.string(), tags: z.array(z.string()).optional() });

export const Book = defineEntity({
  name: 'Book',
  fields: {
    id: f.number().id(),
    title: f.string(),
    subtitle: f.string().nullable(),
    stock: f.number().default(0),
    status: f.enum(['draft', 'published']),
    meta: f.json(Meta),
    version: f.version(),
    authorId: f.number(),
    editorId: f.number().nullable(),
  },
})
  .computed((book) => ({ shout: f.string().as(sql`upper(${book.title})`) }))
  .indexes((book, index) => [index([book.title], { include: [book.stock] })])
  .checks((book, check) => [check(sql`${book.stock} >= 0`, 'stocked')])
  .hooks({ beforeInsert: [(book) => void (book.stock ??= 0)] })
  .relations(
    (rel) => ({
      author: () => rel.manyToOne(Author, { references: (book) => book.authorId }),
      editor: () => rel.manyToOne(Author, { references: (book) => book.editorId, onDelete: 'SET NULL' }),
      tags: () => rel.manyToMany(Tag, { through: () => BookTag }),
    }),
    (book) => ({ tagCount: () => book.tags.count() }),
  );
export type Book = InstanceType<typeof Book>;
```

The decorated form reads the same columns: `@Field(f.string().nullable()) subtitle?: string | null`,
`@Computed((book) => f.string().as(sql`...`))`, and `@Entity({ indexes: (book, index) => [...] })`.

- A column is a builder, as in Zod: NOT NULL unless `.nullable()`, and only the options its type takes are
  methods, so `f.number().length(10)` does not compile. Both forms share it and one metadata pipeline.
- Derived: `.nullable()` gives `| null`; `.default()`, `.onInsert()` and `.autoIncrement()` make a column
  optional on insert and present on read; `.id()` names the key, `f.version()` makes it required on update,
  `f.enum()` gives the literal union, `.as()` makes it read-only. The row carries `[idKey]`, `[versionKey]`
  and `[filledKey]` itself, so every query and write type downstream is unchanged.
- Each section is a method, called once, in any order but `relations`, which comes last but for `filters`.
  Sections are applied on first read, so a section added after the entity was read throws.
- Behaviour on a row is a function of it (`label(author: Author)`): uql reads rows as plain objects, never
  class instances, so a method would be a type the runtime never honours.

## Why each shape is what it is

Each is forced by TypeScript inferring entities that point at each other.

| Shape                                                                  | Why                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Each relation is a thunk, `author: () => rel.manyToOne(...)`           | its target is read lazily; a thunked target alone (`entity: () => Author`) is TS2506                                                                                                                                                                                                                                                               |
| `relations` is last; its second callback's aggregate fields are thunks | a section after it would read a target while that target is inferred; an aggregate field reads the relations just inferred, lazily                                                                                                                                                                                                                 |
| Sections are methods, after `fields`                                   | the columns are fixed before any callback is checked, so no section infers the call again                                                                                                                                                                                                                                                          |
| A foreign key is a relation, never a column's target                   | A column naming its target reads that target while it is inferred, a cycle (TS7022, TS2615) for entities pointing at each other. A key shared by several entities is one relation helper typed by the key's shape, `(rel: RelationBuilder<{ workspaceId: string }>) => ({ workspace: () => rel.manyToOne(Workspace, ...) })`, which does not cycle |
| `mappedBy` names a member by key; a foreign key's type is carried      | typing by kind reads the target's property types mid-inference; its key type rides on its class, a symbol-keyed marker                                                                                                                                                                                                                             |
| `computed` is its own section                                          | a callback inside `fields` reads the columns being inferred, so its row is `any` (TS7006)                                                                                                                                                                                                                                                          |
| `indexes`, `checks`, `hooks` see the columns                           | the full row includes relations, which only exists once they are inferred                                                                                                                                                                                                                                                                          |
| `filters` may follow `relations`, and then sees the full row           | the relations are inferred by then, so a filter reading through them cycles nowhere, across files too                                                                                                                                                                                                                                              |
| An entry is a helper call, `index(columns, options)`                   | TypeScript checks a literal passed as an argument for excess keys, never one returned from a callback                                                                                                                                                                                                                                              |

## Measured

Instantiations, TypeScript 7, on `ts-orm-benchmark`'s definition model (the same entities in each ORM): the
first definition of it, then each further copy.

|                | First  | Each copy |
| -------------- | ------ | --------- |
| uql defined    | 4,417  | 1,416     |
| uql decorators | 8,836  | 2,010     |
| MikroORM 7     | 3,303  | 287       |
| Drizzle 0.45   | 14,367 | 4,908     |

A read over the same model, `findMany` with two columns, a filter and a populated to-one, each read a different
shape: uql's first costs ~4,100 (defined) or ~3,400 (decorators) and each further one ~150; MikroORM's first
~45,000 and each further one ~360. With its first read, uql's model costs less in total.

Per copy, the defined form's cost is mostly its relations (a many-to-one ~470 and a one-to-many ~200, ~220 of
that the foreign key's type check), then a computed column ~260 and an index ~150; a column is ~15. A decorated field costs
~100, ~60 of it the checks on its property (the column's `null`, the `filledKey` and `versionKey` brands, a named key),
which run per field because TypeScript infers each decorator's context. The relation options take `cascade`,
`onDelete` and `onUpdate` from their own non-generic types: picked off `RelationOptions<E, O>`, they made the first
defined entity instantiate it whole, ~2,700.

A filter through a to-many costs ~310 per defined entity and ~220 per decorated one (`ts.perf`, 200 of each), and
offering `filters` after the relations costs a defined entity declaring none ~4. MikroORM's `defineEntity` types a filter's
condition as a loose `Dictionary` to avoid this cycle (its GH #7440); Drizzle and Prisma have no entity filters.

The builders cost little because an option that does not apply is not a method, so nothing checks it, and the
flags ride on each column's type, so the row is one pass over the columns. MikroORM stays cheaper by typing less:
it checks fewer mistakes at definition (3 of the benchmark's 8 definition probes, against all of uql's).

What the rivals miss on the same model: MikroORM types a nullable `subtitle` as `string | null | undefined`.
Drizzle types a required to-one `| null` unless told otherwise, and a misspelt relation alias passes until
load. Prisma lets a Book with no author compile, and a populated required author with a nested select is
`| null`. Neither Drizzle nor Prisma has an optimistic lock.

## Verified by the spike

- Every pin in `definedEntity.test-d.ts`: four entities with a one-to-many/many-to-one cycle, a
  self-reference, many-to-many through a junction, enum, default, `onInsert`, version, computed column,
  and typos in column methods, `mappedBy`, index and check entries, computed refs and hooks, and an option
  its column cannot use. The same on TypeScript 5.7.
- On SQLite: registration, writes, reads, defaults, the computed column, version, a hook, relations
  across two files importing each other, and inheritance through `extends`.
- A rename of each member declared in `fields` or `relations` reaches every mention: queries, an insert
  payload, `mappedBy`, `references`, indexes, a hook body, and reads on another entity.

## Plan

1. Done. Columns are `f.*` builders in both forms, `defineEntity`'s options are chained sections, entries are
   helper calls, and a migration builder column is the same builder, named. `RelationRef` is `in out`.
2. Done. The defined form sharing `registerEntity` with `@Entity`, relations settled
   lazily in `getMeta`, hooks as functions, a JSON column's payload as a Standard Schema; pins, a suite on every engine,
   `ts.rename` over both fixtures and a `ts.perf` row, and aggregates over the relations.
3. Done. `defineEntity(Class, opts)`, the string-keyed definers, `defineIndex`/`defineTrigger`/`defineFilter`
   and `@Entity`'s `fields`, `relations`, `hooks` and `extends` are gone; the defined form took `schema`,
   `filters` and `triggers`, and `uql-codemod` rewrites a registered class into `defineEntity({ ... })`.
4. Done. A read row types its methods `never`, for decorated entities too: still an `E`, so generic code
   returning its rows compiles.
5. Done. Every defined entity's foreign key is a relation: a column never names its target, the relation's `references`
   is checked against the target's key type at compile time, and at run time by the kinds the join compares (a
   bigint and a number are one kind). Each cardinality takes only the options it joins by. `mappedBy` is checked
   by kind on first read, by decision: its kind is the target's relation, and reading the target's relations while
   they are inferred is the cycle the marker exists to avoid; carrying them on it too would cost every defined entity for a
   mistake the first read names.
