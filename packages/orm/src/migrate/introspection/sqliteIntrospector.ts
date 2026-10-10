import type { IndexFacet } from '../../schema/indexDifferences.js';
import type { CheckSchema } from '../../schema/types.js';
import type {
  ForeignKeySchema,
  IndexColumnSchema,
  IndexSchema,
  PrimaryKeySchema,
  QuerySql,
  StoredDefinition,
} from '../../type/index.js';
import { sql } from '../../util/sql.js';
import {
  AbstractSqlSchemaIntrospector,
  type ReadColumn,
  type TableRowReader,
} from './abstractSqlSchemaIntrospector.js';

/**
 * SQLite schema introspector
 */
export class SqliteSchemaIntrospector extends AbstractSqlSchemaIntrospector {
  /** Whether an index is libSQL's vector index, where the engine has one; elsewhere a declared one is built plain. */
  protected override readonly indexFacets: ReadonlySet<IndexFacet> = new Set<IndexFacet>(
    this.dialect.hasVectorIndex() ? ['vector', 'distance'] : [],
  );

  protected triggersQuery(tableName: string): QuerySql {
    return sql`SELECT name, sql AS definition FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ${tableName}`;
  }

  /** User tables only: skips SQLite's own and libSQL's vector index tables (its metadata and `<index>_shadow`). */
  protected getTableNamesQuery(): QuerySql {
    return sql`
      SELECT name AS table_name
      FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
        AND name <> 'libsql_vector_meta_shadow'
        AND name NOT IN (SELECT name || '_shadow' FROM sqlite_master WHERE type = 'index')
      ORDER BY name
    `;
  }

  protected tableExistsQuery(tableName: string): QuerySql {
    return sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ${tableName}`;
  }

  /**
   * `table_xinfo`, not `table_info`: the latter omits generated columns entirely, so a table carrying
   * one read back without it and every sync offered to add a column that was already there - which
   * SQLite cannot do to an existing table anyway. Also the key, by each column's `pk`: one statement for both.
   */
  private tableInfo(read: TableRowReader, tableName: string): Promise<SqliteColumnRow[]> {
    return read<SqliteColumnRow>(this.pragma('table_xinfo', tableName));
  }

  protected async getColumns(read: TableRowReader, tableName: string): Promise<ReadColumn[]> {
    const rows = await this.tableInfo(read, tableName);
    // Only a sole `INTEGER PRIMARY KEY` is the rowid, which is what numbers itself.
    const soleKey = rows.filter((row) => row.pk > 0).length === 1;
    const [table] = rows.some((row) => row.hidden === STORED_GENERATED)
      ? await this.getDefinition(read, tableName)
      : [];
    const ddl = table?.sql ?? '';

    return rows.map((row): ReadColumn => ({
      name: row.name,
      type: this.normalizeType(row.type),
      nullable: row.notnull === 0,
      defaultValue: this.parseDefaultValue(row.dflt_value),
      isAutoIncrement: soleKey && row.pk > 0 && row.type.toUpperCase() === 'INTEGER',
      length: this.extractLength(row.type),
      generatedAs: row.hidden === STORED_GENERATED ? generatedExpression(ddl, row.name) : undefined,
    }));
  }

  protected async getPrimaryKey(read: TableRowReader, tableName: string): Promise<PrimaryKeySchema | undefined> {
    const key = (await this.tableInfo(read, tableName)).filter((row) => row.pk > 0).sort((a, b) => a.pk - b.pk);
    return key.length ? { columns: key.map((row) => row.name) } : undefined;
  }

  protected async getIndexes(read: TableRowReader, tableName: string): Promise<IndexSchema[]> {
    const list = await read<SqliteIndexRow>(this.pragma('index_list', tableName));
    const statements = new Map((await this.getDefinition(read, tableName)).map(({ name, sql }) => [name, sql]));
    const indexes: IndexSchema[] = [];
    // The key's own index ('pk') is left out; a unique constraint's ('u') is reported as every engine reports one.
    for (const index of list.filter((it) => it.origin !== 'pk')) {
      const sql = statements.get(index.name) ?? '';
      // `PRAGMA index_info` names an expression entry `null`, its text kept only in `sqlite_master.sql`: it is
      // reported as the expression it is, as MySQL reports one, and libSQL's vector index is read off that text.
      const entries = (await this.getIndexColumns(read, index.name)).map(({ name }): IndexColumnSchema =>
        name === null ? { column: '', expression: true } : { column: name },
      );
      indexes.push(
        this.vectorIndex(index.name, sql) ?? {
          name: index.name,
          entries,
          unique: Boolean(index.unique),
          where: index.partial ? indexPredicate(sql) : undefined,
        },
      );
    }
    return indexes;
  }

  /**
   * A row per column of each key, grouped by its id. Unnamed: `PRAGMA foreign_key_list` reports none, so the
   * AST derives one from the columns, as the entity side does.
   */
  protected async getForeignKeys(read: TableRowReader, tableName: string): Promise<ForeignKeySchema[]> {
    const rows = await read<SqliteForeignKeyRow>(this.pragma('foreign_key_list', tableName));
    return [...Map.groupBy(rows, (row) => row.id).values()].map((key) => {
      const [first] = key;
      return {
        columns: key.map((row) => row.from),
        references: { table: first.table, columns: key.map((row) => row.to) },
        onDelete: this.normalizeReferentialAction(first.on_delete),
        onUpdate: this.normalizeReferentialAction(first.on_update),
      };
    });
  }

  /** The named checks in the table's `CREATE TABLE`, the only place SQLite keeps one. */
  protected async getChecks(read: TableRowReader, tableName: string): Promise<CheckSchema[]> {
    const [table] = await this.getDefinition(read, tableName);
    return table ? namedChecks(table.sql) : [];
  }

  /** Every statement `sqlite_master` keeps for the table, its `CREATE TABLE` first. An automatic index has none. */
  protected override getDefinition(read: TableRowReader, tableName: string): Promise<StoredDefinition[]> {
    return read<StoredDefinition>(
      sql`SELECT type AS kind, name, sql FROM sqlite_master WHERE tbl_name = ${tableName} AND sql IS NOT NULL ORDER BY type <> 'table'`,
    );
  }

  /** libSQL's `libsql_vector_idx(col, 'metric=...')`, read back from the statement that created it. */
  private vectorIndex(name: string, sql: string): IndexSchema | undefined {
    const column = sql.match(/libsql_vector_idx\s*\(\s*[`"[]?([^`"\],\s)]+)/i)?.[1];
    if (!column) {
      return undefined;
    }
    const metric = sql.match(/'metric=(\w+)'/i)?.[1]?.toLowerCase();
    return {
      name,
      entries: [{ column }],
      unique: false,
      type: 'vector',
      distance: this.dialect.indexedDistance(metric),
    };
  }

  private getIndexColumns(read: TableRowReader, indexName: string): Promise<{ name: string | null }[]> {
    return read<{ name: string | null }>(this.pragma('index_info', indexName));
  }

  /** A PRAGMA takes no parameters, so the name it reads is written into the statement, escaped. */
  private pragma(name: string, of: string): QuerySql {
    return sql.text(`PRAGMA ${name}(${this.dialect.escapeId(of)})`);
  }

  protected normalizeType(type: string): string {
    // Extract base type without length/precision
    const match = type.match(/^([A-Za-z][A-Za-z0-9_]*)/);
    return match ? match[1].toUpperCase() : type.toUpperCase();
  }

  protected extractLength(type: string): number | undefined {
    const match = type.match(/\((\d+)\)/);
    return match ? Number.parseInt(match[1], 10) : undefined;
  }

  protected parseDefaultValue(defaultValue: string | null): unknown {
    if (defaultValue === null) {
      return undefined;
    }

    if (defaultValue === 'NULL') {
      return null;
    }
    if (/^'.*'$/.test(defaultValue)) {
      return defaultValue.slice(1, -1).replaceAll("''", "'");
    }
    if (/^-?\d+$/.test(defaultValue)) {
      return Number.parseInt(defaultValue, 10);
    }
    if (/^-?\d+\.\d+$/.test(defaultValue)) {
      return Number.parseFloat(defaultValue);
    }

    const upper = defaultValue.toUpperCase();
    if (upper === 'TRUE') return 1;
    if (upper === 'FALSE') return 0;

    return this.sqlDefault(defaultValue);
  }
}

/** `PRAGMA table_xinfo`'s `hidden` for a column the engine stores rather than recomputes on each read. */
const STORED_GENERATED = 3;

const GENERATED_AS = /\b(?:GENERATED\s+ALWAYS\s+)?AS\s*\(/i;

/**
 * The expression a generated column is computed from, read out of the `CREATE TABLE` itself: no PRAGMA
 * reports one, and SQLite keeps the statement's text exactly as it was given.
 */
export function generatedExpression(ddl: string, column: string): string | undefined {
  const entry = tableEntries(ddl).find((it) => leadingIdentifier(it) === column);
  if (entry === undefined) {
    return undefined;
  }
  const at = GENERATED_AS.exec(entry);
  return at === null ? undefined : parenthesized(entry.slice(at.index + at[0].length - 1));
}

/** A `CREATE TABLE` body split at each comma outside any parentheses or quotes: one entry per column or constraint. */
function tableEntries(ddl: string): string[] {
  const body = ddl.slice(ddl.indexOf('(') + 1, ddl.lastIndexOf(')'));
  const entries: string[] = [];
  let start = 0;
  scan(body, (char, index, depth) => {
    if (char === ',' && depth === 0) {
      entries.push(body.slice(start, index));
      start = index + 1;
    }
  });
  return [...entries, body.slice(start)];
}

/** A partial index's predicate: what follows `WHERE` after its column list, as the statement gave it. */
function indexPredicate(sql: string): string | undefined {
  let rest = '';
  scan(sql, (char, index, depth) => {
    const closes = char === ')' && depth === 0;
    if (closes) {
      rest = sql.slice(index + 1);
    }
    return closes;
  });
  return /^\s*WHERE\s+([\s\S]+)$/i.exec(rest)?.[1].trim();
}

/** What a leading `(` encloses, its own nesting and quoting respected. */
function parenthesized(text: string): string {
  let end = text.length;
  scan(text, (char, index, depth) => {
    const closes = char === ')' && depth === 0;
    if (closes) {
      end = index;
    }
    return closes;
  });
  return text.slice(1, end).trim();
}

/**
 * Walk SQL, reporting each character outside a string or a quoted identifier along with the nesting
 * depth that follows it. A truthy `visit` stops the walk.
 */
function scan(sql: string, visit: (char: string, index: number, depth: number) => unknown): void {
  let depth = 0;
  let quote = '';
  for (let index = 0; index < sql.length; index++) {
    const char = sql[index];
    if (quote !== '') {
      quote = char === quote ? '' : quote;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    depth += char === '(' || char === '[' ? 1 : 0;
    depth -= char === ')' || char === ']' ? 1 : 0;
    if (visit(char, index, depth)) {
      return;
    }
  }
}

/** The name a column definition opens with, however it was quoted. */
function leadingIdentifier(entry: string): string {
  const token = entry.trimStart().replace(/^("[^"]*"|`[^`]*`|\[[^\]]*\]|[^\s(]*)[\s\S]*$/, '$1');
  return token.replace(/^["`[]|["`\]]$/g, '');
}

type SqliteColumnRow = {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
  /** 0 ordinary, 1 a hidden `VIRTUAL` table column, 2 virtual, 3 stored. */
  hidden: number;
};

type SqliteIndexRow = {
  seq: number;
  name: string;
  unique: number;
  origin: string;
  partial: number;
};

type SqliteForeignKeyRow = {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string;
  on_update: string;
  on_delete: string;
  match: string;
};

/** Where a named check starts, its name quoted any way SQLite takes, up to its opening parenthesis. */
const NAMED_CHECK = /CONSTRAINT\s+("[^"]*"|`[^`]*`|\[[^\]]*\]|\w+)\s+CHECK\s*\(/gi;

/** Each `CONSTRAINT <name> CHECK (...)` in a `CREATE TABLE`, the only place SQLite keeps one. */
export function namedChecks(ddl: string): CheckSchema[] {
  return [...ddl.matchAll(NAMED_CHECK)].map((match) => ({
    name: leadingIdentifier(match[1]),
    expression: parenthesized(ddl.slice(match.index + match[0].length - 1)),
  }));
}
