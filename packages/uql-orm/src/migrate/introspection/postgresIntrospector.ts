import type { IndexFacet } from '../../schema/indexDifferences.js';
import { INDEX_TYPES } from '../../schema/types.js';
import type { ColumnSchema, ForeignKeySchema, IndexColumnSchema, IndexSchema, RawRow } from '../../type/index.js';
import { AbstractSqlSchemaIntrospector, type TableRowReader } from './abstractSqlSchemaIntrospector.js';

/**
 * PostgreSQL schema introspector
 */
export class PostgresSchemaIntrospector extends AbstractSqlSchemaIntrospector {
  /**
   * Expressions and predicates are read back too, for `generate:from-db`, but they are text the
   * database reprints in its own words, so they are not comparable and are not claimed here.
   */
  override readonly indexFacets: ReadonlySet<IndexFacet> = new Set<IndexFacet>([
    'order',
    'nulls',
    'opsClass',
    'accessMethod',
    'include',
  ]);

  protected getTableNamesQuery(): string {
    return /*sql*/ `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `;
  }

  protected tableExistsQuery(): string {
    return /*sql*/ `
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = $1
      ) AS exists
    `;
  }

  protected parseTableExistsResult(results: RawRow[]): boolean {
    return (results[0]?.['exists'] as boolean) ?? false;
  }

  protected getColumnsQuery(_tableName: string): string {
    return /*sql*/ `
      SELECT
        c.column_name,
        c.data_type,
        c.udt_name,
        c.is_nullable,
        c.column_default,
        c.character_maximum_length,
        c.numeric_precision,
        c.numeric_scale,
        c.is_identity,
        c.identity_generation,
        COALESCE(
          (SELECT TRUE FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
             ON tc.constraint_name = kcu.constraint_name
           WHERE tc.table_name = c.table_name
             AND tc.constraint_type = 'PRIMARY KEY'
             AND kcu.column_name = c.column_name
           LIMIT 1),
          FALSE
        ) AS is_primary_key,
        COALESCE(
          (SELECT TRUE FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
             ON tc.constraint_name = kcu.constraint_name
           WHERE tc.table_name = c.table_name
             AND tc.constraint_type = 'UNIQUE'
             AND kcu.column_name = c.column_name
           LIMIT 1),
          FALSE
        ) AS is_unique,
        pg_catalog.col_description(
          (SELECT oid FROM pg_catalog.pg_class WHERE relname = c.table_name),
          c.ordinal_position
        ) AS column_comment
      FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name = $1
      ORDER BY c.ordinal_position
    `;
  }

  /**
   * `attname` where the entry is a column, `pg_get_indexdef` for that one position where it is an
   * expression. Neither alone will do: an expression entry has `attnum = 0`, so joining `pg_attribute`
   * on it silently dropped the entry (a `lower(email)` index read back as having no columns at all),
   * while `pg_get_indexdef` reprints an identifier *quoted*, so a camelCase column came back as
   * `"tenantId"` and matched no column of the table. Prisma and drizzle-kit both split it this way.
   *
   * Indexes backing a constraint are left out, primary keys among them: `@Field({ unique })` emits a
   * `UNIQUE` constraint and no index, so reporting the index Postgres builds underneath it told every
   * project it had an index its entities never asked for.
   */
  protected getIndexesQuery(_tableName: string): string {
    return /*sql*/ `
      SELECT
        i.relname AS index_name,
        ix.indisunique AS is_unique,
        am.amname AS method,
        pg_get_expr(ix.indpred, ix.indrelid, true) AS predicate,
        k.n <= ix.indnkeyatts AS is_key,
        k.attnum = 0 AS is_expression,
        COALESCE(a.attname::text, pg_get_indexdef(ix.indexrelid, k.n::int, true)) AS entry,
        (ix.indoption[k.n - 1] & 1) <> 0 AS descending,
        (ix.indoption[k.n - 1] & 2) <> 0 AS nulls_first,
        CASE WHEN op.opcdefault THEN NULL ELSE op.opcname END AS ops_class
      FROM pg_class t
      JOIN pg_index ix ON t.oid = ix.indrelid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_am am ON am.oid = i.relam
      JOIN pg_namespace n ON n.oid = t.relnamespace
      CROSS JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, n)
      LEFT JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum AND k.attnum > 0
      LEFT JOIN pg_opclass op ON op.oid = ix.indclass[k.n - 1]
      WHERE t.relname = $1
        AND n.nspname = 'public'
        AND NOT ix.indisprimary
        AND NOT EXISTS (
          SELECT 1 FROM pg_constraint con
          WHERE con.conindid = ix.indexrelid
            AND con.contype IN (${this.constraintIndexTypes.map((type) => `'${type}'`).join(', ')})
        )
      ORDER BY i.relname, k.n
    `;
  }

  /**
   * Constraint kinds whose backing index is the constraint itself rather than an index anyone asked
   * for. Postgres builds one for `PRIMARY KEY`, `UNIQUE` and `EXCLUDE`, and only for those: a plain
   * `CREATE UNIQUE INDEX` has no `pg_constraint` row at all, so it survives.
   *
   * Nothing to do with {@link indexFacets}, which says which *attributes* of an index diffing may
   * compare. This one decides which indexes are reported at all.
   */
  protected readonly constraintIndexTypes: readonly string[] = ['p', 'u', 'x'];

  protected getForeignKeysQuery(_tableName: string): string {
    return /*sql*/ `
      SELECT
        tc.constraint_name,
        array_to_json(array_agg(kcu.column_name ORDER BY kcu.ordinal_position)) AS columns,
        ccu.table_name AS referenced_table,
        array_to_json(array_agg(ccu.column_name ORDER BY kcu.ordinal_position)) AS referenced_columns,
        rc.delete_rule,
        rc.update_rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      JOIN information_schema.referential_constraints rc
        ON rc.constraint_name = tc.constraint_name
        AND rc.constraint_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_name = $1
        AND tc.table_schema = 'public'
      GROUP BY tc.constraint_name, ccu.table_name, rc.delete_rule, rc.update_rule
      ORDER BY tc.constraint_name
    `;
  }

  protected getPrimaryKeyQuery(_tableName: string): string {
    return /*sql*/ `
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_name = $1
        AND tc.table_schema = 'public'
      ORDER BY kcu.ordinal_position
    `;
  }

  protected async mapColumnsResult(
    _read: TableRowReader,
    _tableName: string,
    results: PostgresColumnRow[],
  ): Promise<ColumnSchema[]> {
    return results.map((row) => ({
      name: row.column_name,
      type: this.normalizeType(row.data_type, row.udt_name),
      nullable: row.is_nullable === 'YES',
      defaultValue: this.parseDefaultValue(row.column_default),
      isPrimaryKey: row.is_primary_key,
      isAutoIncrement: this.isAutoIncrement(row.column_default, row.is_identity),
      isUnique: row.is_unique,
      length: row.character_maximum_length ?? undefined,
      precision: row.numeric_precision ?? undefined,
      scale: row.numeric_scale ?? undefined,
      comment: row.column_comment ?? undefined,
    }));
  }

  protected async mapIndexesResult(
    _read: TableRowReader,
    _tableName: string,
    results: PostgresIndexRow[],
  ): Promise<IndexSchema[]> {
    // One row per index entry, ordered by position, so the rows of an index are its entries in order.
    return [...Map.groupBy(results, (row) => row.index_name)].map(([name, rows]) => {
      const include = rows.filter((row) => !row.is_key).map((row) => row.entry);
      return {
        name,
        entries: rows.filter((row) => row.is_key).map(mapIndexEntry),
        unique: rows[0].is_unique,
        type: INDEX_TYPES.find((type) => type === rows[0].method),
        where: rows[0].predicate ?? undefined,
        include: include.length > 0 ? include : undefined,
      };
    });
  }

  protected async mapForeignKeysResult(
    _read: TableRowReader,
    _tableName: string,
    results: {
      constraint_name: string;
      columns: string[];
      referenced_table: string;
      referenced_columns: string[];
      delete_rule: string;
      update_rule: string;
    }[],
  ): Promise<ForeignKeySchema[]> {
    return results.map((row) => ({
      name: row.constraint_name,
      columns: row.columns,
      referencedTable: row.referenced_table,
      referencedColumns: row.referenced_columns,
      onDelete: this.normalizeReferentialAction(row.delete_rule),
      onUpdate: this.normalizeReferentialAction(row.update_rule),
    }));
  }

  protected normalizeType(dataType: string, udtName: string): string {
    // Handle user-defined types and arrays
    if (dataType === 'USER-DEFINED') {
      return udtName.toUpperCase();
    }
    if (dataType === 'ARRAY') {
      return `${udtName.replace(/^_/, '').toUpperCase()}[]`;
    }
    return dataType.toUpperCase();
  }

  protected parseDefaultValue(defaultValue: string | null): unknown {
    if (!defaultValue) {
      return undefined;
    }

    // Remove type casting (e.g., ::text, ::character varying, ::text[])
    const cleaned = defaultValue.replace(/::[a-z_]+(\s+[a-z_]+)?(\[\])?/gi, '').trim();

    if (cleaned.startsWith("'") && cleaned.endsWith("'")) {
      return cleaned.slice(1, -1);
    }
    if (cleaned === 'true' || cleaned === 'false') {
      return cleaned === 'true';
    }
    if (cleaned === 'NULL') {
      return null;
    }
    if (/^-?\d+$/.test(cleaned)) {
      return Number.parseInt(cleaned, 10);
    }
    if (/^-?\d+\.\d+$/.test(cleaned)) {
      return Number.parseFloat(cleaned);
    }

    // Return cleaned value for functions like CURRENT_TIMESTAMP, nextval(), etc.
    return cleaned;
  }

  protected isAutoIncrement(columnDefault: string | null, isIdentity: string): boolean {
    // PostgreSQL identity columns (GENERATED ... AS IDENTITY)
    if (isIdentity === 'YES') {
      return true;
    }
    // Serial/bigserial columns use nextval()
    return columnDefault?.includes('nextval(') ?? false;
  }
}

/**
 * Postgres states every entry in full: a plain column still reports `order: 'asc'`, and only a
 * non-default operator class is named. The diff defaults the entity side to match, so an option
 * omitted there and one written out are not read as two different indexes.
 */
function mapIndexEntry(row: PostgresIndexRow): IndexColumnSchema {
  return {
    column: row.entry,
    ...(row.is_expression && { expression: true }),
    order: row.descending ? 'desc' : 'asc',
    nulls: row.nulls_first ? 'first' : 'last',
    ...(row.ops_class && { opsClass: row.ops_class }),
  };
}

/**
 * CockroachDB answers the same catalogue queries and differs only in what it can express: v26.2.5
 * still rejects `NULLS FIRST/LAST` and operator classes as "unimplemented", and it sorts nulls first
 * on an ASC column where Postgres sorts them last. Reading a nulls order back would therefore report
 * every ascending index as drifted, against an entity that could not have asked for one. Its access
 * method, `prefix`, needs nothing: a method that is not a known index type is reported as no type.
 */
export class CockroachSchemaIntrospector extends PostgresSchemaIntrospector {
  override readonly indexFacets: ReadonlySet<IndexFacet> = new Set<IndexFacet>(['order', 'include']);

  /**
   * `'u'` is missing on purpose. CockroachDB registers a `UNIQUE` constraint for a plain `CREATE
   * UNIQUE INDEX` too, naming it after the index, so filtering on it would hide every unique index a
   * user asked for and report it missing forever. It leaves no way to tell the two apart, so the
   * index a `@Field({ unique })` builds underneath itself stays visible there.
   */
  protected override readonly constraintIndexTypes: readonly string[] = ['p', 'x'];
}

/** One entry of one index; what the index itself is repeats across its rows. */
type PostgresIndexRow = {
  index_name: string;
  is_unique: boolean;
  method: string;
  predicate: string | null;
  is_key: boolean;
  is_expression: boolean;
  entry: string;
  descending: boolean;
  nulls_first: boolean;
  ops_class: string | null;
};

type PostgresColumnRow = {
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: string;
  column_default: string | null;
  is_primary_key: boolean;
  is_identity: string;
  is_unique: boolean;
  character_maximum_length: number | null;
  numeric_precision: number | null;
  numeric_scale: number | null;
  column_comment: string | null;
};
