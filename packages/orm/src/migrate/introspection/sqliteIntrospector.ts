import type { IndexFacet } from '../../schema/indexDifferences.js';
import type { ColumnSchema, ForeignKeySchema, IndexSchema } from '../../type/index.js';
import { derivedForeignKeyName } from '../../util/sql.util.js';
import { AbstractSqlSchemaIntrospector, type TableRowReader } from './abstractSqlSchemaIntrospector.js';

/**
 * SQLite schema introspector
 */
export class SqliteSchemaIntrospector extends AbstractSqlSchemaIntrospector {
  /** Whether an index is libSQL's vector index, where the engine has one; elsewhere a declared one is built plain. */
  override readonly indexFacets: ReadonlySet<IndexFacet> = new Set<IndexFacet>(
    this.dialect.hasVectorIndex() ? ['vector', 'distance'] : [],
  );

  /** Not SQLite's own tables, nor the ones libSQL keeps a vector index in: its metadata and `<index>_shadow`. */
  protected triggersQuery(): string {
    return /*sql*/ `SELECT name, sql AS definition FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ?`;
  }

  protected getTableNamesQuery(): string {
    return /*sql*/ `
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
        AND name <> 'libsql_vector_meta_shadow'
        AND name NOT IN (SELECT name || '_shadow' FROM sqlite_master WHERE type = 'index')
      ORDER BY name
    `;
  }

  protected tableExistsQuery(): string {
    return /*sql*/ `
      SELECT COUNT(*) as count
      FROM sqlite_master
      WHERE type = 'table'
        AND name = ?
    `;
  }

  protected parseTableExistsResult([row]: SqliteCountRow[]): boolean {
    return Number(row.count) > 0;
  }

  /**
   * `table_xinfo`, not `table_info`: the latter omits generated columns entirely, so a table carrying
   * one read back without it and every sync offered to add a column that was already there - which
   * SQLite cannot do to an existing table anyway. PRAGMA takes no bound parameters, hence the splice.
   */
  protected getColumnsQuery(tableName: string): string {
    return /*sql*/ `PRAGMA table_xinfo(${this.escapeId(tableName)})`;
  }

  protected getIndexesQuery(tableName: string): string {
    return /*sql*/ `PRAGMA index_list(${this.escapeId(tableName)})`;
  }

  protected getForeignKeysQuery(tableName: string): string {
    return /*sql*/ `PRAGMA foreign_key_list(${this.escapeId(tableName)})`;
  }

  protected getPrimaryKeyQuery(tableName: string): string {
    return /*sql*/ `PRAGMA table_info(${this.escapeId(tableName)})`;
  }

  protected override getColumnsParams(_tableName: string): unknown[] {
    return [];
  }

  protected override getIndexesParams(_tableName: string): unknown[] {
    return [];
  }

  protected override getForeignKeysParams(_tableName: string): unknown[] {
    return [];
  }

  protected override getPrimaryKeyParams(_tableName: string): unknown[] {
    return [];
  }

  /** `sqlite_master`, not `information_schema`, so the column is `name`. */
  protected override mapTableNameRow(row: { name: string }): string {
    return row.name;
  }

  protected async mapColumnsResult(
    read: TableRowReader,
    tableName: string,
    results: SqliteColumnRow[],
  ): Promise<ColumnSchema[]> {
    const uniqueColumns = await this.getUniqueColumns(read, tableName);
    // Only a sole `INTEGER PRIMARY KEY` is the rowid, which is what numbers itself.
    const soleKey = results.filter((row) => row.pk > 0).length === 1;
    const ddl = results.some((row) => row.hidden === STORED_GENERATED) ? await this.getTableDdl(read, tableName) : '';

    return results.map((row): ColumnSchema => ({
      name: row.name,
      type: this.normalizeType(row.type),
      nullable: row.notnull === 0,
      defaultValue: this.parseDefaultValue(row.dflt_value),
      isPrimaryKey: row.pk > 0,
      isAutoIncrement: soleKey && row.pk > 0 && row.type.toUpperCase() === 'INTEGER',
      isUnique: uniqueColumns.has(row.name),
      length: this.extractLength(row.type),
      precision: undefined,
      scale: undefined,
      comment: undefined, // SQLite doesn't support column comments
      generatedAs: row.hidden === STORED_GENERATED ? generatedExpression(ddl, row.name) : undefined,
    }));
  }

  protected async mapIndexesResult(
    read: TableRowReader,
    _tableName: string,
    results: SqliteIndexRow[],
  ): Promise<IndexSchema[]> {
    const indexSchemas: IndexSchema[] = [];

    for (const index of results) {
      const columns = await this.getIndexColumns(read, index.name);

      // A unique constraint's index ('u') is reported as every engine reports it, and only the key's ('pk') left out.

      // `PRAGMA index_info` names an expression entry `null` (its `cid` is -2), and the expression text
      // lives only in `sqlite_master.sql`. Reporting `{ column: null }` put a column literally named
      // `null` into the diff, so an index UQL cannot describe is left out, libSQL's vector index aside.
      const named = columns.filter((column): column is { name: string } => column.name !== null);

      if (index.origin === 'pk') {
        continue;
      }
      if (named.length === columns.length) {
        indexSchemas.push({
          name: index.name,
          entries: named.map((column) => ({ column: column.name })),
          unique: Boolean(index.unique),
        });
      } else {
        const vectorIndex = await this.getVectorIndex(read, index.name);
        if (vectorIndex) {
          indexSchemas.push(vectorIndex);
        }
      }
    }

    return indexSchemas;
  }

  protected async mapForeignKeysResult(
    _read: TableRowReader,
    tableName: string,
    results: SqliteForeignKeyRow[],
  ): Promise<ForeignKeySchema[]> {
    // Group by id to handle composite foreign keys
    const grouped = new Map<number, SqliteForeignKeyRow[]>();
    for (const row of results) {
      const id = row.id;
      const existing = grouped.get(id) ?? [];
      existing.push(row);
      grouped.set(id, existing);
    }

    return Array.from(grouped.entries()).map(([, rows]) => {
      const first = rows[0];
      const columns = rows.map((r) => r.from);
      return {
        // `PRAGMA foreign_key_list` reports no name, so one is derived the same way the entity side
        // derives it. Seeded from the columns, not the PRAGMA's row id, which nothing else knows.
        name: derivedForeignKeyName(tableName, columns),
        columns,
        references: { table: first.table, columns: rows.map((r) => r.to) },
        onDelete: this.normalizeReferentialAction(first.on_delete),
        onUpdate: this.normalizeReferentialAction(first.on_update),
      };
    });
  }

  protected override mapPrimaryKeyResult(results: SqliteColumnRow[]): string[] | undefined {
    const pkColumns = results.filter((r) => r.pk > 0).sort((a, b) => a.pk - b.pk);

    if (pkColumns.length === 0) {
      return undefined;
    }

    return pkColumns.map((r) => r.name);
  }

  private async getUniqueColumns(read: TableRowReader, tableName: string): Promise<Set<string>> {
    const indexes = await read<SqliteIndexRow>(this.getIndexesQuery(tableName));
    const uniqueColumns = new Set<string>();

    // The key's own index is left out: a key column is unique already, which the entity side never states.
    for (const index of indexes) {
      if (index.unique && index.origin !== 'pk') {
        const columns = await this.getIndexColumns(read, index.name);
        // Only single-column unique constraints, and only over a real column (not an expression)
        const [column] = columns;
        if (columns.length === 1 && column.name !== null) {
          uniqueColumns.add(column.name);
        }
      }
    }

    return uniqueColumns;
  }

  /** libSQL's `libsql_vector_idx(col, 'metric=...')`, read back from the statement that created it. */
  private async getVectorIndex(read: TableRowReader, indexName: string): Promise<IndexSchema | undefined> {
    const [row] = await read<{ sql: string | null }>(
      /*sql*/ `SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?`,
      [indexName],
    );
    const column = row?.sql?.match(/libsql_vector_idx\s*\(\s*[`"[]?([^`"\],\s)]+)/i)?.[1];
    if (!column) {
      return undefined;
    }
    const metric = row.sql?.match(/'metric=(\w+)'/i)?.[1]?.toLowerCase();
    return {
      name: indexName,
      entries: [{ column }],
      unique: false,
      type: 'vector',
      distance: this.dialect.indexedDistance(metric),
    };
  }

  /** The statement that created the table, which is where SQLite keeps every expression it was given. */
  private async getTableDdl(read: TableRowReader, tableName: string): Promise<string> {
    const [row] = await read<{ sql: string }>(
      /*sql*/ `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`,
      [tableName],
    );
    return row.sql;
  }

  private getIndexColumns(read: TableRowReader, indexName: string): Promise<{ name: string | null }[]> {
    return read<{ name: string | null }>(/*sql*/ `PRAGMA index_info(${this.escapeId(indexName)})`);
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
    if (defaultValue === 'CURRENT_TIMESTAMP' || defaultValue === 'CURRENT_DATE' || defaultValue === 'CURRENT_TIME') {
      return defaultValue;
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

    return defaultValue;
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
  const [token = ''] = /^\s*(?:"[^"]*"|`[^`]*`|\[[^\]]*\]|[^\s(]+)/.exec(entry) ?? [];
  return token.trim().replace(/^["`[]|["`\]]$/g, '');
}

type SqliteCountRow = {
  count: number | bigint;
};

type SqliteColumnRow = {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
  /** `PRAGMA table_xinfo`'s flag: 0 ordinary, 1 a hidden `VIRTUAL` table column, 2 virtual, 3 stored. Absent from `table_info`. */
  hidden?: number;
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
