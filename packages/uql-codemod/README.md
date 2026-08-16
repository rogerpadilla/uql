<a href="https://uql-orm.dev">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/rogerpadilla/uql/main/assets/logo-dark.svg">
    <img src="https://raw.githubusercontent.com/rogerpadilla/uql/main/assets/logo.svg" alt="UQL" width="72" height="72">
  </picture>
</a>

# uql-codemod

Migrates [uql-orm](https://uql-orm.dev) entities from the legacy TypeScript decorators to the TC39 standard spec. One command, on your own source, with a dry run first:

```sh
npx uql-codemod --project=tsconfig.json --dry-run
npx uql-codemod --project=tsconfig.json
```

| Flag | |
|---|---|
| `--project=<path>` | `tsconfig.json` to read. Required in practice: the codemod needs a real program, not a parser, because it writes down the types `design:type` used to report at runtime. Defaults to `./tsconfig.json`. |
| `--dry-run` | Report what would change and touch nothing. |
| `--include=<a,b>` | Only files whose path contains one of these fragments. |

Only the `--flag=value` form is read, and anything unrecognised is an error: a misspelled `--dry-run` would otherwise rewrite the project for real. It exits `0` when nothing is left for you, `1` when something is, and `2` when it could not start at all - a bad argument, or a project it cannot read.

## What it rewrites

- `@Field()` and `@Field({ ... })` with no `type`, and `@Id()`: inserts the `type` the property's declared TypeScript type implies. Skipped when `references` is present, because schema generation resolves that column from the referenced primary key.
- Bare relation decorators: inserts `entity: () => X`, unwrapping arrays and the old `Relation<T>` alias.
- `Relation<T>` becomes `T`, and its import goes with the last usage - `uql-orm` no longer exports it. A usage somewhere the codemod does not reach, such as a type alias, keeps the import and is reported.
- `@Transactional()` methods: drops the `@InjectQuerier() querier?: Querier` parameter and rewrites the body to `currentQuerier()`.
- `import 'reflect-metadata'` goes. Removing the package from your `package.json` is left to you.
- `tsconfig.json`: removes `experimentalDecorators` and `emitDecoratorMetadata`, keeping the rest of the file - comments and formatting included - exactly as written.

## What it refuses to do

It reports rather than guesses, and exits non-zero when anything is left for you:

- **`target: esnext`** is reported, not changed. Removing the line falls back to the compiler default (`es5` for `tsc`), and choosing a replacement means guessing which era the project targets. Any dated target works; `esnext` is the one where TypeScript emits decorator syntax untransformed.
- **A value inherited through `extends`** cannot be edited here, so the base config is reported instead.
- **`@Log()` and `@Serialized()`** are reported and left in place. They no longer exist, and what to do instead is a judgement call.
- **Options it cannot read** (`@Field(sharedOptions)`, a spread, or a `@Field` never called at all) are left exactly as written. Replacing an argument it cannot parse would silently drop the options.
- **A property whose type it cannot map to a column** (a `Json<T>`, a vector, a union that disagrees with itself) is reported as `needs a decision`. Those always had to declare `type` by hand anyway, because `design:type` reported the useless `Object`/`Array` for them.
- **A branded string id**, e.g. `type UUID = \`${string}-${string}\``, gets `type: String` plus a `worth a look` note. That is a real fork: `String` generates a text column, `'uuid'` generates a native one, and only you know which the database has.

## After it runs

`tsc` is the rest of the migration, and that is the point: the annotations the codemod inserts are now *checked* against the properties they describe, so anything it got wrong is a compile error rather than a silently wrong column. See the [upgrade guide](https://uql-orm.dev/upgrade-guide).

## Why TypeScript 6

TypeScript is a real dependency here, not a dev one: reading the types `design:type` used to report needs a checker, and that means shipping a compiler. Version 6 is pinned deliberately.

TypeScript 7 is not a version bump away. Its `typescript` entry point exports only the version number, and the compiler API moved to `typescript/unstable/*` in a different shape. The gap that matters is the parser: 7 has no standalone one, and `ts.parseJsonText` is what lets the `tsconfig.json` rewrite keep your comments and formatting instead of reserialising the file.

Staying on 6 costs nothing. This is a one-shot tool for a spec `uql-orm` no longer supports, so it never needs a new language feature, and 7 reads `experimentalDecorators` projects perfectly well when the time comes. Worth revisiting once that API drops the `unstable/` prefix and regains a parser.

## License

MIT
