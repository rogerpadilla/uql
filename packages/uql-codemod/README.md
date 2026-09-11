<a href="https://uql-orm.dev">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/rogerpadilla/uql/main/assets/logo-dark.svg">
    <img src="https://raw.githubusercontent.com/rogerpadilla/uql/main/assets/logo.svg" alt="UQL" width="72" height="72">
  </picture>
</a>

# uql-codemod

Rewrites [uql-orm](https://uql-orm.dev) entities across the breaking changes that can be made mechanically: the move from the legacy TypeScript decorators to the TC39 standard spec, and the renames and annotations that followed it. One command, on your own source, with a dry run first:

```sh
npx uql-codemod --dry-run
npx uql-codemod
```

| Flag               |                                                                                                                                               |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `--project=<path>` | The `tsconfig.json` to read, `./tsconfig.json` by default. It has to cover your entities: the type checker is what says each property's type. |
| `--dry-run`        | Report what would change and touch nothing.                                                                                                   |
| `--include=<a,b>`  | Only files whose path contains one of these fragments.                                                                                        |

Only the `--flag=value` form is read, and anything unrecognised is an error: a misspelled `--dry-run` would otherwise rewrite the project for real. It exits `0` when nothing is left for you, `1` when something is, and `2` when it could not start at all - a bad argument, or a project it cannot read.

## What it rewrites

- `@Field()` and `@Field({ ... })` with no `type`, and `@Id()`: inserts the `type` the property's declared TypeScript type implies. Skipped when `references` is present, because schema generation resolves that column from the referenced primary key.
- Bare relation decorators: inserts `entity: () => X`, unwrapping arrays and the old `Relation<T>` alias.
- `Relation<T>` becomes `T`, and its import goes with the last usage - `uql-orm` no longer exports it. A usage somewhere the codemod does not reach, such as a type alias, keeps the import and is reported.
- `@Field({ virtual })` becomes `@Field({ computed })`, the name it was renamed to - written as a plain key, a quoted one, or a shorthand, which becomes `computed: virtual` so it keeps referring to the same local. A decorator given both names is reported instead, because which one wins is your call.
- `mappedBy: 'author'` becomes the callback `(post) => post.author`, the one form left, named after the relation's target.
- `@Index(['title', { column: 'createdAt', order: 'desc' }], { include: ['slug'] })` becomes `@Index((post) => [post.title, { column: post.createdAt, order: 'desc' }], { include: (post) => [post.slug] })`, and `references` pairs and the `@Entity`/`defineEntity`/`defineIndex`/`defineRelation` string forms likewise. A value that is not a literal is reported.
- An aggregate's `$agg: { total: { $sum: 'amount' } }` becomes `$select: { total: { $sum: { amount: true } } }`, and `$text`'s `$fields: ['title']` becomes `$fields: { title: true }`.
- `QueryWhereMap` and `RelationKeyMap`, renamed to `QueryWhere` and `KeyMap`, are renamed at their import and every use.
- A primary key not called `id`, `_id` or `uuid`, and every composite key, gets the `[idKey]?: '...'` brand naming it, plus the import. `@Id` refuses a key it cannot name, since one that resolves to any column types `findOneById` against the wrong one.
- `import 'reflect-metadata'` goes. Removing the package from your `package.json` is left to you.
- `tsconfig.json`: removes `experimentalDecorators` and `emitDecoratorMetadata`, keeping the rest of the file - comments and formatting included - exactly as written.

## What it refuses to do

It reports rather than guesses, and exits non-zero when anything is left for you:

- **`target: esnext`** is reported, not changed. Removing the line falls back to the compiler default (`es5` for `tsc`), and choosing a replacement means guessing which era the project targets. Any dated target works; `esnext` is the one where TypeScript emits decorator syntax untransformed.
- **A value inherited through `extends`** cannot be edited here, so the base config is reported instead.
- **`@Log()`, `@Serialized()`, `@Transactional()` and `@InjectQuerier()`** are reported and left in place. They no longer exist, and what to do instead is a judgement call - a `@Transactional()` method becomes a `pool.transaction(async (querier) => { ... })` around its body, and the codemod cannot know which pool.
- **An export that no longer exists** (`setQuerierPool`, `getQuerier`, `augmentWhere`, `RelationMappedBy`, ...) is reported with what replaces it. A `$where` given an id, a list of them or a bare `raw()` needs no report: it is a compile error on that value, fixed by naming the key (`{ id: [1, 2] }`) or wrapping the raw in `$and`.
- **A key written under a computed name** (`@Id() [KEY]?: string`) is reported: the brand has to spell the name out, and only you know what that expression evaluates to.
- **Options it cannot read** (`@Field(sharedOptions)`, a spread, or a `@Field` never called at all) are left exactly as written. Replacing an argument it cannot parse would silently drop the options.
- **A property whose type it cannot map to a column** (a `Json<T>`, a vector, a union that disagrees with itself) is reported as `needs a decision`. Those always had to declare `type` by hand anyway, because `design:type` reported the useless `Object`/`Array` for them.
- **A branded string id**, e.g. ``type UUID = `${string}-${string}` ``, gets `type: String` plus a `worth a look` note. That is a real fork: `String` generates a text column, `'uuid'` a native one, and only you know which the database has.

## After it runs

`tsc` is the rest of the migration, and that is the point: the annotations the codemod inserts are now _checked_ against the properties they describe, so anything it got wrong is a compile error rather than a silently wrong column. See the [upgrade guide](https://uql-orm.dev/upgrade-guide).

## Why TypeScript 6

TypeScript is a runtime dependency here: reading each property's type needs the checker. Version 6 is pinned because 7's `typescript` entry point exports no compiler API yet (it moved to `typescript/unstable/*`), and 7 has no standalone parser, which the `tsconfig.json` rewrite needs to keep your comments and formatting. A one-shot tool for a spec `uql-orm` no longer supports needs nothing newer; revisit once that API is stable.

## License

MIT
