import ts from 'typescript';
import type { Context } from './context.js';
import { inserted, removeFromList, removeStatement, replaced } from './edits.js';

/**
 * Exports that no longer exist, mapped to what to do instead. Reported rather than rewritten: what replaces
 * each is decided at its call site.
 */
const REMOVED_EXPORTS = new Map([
  [
    'setQuerierPool',
    'pass the pool where it is used: `createFetchHandler({ pool, include })`, `querierMiddleware({ pool, include })`',
  ],
  ['getQuerierPool', 'take the pool from the module that builds it, or from Nest DI'],
  ['getQuerier', 'use `pool.withQuerier(...)` / `pool.transaction(...)`, which release the connection'],
  ['ClientQuerierPool', "construct the `HttpQuerier` where it is used, `new HttpQuerier('/api')`"],
  ['QueryWhereFieldMap', 'use `QueryWhere`'],
  ['QueryStreamProjected', 'use `QueryProjected`'],
  ['RelationMappedBy', "a 'mappedBy' is `(keys: KeyMap<E>) => Key<E>` now"],
  ['RelationKeyMapper', 'it is `(keys: KeyMap<E>) => Key<E>` now'],
  ['augmentWhere', 'spread the two maps: `{ ...where, ...extra }`'],
  ['buildQueryWhereAsMap', 'a `$where` is a map already; name the key for ids: `{ id: [1, 2] }`'],
  ['AbstractPgQuerier', 'every pg-compatible pool returns `PgQuerier` (`uql-orm/postgres`), which is concrete'],
  ['AbstractHranaQuerierPool', 'extend `AbstractSqlQuerierPool` and hand every querier a `HranaQuerier`'],
  [
    'PreparedSqliteQuerier',
    'use `SqliteQuerier`, which takes any driver that prepares, or extend `AbstractSqliteQuerier`',
  ],
  ['toSqliteBindValues', 'pass the values as they are: every SQLite driver binds a `SqliteBindValue[]`'],
  ['libsqlUseRemoteForMigrations', '`LibsqlQuerierPool.getMigrationQuerier()` decides it'],
  ['SqlCallback', 'use `EntitySql<E>`, which holds the callback form'],
  [
    'IndexColumnOptions',
    "an entity's index entry is `EntityIndexColumnInput<E>`, the migration builder's `IndexColumnInput`",
  ],
  ['isKnownMigratorDialect', 'every dialect has a migrator, so it always held: drop the check'],
  ['QuerierPoolDialect', "read the pool's own: `P['dialect']`"],
  ['QuerierPoolQuerier', "read the pool's own: `Awaited<ReturnType<P['getQuerier']>>`"],
  [
    'POSTGRES_WIRE_DRIVER_CAPABILITIES',
    'pass `driverCapabilities: { nativeArrays: false, explicitJsonCast: true }` to the dialect',
  ],
  ['MysqlLikeSqlDialect', 'extend `MySqlDialect` (`uql-orm/mysql`) or `MariaDialect` (`uql-orm/mariadb`)'],
  ['D1Meta', "uql reads `D1Result['meta']`; the rest of a binding is typed by `@cloudflare/workers-types`"],
  ['D1ExecResult', 'the rest of a binding is typed by `@cloudflare/workers-types`'],
  ['createSchemaGenerator', 'use `new SqlSchemaGenerator(dialect)`, or `migrator.getSchemaGenerator()`'],
  ...['JsonMigrationStorage', 'DatabaseMigrationStorage', 'MongoMigrationStorage'].map(
    (name) => [name, 'the migrator keeps its journal in the database itself, named by `tableName`'] as const,
  ),
]);

/** What `uql-orm/util` exported that the root still does. */
const UTIL_ROOT_EXPORTS = [
  'currentDate',
  'currentTime',
  'currentTimestamp',
  'raw',
  'sql',
  'refs',
  'uuid',
  'uuidv7',
  'deleteFrom',
  'insertInto',
  'refuse',
  'updateTable',
  'upsertInto',
  'withDeleted',
  'HookContext',
  'DefaultLogger',
];

/**
 * Exports renamed or moved and nothing else, so the import and every use follow, the import moving to `from`
 * where the name lives in another entry. Keyed by name, or by `entry#name` where the name stays elsewhere.
 */
const RENAMED_EXPORTS = new Map<string, { readonly to: string; readonly from?: string }>([
  ['QueryWhereMap', { to: 'QueryWhere' }],
  ['RelationKeyMap', { to: 'KeyMap' }],
  ['FilterCondition', { to: 'FilterWhere' }],
  ['PgDialect', { to: 'PostgresDialect', from: 'uql-orm/postgres' }],
  ['NeonDialect', { to: 'PostgresDialect', from: 'uql-orm/postgres' }],
  ['PgliteDialect', { to: 'PostgresDialect', from: 'uql-orm/postgres' }],
  ['CrdbQuerier', { to: 'PgQuerier', from: 'uql-orm/postgres' }],
  ['NeonQuerier', { to: 'PgQuerier', from: 'uql-orm/postgres' }],
  ['MySql2Dialect', { to: 'MySqlDialect', from: 'uql-orm/mysql' }],
  ['MongodbNativeDialect', { to: 'MongoDialect', from: 'uql-orm/mongodb' }],
  ['LibsqlQuerier', { to: 'HranaQuerier', from: 'uql-orm/sqlite' }],
  ['TursoQuerier', { to: 'HranaQuerier', from: 'uql-orm/sqlite' }],
  ['TursoLocalQuerier', { to: 'SqliteQuerier', from: 'uql-orm/sqlite' }],
  ['TursoDatabase', { to: 'SqliteDatabase', from: 'uql-orm/sqlite' }],
  ['SqlMigrationModuleOptions', { to: 'MigrationModuleOptions' }],
  ['buildSqlQuerierMigrationModule', { to: 'buildMigrationModule' }],
  ['QueryDialect', { to: 'SqlQueryDialect' }],
  ['EngineFeatures', { to: 'DialectFeatures' }],
  ['KnownMigratorDialect', { to: 'DialectName', from: 'uql-orm' }],
  ['D1Preparer', { to: 'D1Queryable' }],
  ['D1Database', { to: 'D1Queryable', from: 'uql-orm/d1' }],
  ['MongoQuerier', { to: 'MongoQuerier', from: 'uql-orm/mongodb' }],
  ['isMongoQuerier', { to: 'isMongoQuerier', from: 'uql-orm/mongodb' }],
  ['MongoSchemaIntrospector', { to: 'MongoSchemaIntrospector', from: 'uql-orm/mongodb' }],
  ['Sqlite3QuerierPool', { to: 'SqliteQuerierPool' }],
  ['Sqlite3PoolOptions', { to: 'SqlitePoolOptions' }],
  ['IMigrationBuilder', { to: 'MigrationBuilder' }],
  ['ITableBuilder', { to: 'TableBuilder' }],
  ['IAlterTableBuilder', { to: 'AlterTableBuilder' }],
  ['IColumnBuilder', { to: 'ColumnBuilder' }],
  ['IColumnFactory', { to: 'ColumnFactory' }],
  ['IForeignKeyBuilder', { to: 'ForeignKeyBuilder' }],
  ['ITableForeignKeyBuilder', { to: 'TableForeignKeyBuilder' }],
  ['UqlLockUsageError', { to: 'UqlUsageError' }],
  ['uql-orm/http#Hook', { to: 'RequestHook' }],
  ['uql-orm/http#HookContext', { to: 'RequestHookContext' }],
  ...UTIL_ROOT_EXPORTS.map((name) => [`uql-orm/util#${name}`, { to: name, from: 'uql-orm' }] as const),
]);

/** What the root exported that is internal now, and what to write instead. */
const INTERNAL_EXPORTS = new Map([
  ...['AbstractDialect', 'AbstractSqlDialect', 'AbstractQuerier', 'AbstractQuerierPool'].map(
    (name) => [name, "extend a driver's dialect or pool from its entry instead"] as const,
  ),
  ...['AbstractSqlQuerier', 'AbstractSqlQuerierPool'].map(
    (name) => [name, "extend a driver's querier or pool from its entry instead"] as const,
  ),
  ['SqlQueryContext', 'make one with `dialect.createContext()`, typed `QueryContext`'],
  ['dialectOptionsFrom', "pass the options to the driver's dialect"],
  ...['fieldOf', 'relationOf', 'soleIdOf', 'assertSoleId'].map(
    (name) => [name, 'read the field off `getMeta(Entity).fields`'] as const,
  ),
  ['namesKey', 'read the keys off `getMeta(Entity).ids`'],
  ['getEntities', 'list your entities in the config'],
]);

/** Entries renamed, or dropped for repeating the root, each to the one now exporting what it did. */
const MOVED_ENTRIES = new Map([
  ['uql-orm/maria', 'uql-orm/mariadb'],
  ['uql-orm/mongo', 'uql-orm/mongodb'],
  ['uql-orm/bunSql', 'uql-orm/bun-sql'],
  ['uql-orm/dialect', 'uql-orm'],
  ['uql-orm/entity', 'uql-orm'],
  ['uql-orm/namingStrategy', 'uql-orm'],
  ['uql-orm/querier', 'uql-orm'],
  ['uql-orm/type', 'uql-orm'],
]);

type UqlImport = {
  readonly declaration: ts.ImportDeclaration;
  readonly entry: string;
  readonly elements: readonly ts.ImportSpecifier[];
};

/**
 * The file's named imports from `uql-orm`. `entries` adds the driver entries (`uql-orm/postgres`, ...),
 * for what is read by name only: `idKey` written into one would land on an entry that may not export it.
 */
export function uqlImportDeclarations(source: ts.SourceFile, entries = false): readonly UqlImport[] {
  return source.statements.flatMap((declaration) => {
    if (!ts.isImportDeclaration(declaration) || !ts.isStringLiteral(declaration.moduleSpecifier)) {
      return [];
    }
    const entry = declaration.moduleSpecifier.text;
    if (entry !== 'uql-orm' && !(entries && entry.startsWith('uql-orm/'))) {
      return [];
    }
    const bindings = declaration.importClause?.namedBindings;
    return bindings && ts.isNamedImports(bindings) ? [{ declaration, entry, elements: bindings.elements }] : [];
  });
}

function uqlImports(source: ts.SourceFile, entries = false): readonly ts.ImportSpecifier[] {
  return uqlImportDeclarations(source, entries).flatMap(({ elements }) => elements);
}

/** The specifier importing the export `name` from `uql-orm`, or with `entries` from any of its entries. */
export function uqlImport(source: ts.SourceFile, name: string, entries = false): ts.ImportSpecifier | undefined {
  return uqlImports(source, entries).find((element) => importedName(element) === name);
}

/** The name an import specifier brings in, which is the original one where it was renamed. */
function importedName(element: ts.ImportSpecifier): string {
  return (element.propertyName ?? element.name).text;
}

/** Every identifier in the file bound to the same symbol as `name`, besides `name` itself. */
export function usesOf(source: ts.SourceFile, name: ts.Identifier, checker: ts.TypeChecker): ts.Identifier[] {
  const symbol = checker.getSymbolAtLocation(name);
  const uses: ts.Identifier[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node !== name && node.text === name.text) {
      if (symbol && checker.getSymbolAtLocation(node) === symbol) {
        uses.push(node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return uses;
}

/** The rename `element` still needs, none where it already names the export at its entry. */
function renamedTo(element: ts.ImportSpecifier, entry: string) {
  const name = importedName(element);
  const rename = RENAMED_EXPORTS.get(`${entry}#${name}`) ?? RENAMED_EXPORTS.get(name);
  return rename?.to === name && rename.from === entry ? undefined : rename;
}

/** Names an export that no longer exists, where it is imported from the package or one of its entries. */
export function reportRemovedExports(ctx: Context): void {
  for (const { declaration, entry, elements } of uqlImportDeclarations(ctx.source, true)) {
    if (entry === 'uql-orm/util') {
      const names = elements.filter((element) => !renamedTo(element, entry)).map(importedName);
      if (names.length) {
        ctx.report(
          declaration,
          `'uql-orm/util' was removed; its helpers are internal, so write your own \`${names.join('`, `')}\``,
        );
      }
      continue;
    }
    const root = (MOVED_ENTRIES.get(entry) ?? entry) === 'uql-orm';
    for (const element of elements) {
      const name = importedName(element);
      const removed = REMOVED_EXPORTS.get(name);
      const internal = root ? INTERNAL_EXPORTS.get(name) : undefined;
      if (removed) {
        ctx.report(element, `'${name}' was removed; ${removed}`);
      } else if (internal) {
        ctx.report(element, `'${name}' is internal; ${internal}`);
      }
    }
  }
}

/**
 * Rewrites each import naming a {@link RENAMED_EXPORTS} export, or from a {@link MOVED_ENTRIES} entry, renaming
 * every use: a name moving entries gets an import from its new one, and one the file already imports is dropped,
 * as is a `dead` one. Returns the rewritten imports, which nothing else may edit.
 */
export function renameExports(dead: ReadonlySet<string>, ctx: Context): ReadonlySet<ts.ImportDeclaration> {
  const imports = uqlImportDeclarations(ctx.source, true);
  const kept = imports.flatMap(({ entry, elements }) => elements.filter((element) => !renamedTo(element, entry)));
  const bound = new Set(kept.map((element) => element.name.text));
  const rewritten = new Set<ts.ImportDeclaration>();
  for (const { declaration, entry: imported, elements } of imports) {
    const entry = MOVED_ENTRIES.get(imported) ?? imported;
    if (entry === imported && !elements.some((element) => renamedTo(element, entry))) {
      continue;
    }
    const byEntry = new Map<string, string[]>([[entry, []]]);
    for (const element of elements.filter(({ name }) => !dead.has(name.text))) {
      const rename = renamedTo(element, entry);
      const local = element.propertyName || !rename ? element.name.text : rename.to;
      if (rename && !element.propertyName) {
        ctx.edits.push(...usesOf(ctx.source, element.name, ctx.checker).map((use) => replaced(use, rename.to)));
      }
      if (rename && bound.has(local)) {
        continue;
      }
      bound.add(local);
      const target = rename?.from ?? entry;
      const text = rename
        ? `${element.isTypeOnly ? 'type ' : ''}${rename.to}${element.propertyName ? ` as ${local}` : ''}`
        : element.getText();
      byEntry.set(target, [...(byEntry.get(target) ?? []), text]);
    }
    const keyword = isTypeOnly(declaration) ? 'import type' : 'import';
    const quote = declaration.moduleSpecifier.getText()[0];
    const statements = [...byEntry]
      .filter(([, names]) => names.length)
      .map(([from, names]) => `${keyword} { ${names.join(', ')} } from ${quote}${from}${quote};`);
    ctx.edits.push(statements.length ? replaced(declaration, statements.join('\n')) : removeStatement(declaration));
    rewritten.add(declaration);
  }
  return rewritten;
}

function isTypeOnly(declaration: ts.ImportDeclaration): boolean {
  return declaration.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword;
}

/**
 * The imported names the codemod removes once every use was rewritten: `Relation` unwrapped and `expr` defaults.
 * A removed decorator keeps its import on purpose: deleting it would swap a clear error for a puzzling one.
 */
export function deadImportNames(ctx: Context): ReadonlySet<string> {
  const { source, rewritten } = ctx;
  const uses = (name: keyof Context['rewritten']) => {
    const element = uqlImport(source, name, true);
    return element ? usesOf(source, element.name, ctx.checker).length : 0;
  };
  const relations = uses('Relation');
  if (relations > rewritten.Relation) {
    ctx.unresolved.push(
      `${source.fileName}: ${relations - rewritten.Relation} 'Relation<T>' reference(s) are somewhere this codemod ` +
        'does not rewrite; unwrap them and drop the import by hand',
    );
  }
  const names = ['Relation', 'expr'] as const;
  return new Set(names.filter((name) => rewritten[name] > 0 && rewritten[name] === uses(name)));
}

/**
 * Removes `import 'reflect-metadata'`, since the polyfill only ever fed `design:type`, and each `dead` name
 * from the imports {@link renameExports} left as written, having left the dead names out of the rest.
 */
export function dropDeadImports(
  dead: ReadonlySet<string>,
  rewritten: ReadonlySet<ts.ImportDeclaration>,
  ctx: Context,
): void {
  for (const statement of ctx.source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    if (statement.moduleSpecifier.text === 'reflect-metadata' && !statement.importClause) {
      ctx.edits.push(removeStatement(statement));
      continue;
    }
    const named = statement.importClause?.namedBindings;
    if (!named || !ts.isNamedImports(named) || rewritten.has(statement)) {
      continue;
    }
    const dropped = named.elements.filter((element) => dead.has(element.name.text));
    if (dropped.length === named.elements.length && !statement.importClause?.name) {
      ctx.edits.push(removeStatement(statement));
      continue;
    }
    for (const element of dropped) {
      ctx.edits.push(removeFromList(named.elements, element, ctx.source));
    }
  }
}

/**
 * Imports what the rewrites wrote (`idKey`, `raw`) into the file's own `uql-orm` import. Reported instead
 * where there is none: the package may be imported under a path this codemod does not recognise.
 */
export function addImports(rewritten: ReadonlySet<ts.ImportDeclaration>, ctx: Context): void {
  const { source } = ctx;
  const imported = new Set(uqlImports(source).map(importedName));
  const missing = [...ctx.imports].filter(([name]) => !imported.has(name));
  if (!missing.length) {
    return;
  }
  const anchor = uqlImportDeclarations(source).find(({ declaration }) => !rewritten.has(declaration));
  if (!anchor) {
    for (const [name, what] of missing) {
      ctx.unresolved.push(`${source.fileName}: import '${name}' from 'uql-orm' for ${what} written here`);
    }
    return;
  }
  const names = missing.map(([name]) => name);
  ctx.edits.push(
    isTypeOnly(anchor.declaration)
      ? inserted(anchor.declaration, `import { ${names.join(', ')} } from 'uql-orm';\n`)
      : inserted(anchor.elements[0], names.map((name) => `${name}, `).join('')),
  );
}
