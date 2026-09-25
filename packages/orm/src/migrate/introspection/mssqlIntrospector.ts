import { defaultTimestampPrecision } from '../../schema/canonicalType.js';
import type { ColumnSchema, ForeignKeySchema, IndexSchema } from '../../type/index.js';
import {
  AbstractSqlSchemaIntrospector,
  type JoinedForeignKeyRow,
  type TableRowReader,
} from './abstractSqlSchemaIntrospector.js';

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

  protected triggersQuery(): string {
    return /*sql*/ `
      SELECT t.name AS name, m.definition AS definition
      FROM sys.triggers t
      JOIN sys.sql_modules m ON m.object_id = t.object_id
      WHERE t.parent_id <> 0 AND OBJECT_SCHEMA_NAME(t.parent_id) = ${this.schemaExpr}
        AND OBJECT_NAME(t.parent_id) = ${this.dialect.placeholder(1)}
    `;
  }

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

  protected parseTableExistsResult([row]: { count: number }[]): boolean {
    return row.count > 0;
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
        f.is_unique,
        CASE WHEN cc.is_persisted = 1 THEN cc.definition END as generated_as
      FROM sys.columns c
      JOIN sys.objects o ON o.object_id = c.object_id
      JOIN sys.schemas s ON s.schema_id = o.schema_id
      JOIN sys.types t ON t.user_type_id = c.user_type_id
      LEFT JOIN sys.default_constraints d ON d.object_id = c.default_object_id
      LEFT JOIN sys.computed_columns cc ON cc.object_id = c.object_id AND cc.column_id = c.column_id
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
        type: spelledType(type, bytes, this.toNumber(row.numeric_scale)),
        nullable: Boolean(row.is_nullable),
        defaultValue: this.parseDefaultValue(row.column_default),
        isAutoIncrement: Boolean(row.is_identity),
        isPrimaryKey: Boolean(row.is_primary_key),
        isUnique: Boolean(row.is_unique),
        length: widthOf(type, bytes),
        precision: NUMERIC_TYPES.has(type) ? this.toNumber(row.numeric_precision) : undefined,
        scale: NUMERIC_TYPES.has(type) ? this.toNumber(row.numeric_scale) : undefined,
        generatedAs: row.generated_as ?? undefined,
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
      entries: row.columns.split(',').map((column) => ({ column })),
      unique: Boolean(row.is_unique),
    }));
  }

  protected async mapForeignKeysResult(
    _read: TableRowReader,
    _tableName: string,
    results: JoinedForeignKeyRow[],
  ): Promise<ForeignKeySchema[]> {
    return this.joinedForeignKeys(results);
  }

  /**
   * The engine reprints a default from its own parse tree: all of it in one pair of parentheses, and a
   * number in a second, so `((0))`, `((1)+(2))`, `(N'x')` and `(getdate())`.
   */
  protected parseDefaultValue(defaultValue: string | null): unknown {
    if (defaultValue === null) {
      return undefined;
    }
    const text = defaultValue.slice(1, -1);
    const number = /^\((-?\d+(?:\.\d+)?)\)$/.exec(text);
    if (number) {
      return Number(number[1]);
    }
    const quoted = /^N?'(.*)'$/s.exec(text);
    if (quoted) {
      return quoted[1].replaceAll("''", "'");
    }
    return text === 'NULL' ? null : text;
  }
}

/** The types whose `max_length` is a width rather than a fixed storage size. */
const CHARACTER_TYPES = new Set(['CHAR', 'NCHAR', 'VARCHAR', 'NVARCHAR', 'BINARY', 'VARBINARY']);

const NUMERIC_TYPES = new Set(['DECIMAL', 'NUMERIC']);

/** `(MAX)` on an unbounded character type, and a timestamp's fractional digits where not the engine's default. */
function spelledType(type: string, bytes: number | undefined, scale: number | undefined): string {
  if (bytes === -1 && CHARACTER_TYPES.has(type)) {
    return `${type}(MAX)`;
  }
  return (type === 'DATETIME2' || type === 'DATETIMEOFFSET') &&
    scale !== undefined &&
    scale !== defaultTimestampPrecision('mssql')
    ? `${type}(${scale})`
    : type;
}

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
  generated_as: string | null;
};
