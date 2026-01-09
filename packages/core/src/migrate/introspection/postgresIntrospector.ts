import type {
  ColumnSchema,
  ForeignKeySchema,
  IndexSchema,
  QuerierPool,
  SchemaIntrospector,
  SqlQuerier,
  TableSchema,
} from '../../type/index.js';
import { isSqlQuerier } from '../../type/index.js';
import { BaseSqlIntrospector } from './baseSqlIntrospector.js';

/**
 * PostgreSQL schema introspector
 */
export class PostgresSchemaIntrospector extends BaseSqlIntrospector implements SchemaIntrospector {
  constructor(private readonly pool: QuerierPool) {
    super('postgres');
  }

  async getTableSchema(tableName: string): Promise<TableSchema | undefined> {
    const querier = await this.getQuerier();

    try {
      const exists = await this.tableExistsInternal(querier, tableName);
      if (!exists) {
        return undefined;
      }

      const [columns, indexes, foreignKeys, primaryKey] = await Promise.all([
        this.getColumns(querier, tableName),
        this.getIndexes(querier, tableName),
        this.getForeignKeys(querier, tableName),
        this.getPrimaryKey(querier, tableName),
      ]);

      return {
        name: tableName,
        columns,
        primaryKey,
        indexes,
        foreignKeys,
      };
    } finally {
      await querier.release();
    }
  }

  async getTableNames(): Promise<string[]> {
    const querier = await this.getQuerier();

    try {
      const sql = `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type = 'BASE TABLE'
        ORDER BY table_name
      `;

      const results = await querier.all<{ table_name: string }>(sql);
      return results.map((r) => r.table_name);
    } finally {
      await querier.release();
    }
  }

  async tableExists(tableName: string): Promise<boolean> {
    const querier = await this.getQuerier();

    try {
      return this.tableExistsInternal(querier, tableName);
    } finally {
      await querier.release();
    }
  }

  protected async tableExistsInternal(querier: SqlQuerier, tableName: string): Promise<boolean> {
    const sql = `
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = $1
      ) AS exists
    `;

    const results = await querier.all<{ exists: boolean }>(sql, [tableName]);
    return results[0]?.exists ?? false;
  }

  protected async getQuerier(): Promise<SqlQuerier> {
    const querier = await this.pool.getQuerier();

    if (!isSqlQuerier(querier)) {
      await querier.release();
      throw new Error('PostgresSchemaIntrospector requires a SQL-based querier');
    }

    return querier;
  }

  protected async getColumns(querier: SqlQuerier, tableName: string): Promise<ColumnSchema[]> {
    const sql = /*sql*/ `
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

    const results = await querier.all<{
      column_name: string;
      data_type: string;
      udt_name: string;
      is_nullable: string;
      column_default: string | null;
      character_maximum_length: number | null;
      numeric_precision: number | null;
      numeric_scale: number | null;
      is_identity: string;
      identity_generation: string | null;
      is_primary_key: boolean;
      is_unique: boolean;
      column_comment: string | null;
    }>(sql, [tableName]);

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

  protected async getIndexes(querier: SqlQuerier, tableName: string): Promise<IndexSchema[]> {
    const sql = /*sql*/ `
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

    const results = await querier.all<{
      index_name: string;
      columns: string[];
      is_unique: boolean;
    }>(sql, [tableName]);

    return results.map((row) => ({
      name: row.index_name,
      columns: row.columns,
      unique: row.is_unique,
    }));
  }

  protected async getForeignKeys(querier: SqlQuerier, tableName: string): Promise<ForeignKeySchema[]> {
    const sql = /*sql*/ `
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

    const results = await querier.all<{
      constraint_name: string;
      columns: string[];
      referenced_table: string;
      referenced_columns: string[];
      delete_rule: string;
      update_rule: string;
    }>(sql, [tableName]);

    return results.map((row) => ({
      name: row.constraint_name,
      columns: row.columns,
      referencedTable: row.referenced_table,
      referencedColumns: row.referenced_columns,
      onDelete: this.normalizeReferentialAction(row.delete_rule),
      onUpdate: this.normalizeReferentialAction(row.update_rule),
    }));
  }

  protected async getPrimaryKey(querier: SqlQuerier, tableName: string): Promise<string[] | undefined> {
    const sql = /*sql*/ `
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

    const results = await querier.all<{ column_name: string }>(sql, [tableName]);

    if (results.length === 0) {
      return undefined;
    }

    return results.map((r) => r.column_name);
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

    // Check for common patterns
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

  protected normalizeReferentialAction(action: string): 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION' | undefined {
    switch (action.toUpperCase()) {
      case 'CASCADE':
        return 'CASCADE';
      case 'SET NULL':
        return 'SET NULL';
      case 'RESTRICT':
        return 'RESTRICT';
      case 'NO ACTION':
        return 'NO ACTION';
      default:
        return undefined;
    }
  }
}
