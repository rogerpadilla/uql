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

- `type` on a `@Field`/`@Id` that has none, from the property's declared type; not beside `references`, whose column comes from the key it points at.
- `entity: () => X` on a bare relation decorator, and `Relation<T>` to `T`, its import going with the last use.
- `virtual` to `computed`, and `raw('sql')` to the tagged template.
- Members named by string to key-map callbacks: `mappedBy: 'author'` to `(post) => post.author`, and `@Index`, `include`, `references` and `@Entity`/`defineEntity`'s `indexes` and `hooks` likewise: `@Index((post) => [post.title])`.
- An aggregate's `$agg` to `$select`, and each field it or `$text`'s `$fields` names to a key: `{ $sum: { amount: true } }`.
- Renamed exports, at the import and every use: `QueryWhereMap` to `QueryWhere`, `RelationKeyMap` to `KeyMap`, and the removed driver classes to the one each extended: `PgDialect`/`NeonDialect`/`PgliteDialect` to `PostgresDialect`, `CrdbQuerier`/`NeonQuerier` to `PgQuerier`, `LibsqlQuerier`/`TursoQuerier` to `HranaQuerier`, `MySql2Dialect` to `MySqlDialect`, `MongodbNativeDialect` to `MongoDialect`, moving the import to the entry that exports it.
- The `[idKey]?: '...'` brand, and its import, on a key not called `id`, `_id` or `uuid` and on every composite.
- `import 'reflect-metadata'`, and `experimentalDecorators`/`emitDecoratorMetadata` in `tsconfig.json`, comments and formatting kept.

## What it leaves to you

Reported with what to do, never guessed:

- `target: esnext`, the one target that leaves decorators untransformed, and a value inherited through `extends`.
- `@Log()`, `@Serialized()`, `@Transactional()` and `@InjectQuerier()`: a `@Transactional()` method becomes a `pool.transaction()` around its body, and only you know which pool.
- An export removed with no one-to-one replacement (`setQuerierPool`, `getQuerier`, `augmentWhere`, `AbstractPgQuerier`, ...).
- A value it cannot read: options passed as a variable or a spread, a list that is not a literal, a key under a computed name.
- A property whose type maps to no column (`Json<T>`, a vector, a mixed union).
- A branded string id, written as `type: String` to keep the column you have, with a note: `'uuid'` is a native column, and a migration.

## After it runs

`tsc` is the rest of the migration: what the codemod wrote is checked against the property it describes, so anything it got wrong is a compile error. See the [upgrade guide](https://uql-orm.dev/upgrade-guide).

## Why TypeScript 6

Reading each property's type needs the checker, so TypeScript is a runtime dependency. 7's entry point exports no compiler API yet and has no standalone parser, which the `tsconfig.json` rewrite needs to keep your formatting; revisit once that API is stable.

## License

MIT
