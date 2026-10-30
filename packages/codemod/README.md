<a href="https://uql-orm.dev">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/rogerpadilla/uql/main/assets/logo-dark.svg">
    <img src="https://raw.githubusercontent.com/rogerpadilla/uql/main/assets/logo.svg" alt="UQL" width="72" height="72">
  </picture>
</a>

# uql-codemod

Rewrites a [uql-orm](https://uql-orm.dev) project across the breaking changes that can be made mechanically. Dry run first:

```sh
npx uql-codemod --dry-run
npx uql-codemod
```

| Flag               |                                                                                                                                               |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `--project=<path>` | The `tsconfig.json` to read, `./tsconfig.json` by default. It has to cover your entities: the type checker is what says each property's type. |
| `--dry-run`        | Report what would change and touch nothing.                                                                                                   |
| `--include=<a,b>`  | Only files whose path contains one of these fragments.                                                                                        |

Only `--flag=value` is read, and anything unrecognised is an error. It exits `0` when nothing is left for you, `1` when something is, and `2` when it could not start. Edits are spliced into the text, so everything it does not touch stays byte for byte as written.

## What it rewrites

- `virtual` to `computed` (on `@Field` and in `defineEntity`'s `fields`), a check's `expression` and a filter's `condition` to `where` (`@Entity`, `defineEntity`, `@Filter`), `raw('...')` to the `sql` tagged template, and a second argument onto `.as()`.
- A column's options to its builder, last, after the rewrites above: `@Id()` and `@Field({ type: String, nullable: true, length: 80 })` to `@Field(f.number().id())` and `@Field(f.string().nullable().length(80))`, a NOT NULL column losing its `nullable: false`, `computed` to `@Computed((row) => f.string().as(...))` or `@Computed((row) => row.books.count())`, and a defined entity's `fields` likewise; its other options to the sections chained after it, and its `aggregates` to `.relations()`' second callback. A defined column's foreign key becomes a relation: its `references` is dropped where a relation joins on the column (by `(order) => order.customerId`, by `[{ local, foreign }]` pairs, or as the ORM infers the one column naming its target, written into it), its `onDelete` moved into that relation, and where none joins, a `manyToOne` named as the column less its `Id` is written for it: `customer: () => rel.manyToOne(Customer, { references: (order) => order.customerId })`. Then each index, check and trigger entry, in `@Entity` and `defineEntity`, goes to the helper its callback is handed: `(post, index) => [index([post.title], 'by_title')]`.
- A migration's columns to the same methods: `table.string('email', { length: 80, nullable: true })` to `table.string('email').length(80).nullable()`, `.defaultValue()` to `.default()`, `.primaryKey()` to `.id()`, `.computed()` to `.as()`, and `.notNullable()` dropped.
- `@Index`, `@Trigger` and `@Filter` into `@Entity`'s `indexes`, `triggers` and `filters`, each decorator's comments kept above its entry; a class with no `@Entity` becomes `@Entity({ abstract: true, ... })`, a base that is never a table.
- Members named by string to callbacks: `mappedBy: 'author'` to `(post) => post.author`, and `include`, `references` and `@Entity`/`defineEntity`'s `indexes` and `hooks` likewise: `{ columns: (post) => [post.title] }`.
- `references: (post) => post.authorId` on a to-one (`@ManyToOne`, `@OneToOne`, or in `defineEntity`) that names no foreign key, declaring `@Field({ references: () => User }) authorId` first on a decorated class that has no such column, typed as the key it points at.
- A partial-index `where` string to `sql`, importing it, on entities and in the migration builder.
- A class registered with `defineEntity(Post, { ... })` to the `defineEntity({ ... })` call it stands for, whole or not at all: `export const Post = defineEntity({ name: 'Post', fields })` with its sections chained, as a defined entity's options are above, and `export type Post = InstanceType<typeof Post>`. The class is removed and a table it named kept as `table`; a field stating no `type` takes the one its property declares (`authorId?: number | null` is `f.number().nullable()`), each relation becomes `author: () => rel.manyToOne(User, { ... })`, a relation aggregate an aggregate field (`(post) => ({ total: () => post.comments.count() })`), a hook's method a function of the row (`this` read as the row), and the same class's `defineField`, `defineId`, `defineRelation`, `defineHook`, `defineIndex`, `defineTrigger` and `defineFilter` are folded in.
- A JSON index entry to the path read off the column's ref: `{ column: post.kind, jsonPath: { path: 'theme', type: Number } }` to `{ column: post.kind.theme, type: Number }`, and a `jsonArray`'s element type to `type: [String]`.
- `col('cost')` to the ref it names, ``(product) => sql`${product.cost}` `` in a `computed` and `refs(Item).cost` in a statement, and `$lock: { wait: 'skip' }` to `{ $wait: 'skip' }`, or to `true` for `{}` and a `'block'` wait.
- `$exclude` to a `$select` leaving its fields out: `$exclude: { password: true }` to `$select: { password: false }`, at every depth of `$populate`.
- An aggregate's `$agg` to `$select`, and each field it or `$text`'s `$fields` names to a key: `{ $sum: { amount: true } }`.
- An upsert's conflict keys to a query, `upsertOne(User, { email: true }, row)` to `upsertOne(User, { $conflict: { email: true } }, row)`, and its update, `{ update: X }` options or a fourth argument, to the query's `$update: X`, in `upsertOne`, `upsertMany` and a trigger's `upsertInto`; `const { id } = await upsertOne(...)` to `const id`.
- Renamed exports, at the import and every use: `raw` to `sql`, `QueryWhereMap` to `QueryWhere`, `IndexColumnSchema` to `IndexEntry`, `IndexColumnModifiers` to `IndexEntryModifiers`, `RelationKeyMap` to `KeyMap`, `FilterCondition` to `FilterWhere`, `SqlMigrationModuleOptions` to `MigrationModuleOptions`, `buildSqlQuerierMigrationModule` to `buildMigrationModule`, `QueryDialect` to `SqlQueryDialect`, `EngineFeatures` to `DialectFeatures`, `KnownMigratorDialect` to `DialectName`, `QueryConflictPaths` to `QueryConflictKeys`, `D1Preparer`/`D1Database` to `D1Queryable`, and the removed driver classes to the one each extended: `PgDialect`/`NeonDialect`/`PgliteDialect` to `PostgresDialect`, `CrdbQuerier`/`NeonQuerier` to `PgQuerier`, `LibsqlQuerier`/`TursoQuerier` to `HranaQuerier`, `TursoLocalQuerier` to `SqliteQuerier` and `TursoDatabase` to `SqliteDatabase`, `MySql2Dialect` to `MySqlDialect`, `MongodbNativeDialect` to `MongoDialect`, `Sqlite3QuerierPool` to `SqliteQuerierPool`, the migration builder's `I`-prefixed types to the unprefixed name (`IColumnBuilder`/`IColumnFactory`, and `uql-orm/migrate`'s `ColumnBuilder`/`ColumnFactory`, to `TableColumnBuilder`/`TableColumnFactory`), moving the import to the entry that exports it; and `MongoQuerier`, `isMongoQuerier` and `MongoSchemaIntrospector` to `uql-orm/mongodb`.
- Imports off `uql-orm/maria`, `uql-orm/mongo` and `uql-orm/bunSql` to `uql-orm/mariadb`, `uql-orm/mongodb` and `uql-orm/bun-sql`, and off `uql-orm/type`, `uql-orm/dialect`, `uql-orm/entity`, `uql-orm/querier` and `uql-orm/namingStrategy` to `uql-orm`.
- The `[idKey]?: '...'` brand, and its import, on a key not called `id`, `_id` or `uuid` and on every composite.

## What it leaves to you

Reported with what to do, never guessed:

- `target: esnext`, the one target that leaves decorators untransformed, a value inherited through `extends`, and `experimentalDecorators`/`emitDecoratorMetadata` in `tsconfig.json`, which the standard spec replaces: remove those by hand.
- `@Log()`, `@Serialized()`, `@Transactional()` and `@InjectQuerier()`: a `@Transactional()` method becomes a `pool.transaction()` around its body, and only you know which pool.
- An export removed with no one-to-one replacement (`setQuerierPool`, `getQuerier`, `augmentWhere`, `AbstractPgQuerier`, ...), an internal the root no longer exports (`AbstractSqlQuerier`, `fieldOf`, ...), the migration storages, and any import from `uql-orm/util` the root does not export (`refs`, ... move to `uql-orm`).
- A value it cannot read: options passed as a variable or a spread, a list that is not a literal, a key under a computed name.
- An `$exclude` it cannot read, or one beside a `$select`: merge it in, each field as `field: false`.
- A to-one onto a composite key: declare a column per key and pair each with it in `references`.
- A to-one whose `<relation>Id` is not a declared column: an undecorated property, or a `defineEntity` whose `fields` leave it out.
- A class `defineEntity` registers that `defineEntity({ ... })` cannot declare as it is: one that extends another class, has a method no hook runs or is decorated as well; options it cannot read, or a column or section its chain cannot write; a class registered in another file, or an entity that is no class declared in the file. It is left as written, each reason reported.
- A defined column's foreign key no relation can take: one whose relation name (the column less its `Id`) is taken or cannot be read off it, a key with no type of its own (`f.references(() => Order)`), or an `onDelete` its relation contradicts.
- A definer on a decorated class (`defineIndex(Post, ...)`), and `@Entity`'s `fields`, `relations`, `hooks` and `extends`: each is a decorator, or the class's own `extends`, now.
- A property typed more narrowly than `defineEntity` derives, as a note: a `Json<T>` column wants a Standard Schema, a string-literal union `enum`.
- A partial-index `where` string that interpolates, since `sql` would bind what the template spliced in.
- A JSON index entry whose `path` is not a string literal, or that takes an option besides `path`, `type` and `length`.
- A `col()` whose entity it cannot tell: a raw built apart from its query, one under a relation filter, or a column no field maps.
- SQL in a definition that names a column by hand, as a note: a rename reaches a callback's refs, ``(user) => sql`lower(${user.email})` ``, and never the text.
- A file that already names something the codemod would write (`sql`, `refs`, `idKey`, `f`, a renamed export): left unchanged and reported, since the new import would shadow it or be shadowed.
- A property whose type maps to no column (`Json<T>`, a vector, a mixed union).
- A column option it cannot write as a method: a `shape` a JSON column no longer takes, a migration column's options passed as a variable, or a flag such as `unique: isUnique` that no literal states.
- A `@Field`/`@Id` with no `type`, and a relation with no `entity`: declare the column as a builder (`f.string()`) and name the target (`entity: () => Target`). A branded string id's column, `f.uuid()` or `f.string()`, is yours to pick.
- `Relation<T>` imported from `uql-orm`, which no longer exports it: write the property's type without it, and drop the import.

## After it runs

`tsc` is the rest of the migration: what the codemod wrote is checked against the property it describes, so anything it got wrong is a compile error. See the [upgrade guide](https://uql-orm.dev/upgrade-guide).

## Why TypeScript 6

Reading each property's type needs the checker, so TypeScript is a runtime dependency. 7's entry point exports no compiler API yet and has no standalone parser, which the `tsconfig.json` check needs to read its comments; revisit once that API is stable.

## License

MIT
