import type { ColumnSchema, ForeignKeySchema, IndexSchema, QuerierPool, SqlQuerier } from '../../type/index.js';
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

  protected parseTableExistsResult(results: Record<string, unknown>[]): boolean {
    return (results[0]?.exists as boolean) ?? false;
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
  // Row Mapping (dialect-specific)
  // ============================================================================

  protected mapTableNameRow(row: Record<string, unknown>): string {
    return row.table_name as string;
  }

  protected async mapColumnsResult(
    _querier: SqlQuerier,
    _tableName: string,
    results: Record<string, unknown>[],
  ): Promise<ColumnSchema[]> {
    return results.map((row) => ({
      name: row.column_name as string,
      type: this.normalizeType(row.data_type as string, row.udt_name as string),
      nullable: row.is_nullable === 'YES',
      defaultValue: this.parseDefaultValue(row.column_default as string | null),
      isPrimaryKey: row.is_primary_key as boolean,
      isAutoIncrement: this.isAutoIncrement(row.column_default as string | null, row.is_identity as string),
      isUnique: row.is_unique as boolean,
      length: (row.character_maximum_length as number) ?? undefined,
      precision: (row.numeric_precision as number) ?? undefined,
      scale: (row.numeric_scale as number) ?? undefined,
      comment: (row.column_comment as string) ?? undefined,
    }));
  }

  protected async mapIndexesResult(
    _querier: SqlQuerier,
    _tableName: string,
    results: Record<string, unknown>[],
  ): Promise<IndexSchema[]> {
    return results.map((row) => ({
      name: row.index_name as string,
      columns: row.columns as string[],
      unique: row.is_unique as boolean,
    }));
  }

  protected async mapForeignKeysResult(
    _querier: SqlQuerier,
    _tableName: string,
    results: Record<string, unknown>[],
  ): Promise<ForeignKeySchema[]> {
    return results.map((row) => ({
      name: row.constraint_name as string,
      columns: row.columns as string[],
      referencedTable: row.referenced_table as string,
      referencedColumns: row.referenced_columns as string[],
      onDelete: this.normalizeReferentialAction(row.delete_rule as string),
      onUpdate: this.normalizeReferentialAction(row.update_rule as string),
    }));
  }

  protected mapPrimaryKeyResult(results: Record<string, unknown>[]): string[] | undefined {
    if (results.length === 0) {
      return undefined;
    }
    return results.map((r) => r.column_name as string);
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

  protected isAutoIncrement(defaultValue: string | null, isIdentity: string): boolean {
    // PostgreSQL identity columns (GENERATED ... AS IDENTITY)
    if (isIdentity === 'YES') {
      return true;
    }
    // Serial/bigserial columns use nextval()
    if (defaultValue?.includes('nextval(')) {
      return true;
    }
    return false;
  }
}
