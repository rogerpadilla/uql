import type { ColumnSchema, ForeignKeySchema, IndexSchema, QuerierPool, RawRow, SqlQuerier } from '../../type/index.js';
import { AbstractSqlSchemaIntrospector } from './abstractSqlSchemaIntrospector.js';

/**
 * PostgreSQL schema introspector
 */
export class PostgresSchemaIntrospector extends AbstractSqlSchemaIntrospector {
  protected readonly pool: QuerierPool;

  constructor(pool: QuerierPool) {
    super('postgres');
    this.pool = pool;
  }

  // ============================================================================
  // SQL Queries (dialect-specific)
  // ============================================================================

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

  protected getIndexesQuery(_tableName: string): string {
    return /*sql*/ `
      SELECT
        i.relname AS index_name,
        array_to_json(array_agg(a.attname ORDER BY k.n)) AS columns,
        ix.indisunique AS is_unique
      FROM pg_class t
      JOIN pg_index ix ON t.oid = ix.indrelid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      CROSS JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, n)
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
      WHERE t.relname = $1
        AND n.nspname = 'public'
        AND NOT ix.indisprimary
      GROUP BY i.relname, ix.indisunique
      ORDER BY i.relname
    `;
  }

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

  // ============================================================================
  // Internal Types
  // ============================================================================

  protected mapTableNameRow(row: { table_name: string }): string {
    return row.table_name;
  }

  protected async mapColumnsResult(
    _querier: SqlQuerier,
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
    _querier: SqlQuerier,
    _tableName: string,
    results: { index_name: string; columns: string[]; is_unique: boolean }[],
  ): Promise<IndexSchema[]> {
    return results.map((row) => ({
      name: row.index_name,
      columns: row.columns,
      unique: row.is_unique,
    }));
  }

  protected async mapForeignKeysResult(
    _querier: SqlQuerier,
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

  protected mapPrimaryKeyResult(results: { column_name: string }[]): string[] | undefined {
    if (results.length === 0) {
      return undefined;
    }
    return results.map((r) => r.column_name);
  }

  // ============================================================================
  // PostgreSQL-specific helpers
  // ============================================================================

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
