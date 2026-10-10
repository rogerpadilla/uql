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

/** The name `uql-orm` gave its SQL tag, and gives it now. */
export const LEGACY_SQL_TAG = 'raw';
export const SQL_TAG = 'sql';

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
  [LEGACY_SQL_TAG, { to: SQL_TAG }],
  [`uql-orm/util#${LEGACY_SQL_TAG}`, { to: SQL_TAG, from: 'uql-orm' }],
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

/** The entry an import from `entry` lives in now. */
const entryOf = (entry: string): string => MOVED_ENTRIES.get(entry) ?? entry;

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
    if (entries ? !isUqlEntry(entry) : entry !== 'uql-orm') {
      return [];
    }
    const bindings = declaration.importClause?.namedBindings;
    return bindings && ts.isNamedImports(bindings) ? [{ declaration, entry, elements: bindings.elements }] : [];
  });
}

/** Whether `entry` is `uql-orm` itself or one of its `uql-orm/<driver>` entries. */
const isUqlEntry = (entry: string): boolean => entry === 'uql-orm' || entry.startsWith('uql-orm/');

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
    const root = entryOf(entry) === 'uql-orm';
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
/** The `uql-orm` export `node` names, where its symbol is an import of it or of one of its entries. */
export function uqlExport(node: ts.Node | undefined, checker: ts.TypeChecker): string | undefined {
  const declaration = node && ts.isIdentifier(node) ? checker.getSymbolAtLocation(node)?.declarations?.[0] : undefined;
  return declaration && isUqlSpecifier(declaration) ? importedName(declaration) : undefined;
}

function isUqlSpecifier(declaration: ts.Declaration): declaration is ts.ImportSpecifier {
  if (!ts.isImportSpecifier(declaration)) {
    return false;
  }
  const { moduleSpecifier } = declaration.parent.parent.parent;
  return ts.isStringLiteral(moduleSpecifier) && isUqlEntry(moduleSpecifier.text);
}

/** Whether `name` is the SQL tag, by either of its names. */
export function isSqlExport(name: string | undefined): boolean {
  return name === SQL_TAG || name === LEGACY_SQL_TAG;
}

/** The name the file calls the SQL tag by once `raw` is renamed: the alias it imports it as, else `sql`. */
export function sqlName(source: ts.SourceFile): string {
  const element = uqlImports(source, true).find((it) => isSqlExport(importedName(it)));
  return element?.propertyName ? element.name.text : SQL_TAG;
}

/** The names the rewrites wrote that the file does not import from `uql-orm` yet, each with what wrote it. */
function missingNames(ctx: Context): readonly (readonly [string, string])[] {
  const imported = new Set(uqlImports(ctx.source, true).map(importedName));
  const bound = [...imported].some(isSqlExport);
  return [...ctx.imports].filter(([name]) => !imported.has(name) && !(bound && name === SQL_TAG));
}

const MEMBER = ts.SymbolFlags.Property | ts.SymbolFlags.Method | ts.SymbolFlags.Accessor | ts.SymbolFlags.EnumMember;

/** Whether `node` names a binding or a reference that is not `uql-orm`'s, which an import of the same name would capture. */
function isForeignName(node: ts.Identifier, checker: ts.TypeChecker): boolean {
  const symbol = checker.getSymbolAtLocation(node);
  if (!symbol) {
    const { parent } = node;
    return !((ts.isPropertyAccessExpression(parent) || ts.isPropertyAssignment(parent)) && parent.name === node);
  }
  return !(symbol.flags & MEMBER) && !symbol.declarations?.every(isUqlSpecifier);
}

/**
 * The first identifier of the file already naming something a rewrite writes: a name it imports (`sql`, `refs`,
 * `idKey`) or a rename brings in. The write would shadow it or be shadowed, so the file is left to its owner.
 */
export function clashingName(ctx: Context): ts.Identifier | undefined {
  const renamed = uqlImportDeclarations(ctx.source, true).flatMap(({ entry, elements }) =>
    elements.flatMap((element) => {
      const rename = renamedTo(element, entry);
      return rename && !element.propertyName ? [rename.to] : [];
    }),
  );
  const names = new Set([...missingNames(ctx).map(([name]) => name), ...renamed]);
  const visit = (node: ts.Node): ts.Identifier | undefined =>
    ts.isIdentifier(node) && names.has(node.text) && isForeignName(node, ctx.checker)
      ? node
      : ts.forEachChild(node, visit);
  return names.size ? visit(ctx.source) : undefined;
}

/**
 * Rewrites the file's imports in one pass: a name {@link RENAMED_EXPORTS} renames or a {@link MOVED_ENTRIES} entry
 * moves is imported again where it lives now, every use renamed, and one already imported or `dead` is dropped.
 * The names the rewrites wrote join the first `uql-orm` import, or are reported when there is none.
 */
export function rewriteImports(dead: ReadonlySet<string>, ctx: Context): void {
  const { source } = ctx;
  const imports = new Map(uqlImportDeclarations(source, true).map((it) => [it.declaration, it]));
  const bound = new Set(
    [...imports.values()]
      .flatMap(({ entry, elements }) => elements.filter((element) => !renamedTo(element, entry)))
      .map((element) => element.name.text),
  );
  const home = [...imports.values()].find(({ entry }) => entryOf(entry) === 'uql-orm');
  const written = missingNames(ctx);
  if (!home) {
    for (const [name, what] of written) {
      ctx.unresolved.push(`${source.fileName}: import '${name}' from 'uql-orm' for ${what} written here`);
    }
  }
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    if (statement.moduleSpecifier.text === 'reflect-metadata' && !statement.importClause) {
      ctx.edits.push(removeStatement(statement));
      continue;
    }
    const uql = imports.get(statement);
    const join = uql === home ? written.map(([name]) => name) : [];
    const entry = uql && entryOf(uql.entry);
    if (uql && (entry !== uql.entry || uql.elements.some((element) => renamedTo(element, entry)))) {
      rebuildImport(uql, join, dead, bound, ctx);
    } else {
      patchImport(statement, join, dead, ctx);
    }
  }
}

/** An import of `names` from `from`, quoted as the file quotes its imports. */
const importText = (keyword: string, names: readonly string[], from: string, quote = "'"): string =>
  `${keyword} { ${names.join(', ')} } from ${quote}${from}${quote};`;

/**
 * The import written again: each name under the entry it lives in, `join` first under `uql-orm`. `join` is values,
 * so in a type-only declaration it becomes a value import of its own.
 */
function rebuildImport(
  { declaration, entry: imported, elements }: UqlImport,
  join: readonly string[],
  dead: ReadonlySet<string>,
  bound: Set<string>,
  ctx: Context,
): void {
  const entry = entryOf(imported);
  const typeOnly = isTypeOnly(declaration);
  const byEntry = new Map<string, string[]>([[entry, typeOnly ? [] : [...join]]]);
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
  const keyword = typeOnly ? 'import type' : 'import';
  const quote = declaration.moduleSpecifier.getText()[0];
  const statements = [...byEntry]
    .filter(([, names]) => names.length)
    .map(([from, names]) => importText(keyword, names, from, quote));
  if (typeOnly && join.length) {
    statements.unshift(importText('import', join, 'uql-orm', quote));
  }
  ctx.edits.push(statements.length ? replaced(declaration, statements.join('\n')) : removeStatement(declaration));
}

/** The import with the `dead` names out and `join` in, nothing else of it touched. */
function patchImport(
  declaration: ts.ImportDeclaration,
  join: readonly string[],
  dead: ReadonlySet<string>,
  ctx: Context,
): void {
  const named = declaration.importClause?.namedBindings;
  if (!named || !ts.isNamedImports(named)) {
    return;
  }
  const dropped = named.elements.filter((element) => dead.has(element.name.text));
  const statement = importText('import', join, 'uql-orm');
  if (dropped.length === named.elements.length && !declaration.importClause?.name) {
    ctx.edits.push(join.length ? replaced(declaration, statement) : removeStatement(declaration));
    return;
  }
  ctx.edits.push(...removeFromList(named.elements, dropped, ctx.source));
  if (join.length) {
    ctx.edits.push(
      isTypeOnly(declaration)
        ? inserted(declaration, `${statement}\n`)
        : inserted(named.elements[0], join.map((name) => `${name}, `).join('')),
    );
  }
}
