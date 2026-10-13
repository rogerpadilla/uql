# From Mongoose

**Not built.** A codemod mode writing UQL entities from Mongoose schemas, so a move off MongoDB starts from the schema a project already has. The data and the queries are covered: the entities run on both pools, a collection copies with `findManyStream` into `insertMany`, and a shadow read compares the two ([the recipe](https://uql-orm.dev/mongodb#moving-to-sql)).

## The problem

Every write-up of a Mongoose-to-Postgres move (Infisical 2024, Jsmon 2026, Voucherify 2021) rewrote the schema by hand before anything else, and the schema is where the facts live that a rewrite gets wrong: which field is a reference, which is required, the collection's real name. Mongoose pluralizes and lowercases a model's name (`User` reads `users`), so an entity named after the model reads an empty collection.

## Schemas, not documents

Two sources could say what an entity holds: the `Schema` definitions, or a sample of stored documents. The schema says what a sample cannot (`ref`, `required`, `enum`, `unique`, defaults), and a sample only adds what the schema calls `Mixed`. So the codemod reads schemas, through the TypeScript checker it already uses, and writes `Json` where a schema says `Mixed`.

## What it writes

One entity file per `model(name, schema)`, beside the Mongoose code, which stays until the move is done. Each entity reads the collection Mongoose wrote, so the same class serves the copy.

| Mongoose                                        | Entity                                                                                     |
| :---------------------------------------------- | :----------------------------------------------------------------------------------------- |
| `model('User', schema)`                         | `@Entity({ name: 'users' })`, the collection Mongoose derives or the schema's `collection` |
| `String`, `Number`, `Boolean`, `Date`, `BigInt` | the same `type`                                                                            |
| `Decimal128`, `UUID`, `Buffer`                  | `'decimal'`, `'uuid'`, `'blob'`                                                            |
| `_id` (an `ObjectId`)                           | `@Id({ type: String })`, the 24-hex text                                                   |
| `{ type: ObjectId, ref: 'User' }` on `author`   | `@Field({ name: 'author', references: () => User }) authorId` and `@ManyToOne author`      |
| a nested object or sub-schema, `[subSchema]`    | `Json<T>` / `Json<T>[]`, `T` written from the sub-schema                                   |
| `[String]`, `[Number]`                          | `Json<string[]>`, `Json<number[]>`, which `$push`, `$pull` and `$addToSet` update          |
| `Mixed`, `Map`                                  | `Json`                                                                                     |
| `required: true`                                | `nullable: false` and a `!` property; otherwise `?` and `\| null`                          |
| `enum`, `unique`, `index: true`                 | `enum`, `unique`, `@Index`                                                                 |
| `default: value`, `default: Date.now`           | `defaultValue: value`, `defaultValue: currentTimestamp`                                    |
| `default: () => ...`                            | `onInsert`                                                                                 |
| `timestamps: true`                              | `createdAt` and `updatedAt`, `defaultValue: currentTimestamp`, the latter with `onUpdate`  |

The foreign key keeps Mongoose's field name as its column, so the entity reads the documents as stored; a SQL table created from it has the same column, renamed later by a migration if wanted.

## What it leaves to you

Reported with what to do, as the codemod reports everything it cannot write safely:

- An array of references (`[{ type: ObjectId, ref }]`): on SQL it is a many-to-many with a junction table, which the documents do not have; the copy needs a step writing one.
- `refPath` (a reference to one of several models), discriminators, and a schema built at run time.
- Validators past `enum` (`min`, `max`, `match`, `validate`), which become `checks` only where a portable predicate says the same.
- Virtuals, `methods`, `statics`, query helpers, plugins and `pre`/`post` middleware: logic, which becomes `computed` fields, functions or [hooks](https://uql-orm.dev/entities/lifecycle-hooks) by hand.
- `__v`, which a `version` field replaces only if the app relied on it for concurrency.

Query call chains (`User.find(filter).sort().limit()`) stay out: their shapes vary too much to rewrite without guessing, and the [mapping table](https://uql-orm.dev/switching-to-uql) covers them.

## Before building

Measure on real schemas, public Mongoose projects and any at hand: how often each row above occurs, and how often a schema is built dynamically, which the codemod can only report. Cut every row the measure does not need.
