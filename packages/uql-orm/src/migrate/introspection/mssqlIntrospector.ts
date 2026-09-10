import type { ColumnSchema, ForeignKeySchema, IndexSchema } from '../../type/index.js';
import { AbstractSqlSchemaIntrospector, type TableRowReader } from './abstractSqlSchemaIntrospector.js';

/**
 * SQL Server schema introspector.
 *
 * `INFORMATION_SCHEMA` answers columns and foreign keys, but not indexes: it has no view for them at
 * all, and its `CONSTRAINT_COLUMN_USAGE` conflates a unique index with a unique constraint. Those
 * come from `sys.indexes` instead, which is also the only place the filtered-index predicate and the
 * included columns are readable.
 */
export class MsSqlSchemaIntrospector extends AbstractSqlSchemaIntrospector {
  protected override readonly defaultSchemaExpr = 'SCHEMA_NAME()';

  protected getTableNamesQuery(): string {
    return /*sql*/ `
      SELECT TABLE_NAME as table_name
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = ${this.schemaExpr}
        AND TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_NAME
    `;
  }

  protected tableExistsQuery(): string {
    return /*sql*/ `
      SELECT COUNT(*) as count
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = ${this.schemaExpr}
        AND TABLE_NAME = @p1
    `;
  }

  protected parseTableExistsResult(results: { count?: number }[]): boolean {
    return (this.toNumber(results[0]?.count) ?? 0) > 0;
  }

  /**
   * From `sys` rather than `INFORMATION_SCHEMA`, which has no identity flag and no per-column view of
   * the key or of a unique index. A key column is not also `isUnique`, as on MySQL: only a unique index
   * of its own, other than the key's, makes it so.
   */
  protected getColumnsQuery(_tableName: string): string {
    return /*sql*/ `
      SELECT
        c.name as column_name,
        t.name as data_type,
        c.max_length as max_length,
        c.precision as numeric_precision,
        c.scale as numeric_scale,
        c.is_nullable as is_nullable,
        c.is_identity as is_identity,
        d.definition as column_default,
        f.is_primary_key,
        f.is_unique
      FROM sys.columns c
      JOIN sys.objects o ON o.object_id = c.object_id
      JOIN sys.schemas s ON s.schema_id = o.schema_id
      JOIN sys.types t ON t.user_type_id = c.user_type_id
      LEFT JOIN sys.default_constraints d ON d.object_id = c.default_object_id
      OUTER APPLY (
        SELECT
          MAX(CAST(i.is_primary_key AS INT)) as is_primary_key,
          MAX(CASE WHEN i.is_primary_key = 0 AND n.key_columns = 1 THEN 1 ELSE 0 END) as is_unique
        FROM sys.index_columns ic
        JOIN sys.indexes i ON i.object_id = ic.object_id AND i.index_id = ic.index_id
        CROSS APPLY (
          SELECT COUNT(*) as key_columns FROM sys.index_columns k
          WHERE k.object_id = i.object_id AND k.index_id = i.index_id AND k.is_included_column = 0
        ) n
        WHERE ic.object_id = c.object_id AND ic.column_id = c.column_id
          AND ic.is_included_column = 0 AND i.is_unique = 1
      ) f
      WHERE s.name = ${this.schemaExpr} AND o.name = @p1
      ORDER BY c.column_id
    `;
  }

  /** `is_primary_key` is excluded: the key is read separately, the way every other engine reads it. */
  protected getIndexesQuery(_tableName: string): string {
    return /*sql*/ `
      SELECT
        i.name as index_name,
        i.is_unique as is_unique,
        STRING_AGG(c.name, ',') WITHIN GROUP (ORDER BY ic.key_ordinal) as columns
      FROM sys.indexes i
      JOIN sys.objects o ON o.object_id = i.object_id
      JOIN sys.schemas s ON s.schema_id = o.schema_id
      JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
      JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
      WHERE s.name = ${this.schemaExpr} AND o.name = @p1
        AND i.is_primary_key = 0 AND i.name IS NOT NULL AND ic.is_included_column = 0
      GROUP BY i.name, i.is_unique
      ORDER BY i.name
    `;
  }

  protected getForeignKeysQuery(_tableName: string): string {
    return /*sql*/ `
      SELECT
        fk.name as constraint_name,
        STRING_AGG(pc.name, ',') WITHIN GROUP (ORDER BY fkc.constraint_column_id) as columns,
        rt.name as referenced_table,
        STRING_AGG(rc.name, ',') WITHIN GROUP (ORDER BY fkc.constraint_column_id) as referenced_columns,
        fk.delete_referential_action_desc as delete_rule,
        fk.update_referential_action_desc as update_rule
      FROM sys.foreign_keys fk
      JOIN sys.objects o ON o.object_id = fk.parent_object_id
      JOIN sys.schemas s ON s.schema_id = o.schema_id
      JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
      JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
      JOIN sys.objects rt ON rt.object_id = fk.referenced_object_id
      JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
      WHERE s.name = ${this.schemaExpr} AND o.name = @p1
      GROUP BY fk.name, rt.name, fk.delete_referential_action_desc, fk.update_referential_action_desc
      ORDER BY fk.name
    `;
  }

  protected getPrimaryKeyQuery(_tableName: string): string {
    return /*sql*/ `
      SELECT c.name as column_name, i.name as constraint_name
      FROM sys.indexes i
      JOIN sys.objects o ON o.object_id = i.object_id
      JOIN sys.schemas s ON s.schema_id = o.schema_id
      JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
      JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
      WHERE s.name = ${this.schemaExpr} AND o.name = @p1 AND i.is_primary_key = 1
      ORDER BY ic.key_ordinal
    `;
  }

  protected async mapColumnsResult(
    _read: TableRowReader,
    _tableName: string,
    results: MsSqlColumnRow[],
  ): Promise<ColumnSchema[]> {
    return results.map((row) => {
      const type = row.data_type.toUpperCase();
      const bytes = this.toNumber(row.max_length);
      return {
        name: row.column_name,
        type: bytes === -1 && CHARACTER_TYPES.has(type) ? `${type}(MAX)` : type,
        nullable: Boolean(row.is_nullable),
        defaultValue: this.parseDefaultValue(row.column_default),
        isAutoIncrement: Boolean(row.is_identity),
        isPrimaryKey: Boolean(row.is_primary_key),
        isUnique: Boolean(row.is_unique),
        length: widthOf(type, bytes),
        precision: NUMERIC_TYPES.has(type) ? this.toNumber(row.numeric_precision) : undefined,
        scale: NUMERIC_TYPES.has(type) ? this.toNumber(row.numeric_scale) : undefined,
      };
    });
  }

  protected async mapIndexesResult(
    _read: TableRowReader,
    _tableName: string,
    results: { index_name: string; columns: string; is_unique: boolean }[],
  ): Promise<IndexSchema[]> {
    return results.map((row) => ({
      name: row.index_name,
      entries: (row.columns ?? '').split(',').map((column) => ({ column })),
      unique: Boolean(row.is_unique),
    }));
  }

  protected async mapForeignKeysResult(
    _read: TableRowReader,
    _tableName: string,
    results: {
      constraint_name: string;
      columns: string;
      referenced_table: string;
      referenced_columns: string;
      delete_rule: string;
      update_rule: string;
    }[],
  ): Promise<ForeignKeySchema[]> {
    return results.map((row) => ({
      name: row.constraint_name,
      columns: (row.columns || '').split(','),
      references: { table: row.referenced_table, columns: (row.referenced_columns || '').split(',') },
      // `sys` spells them with an underscore: `SET_NULL`, `NO_ACTION`.
      onDelete: this.normalizeReferentialAction((row.delete_rule || '').replaceAll('_', ' ')),
      onUpdate: this.normalizeReferentialAction((row.update_rule || '').replaceAll('_', ' ')),
    }));
  }

  /**
   * A default is stored wrapped in at least one layer of parentheses - `((0))` for a number,
   * `(N'x')` for a string - because the engine reprints it from its own parse tree.
   */
  protected parseDefaultValue(defaultValue: string | null): unknown {
    if (defaultValue === null || defaultValue === undefined) {
      return undefined;
    }
    let text = defaultValue.trim();
    while (text.startsWith('(') && text.endsWith(')')) {
      text = text.slice(1, -1).trim();
    }
    if (text.toUpperCase() === 'NULL') {
      return null;
    }
    const unicode = text.startsWith("N'") ? text.slice(1) : text;
    if (unicode.startsWith("'") && unicode.endsWith("'")) {
      return unicode.slice(1, -1).replaceAll("''", "'");
    }
    if (/^-?\d+$/.test(text)) {
      return Number.parseInt(text, 10);
    }
    if (/^-?\d+\.\d+$/.test(text)) {
      return Number.parseFloat(text);
    }
    return text;
  }
}

/** The types whose `max_length` is a width rather than a fixed storage size. */
const CHARACTER_TYPES = new Set(['CHAR', 'NCHAR', 'VARCHAR', 'NVARCHAR', 'BINARY', 'VARBINARY']);

const NUMERIC_TYPES = new Set(['DECIMAL', 'NUMERIC']);

/**
 * A column's declared width from `max_length`, which is bytes: an `N` type holds two a character, a
 * `VECTOR` is an 8-byte header and four a dimension, and `MAX` is `-1`. Read as bytes, every Unicode
 * column would drift to double its width against the entity that declared it.
 */
function widthOf(type: string, bytes: number | undefined): number | undefined {
  if (bytes === undefined || bytes < 0) {
    return undefined;
  }
  if (type === 'VECTOR') {
    return (bytes - 8) / 4;
  }
  if (!CHARACTER_TYPES.has(type)) {
    return undefined;
  }
  return type.startsWith('N') ? bytes / 2 : bytes;
}

type MsSqlColumnRow = {
  column_name: string;
  data_type: string;
  max_length: number | null;
  numeric_precision: number | null;
  numeric_scale: number | null;
  is_nullable: boolean;
  is_identity: boolean;
  column_default: string | null;
  is_primary_key: number | null;
  is_unique: number | null;
};
