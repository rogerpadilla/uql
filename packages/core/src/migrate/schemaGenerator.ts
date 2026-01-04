import { AbstractDialect } from '../dialect/index.js';
import { getMeta } from '../entity/index.js';
import type {
  ColumnSchema,
  ColumnType,
  EntityMeta,
  FieldKey,
  FieldOptions,
  IndexSchema,
  NamingStrategy,
  SchemaDiff,
  SchemaGenerator,
  TableSchema,
  Type,
} from '../type/index.js';
import { escapeSqlId, getKeys, isAutoIncrement, isNumericType } from '../util/index.js';

/**
 * Abstract base class for SQL schema generation
 */
export abstract class AbstractSchemaGenerator extends AbstractDialect implements SchemaGenerator {
  /**
   * Primary key type for auto-increment integer IDs
   */
  protected abstract readonly serialPrimaryKeyType: string;

  constructor(
    namingStrategy?: NamingStrategy,
    protected readonly escapeIdChar: '`' | '"' = '`',
  ) {
    super(namingStrategy);
  }

  /**
   * Escape an identifier (table name, column name, etc.)
   */
  protected escapeId(identifier: string): string {
    return escapeSqlId(identifier, this.escapeIdChar);
  }

  generateCreateTable<E>(entity: Type<E>, options: { ifNotExists?: boolean } = {}): string {
    const meta = getMeta(entity);
    const tableName = this.resolveTableName(entity, meta);
    const columns = this.generateColumnDefinitions(meta);
    const constraints = this.generateTableConstraints(meta);

    const ifNotExists = options.ifNotExists ? 'IF NOT EXISTS ' : '';
    let sql = `CREATE TABLE ${ifNotExists}${this.escapeId(tableName)} (\n`;
    sql += columns.map((col) => `  ${col}`).join(',\n');

    if (constraints.length > 0) {
      sql += ',\n';
      sql += constraints.map((c: any) => `  ${c}`).join(',\n');
    }

    sql += '\n)';
    sql += this.getTableOptions(meta);
    sql += ';';

    return sql;
  }

  generateDropTable<E>(entity: Type<E>): string {
    const meta = getMeta(entity);
    const tableName = this.resolveTableName(entity, meta);
    return `DROP TABLE IF EXISTS ${this.escapeId(tableName)};`;
  }

  generateAlterTable(diff: SchemaDiff): string[] {
    const statements: string[] = [];
    const tableName = this.escapeId(diff.tableName);

    // Add new columns
    if (diff.columnsToAdd?.length) {
      for (const column of diff.columnsToAdd) {
        const colDef = this.generateColumnDefinitionFromSchema(column);
        statements.push(`ALTER TABLE ${tableName} ADD COLUMN ${colDef};`);
      }
    }

    // Alter existing columns
    if (diff.columnsToAlter?.length) {
      for (const { to } of diff.columnsToAlter) {
        const colDef = this.generateColumnDefinitionFromSchema(to);
        const colStatements = this.generateAlterColumnStatements(diff.tableName, to, colDef);
        statements.push(...colStatements);
      }
    }

    // Drop columns
    if (diff.columnsToDrop?.length) {
      for (const columnName of diff.columnsToDrop) {
        statements.push(`ALTER TABLE ${tableName} DROP COLUMN ${this.escapeId(columnName)};`);
      }
    }

    // Add indexes
    if (diff.indexesToAdd?.length) {
      for (const index of diff.indexesToAdd) {
        statements.push(this.generateCreateIndex(diff.tableName, index));
      }
    }

    // Drop indexes
    if (diff.indexesToDrop?.length) {
      for (const indexName of diff.indexesToDrop) {
        statements.push(this.generateDropIndex(diff.tableName, indexName));
      }
    }

    return statements;
  }

  generateAlterTableDown(diff: SchemaDiff): string[] {
    const statements: string[] = [];
    const tableName = this.escapeId(diff.tableName);

    // Rollback additions by dropping columns
    if (diff.columnsToAdd?.length) {
      for (const column of diff.columnsToAdd) {
        statements.push(`ALTER TABLE ${tableName} DROP COLUMN ${this.escapeId(column.name)};`);
      }
    }

    return statements;
  }

  generateCreateIndex(tableName: string, index: IndexSchema): string {
    const unique = index.unique ? 'UNIQUE ' : '';
    const columns = index.columns.map((c: any) => this.escapeId(c)).join(', ');
    return `CREATE ${unique}INDEX ${this.escapeId(index.name)} ON ${this.escapeId(tableName)} (${columns});`;
  }

  generateDropIndex(tableName: string, indexName: string): string {
    return `DROP INDEX IF EXISTS ${this.escapeId(indexName)};`;
  }

  /**
   * Generate column definitions from entity metadata
   */
  public generateColumnDefinitions<E>(meta: EntityMeta<E>): string[] {
    const columns: string[] = [];
    const fieldKeys = getKeys(meta.fields) as FieldKey<E>[];

    for (const key of fieldKeys) {
      const field = meta.fields[key];
      if (field?.virtual) continue; // Skip virtual fields

      const colDef = this.generateColumnDefinition(key as string, field, meta);
      columns.push(colDef);
    }

    return columns;
  }

  /**
   * Generate a single column definition
   */
  public generateColumnDefinition<E>(fieldKey: string, field: FieldOptions, meta: EntityMeta<E>): string {
    const column = this.fieldToColumnSchema(fieldKey, field, meta);
    const tableName = this.resolveTableName(meta.entity, meta);

    const sqlType = column.isAutoIncrement ? this.serialPrimaryKeyType : column.type;
    let definition = `${this.escapeId(column.name)} ${sqlType}`;

    // PRIMARY KEY constraint (for non-serial types)
    if (column.isPrimaryKey && !sqlType.includes('PRIMARY KEY')) {
      definition += ' PRIMARY KEY';
    }

    // NULL/NOT NULL and UNIQUE
    if (!column.isPrimaryKey) {
      if (!column.nullable) definition += ' NOT NULL';
      if (column.isUnique) definition += ' UNIQUE';
    }

    // DEFAULT value
    if (column.defaultValue !== undefined) {
      definition += ` DEFAULT ${this.formatDefaultValue(column.defaultValue)}`;
    }

    // COMMENT (if supported)
    if (column.comment) {
      definition += this.generateColumnComment(tableName, column.name, column.comment);
    }

    return definition;
  }

  /**
   * Generate column definition from a ColumnSchema object
   */
  public generateColumnDefinitionFromSchema(
    column: ColumnSchema,
    options: { includePrimaryKey?: boolean; includeUnique?: boolean } = {},
  ): string {
    const { includePrimaryKey = true, includeUnique = true } = options;
    const isAutoIncrement = column.isAutoIncrement && !column.type.includes('IDENTITY');

    let type = isAutoIncrement && this.serialPrimaryKeyType ? this.serialPrimaryKeyType : column.type;

    // Some serial types (e.g. Postgres IDENTITY or MySQL AUTO_INCREMENT) include "PRIMARY KEY"
    // in their definition string. We strip it if includePrimaryKey is false to avoid double PK errors.
    if (!includePrimaryKey) {
      type = type.replace(/\s+PRIMARY\s+KEY/i, '');
    }

    if (column.length && !type.includes('(')) {
      type = `${type}(${column.length})`;
    } else if (column.precision !== undefined && !type.includes('(')) {
      if (column.scale !== undefined) {
        type = `${type}(${column.precision}, ${column.scale})`;
      } else {
        type = `${type}(${column.precision})`;
      }
    }

    let definition = `${this.escapeId(column.name)} ${type}`;

    if (includePrimaryKey && column.isPrimaryKey && !type.includes('PRIMARY KEY')) {
      definition += ' PRIMARY KEY';
    }

    if (!column.nullable && !column.isPrimaryKey) {
      definition += ' NOT NULL';
    }

    if (includeUnique && column.isUnique && !column.isPrimaryKey) {
      definition += ' UNIQUE';
    }

    if (column.defaultValue !== undefined) {
      definition += ` DEFAULT ${this.formatDefaultValue(column.defaultValue)}`;
    }

    return definition;
  }

  /**
   * Generate table constraints (indexes, foreign keys, etc.)
   */
  public generateTableConstraints<E>(meta: EntityMeta<E>): string[] {
    const constraints: string[] = [];
    const fieldKeys = getKeys(meta.fields) as FieldKey<E>[];
    const tableName = this.resolveTableName(meta.entity, meta);

    // Generate indexes from field options
    for (const key of fieldKeys) {
      const field = meta.fields[key];
      if (field?.index) {
        const columnName = this.resolveColumnName(key as string, field);
        const indexName = typeof field.index === 'string' ? field.index : `idx_${tableName}_${columnName}`;
        constraints.push(`INDEX ${this.escapeId(indexName)} (${this.escapeId(columnName)})`);
      }
    }

    // Generate foreign key constraints from references
    for (const key of fieldKeys) {
      const field = meta.fields[key];
      if (field?.reference && field.foreignKey !== false) {
        const refEntity = field.reference();
        const refMeta = getMeta(refEntity);
        const refIdField = refMeta.fields[refMeta.id];
        const columnName = this.resolveColumnName(key as string, field);
        const refTableName = this.resolveTableName(refEntity, refMeta);
        const refColumnName = this.resolveColumnName(refMeta.id, refIdField);
        const fkName = typeof field.foreignKey === 'string' ? field.foreignKey : `fk_${tableName}_${columnName}`;

        constraints.push(
          `CONSTRAINT ${this.escapeId(fkName)} FOREIGN KEY (${this.escapeId(columnName)}) ` +
            `REFERENCES ${this.escapeId(refTableName)} (${this.escapeId(refColumnName)})`,
        );
      }
    }

    return constraints;
  }
  public getSqlType(field: FieldOptions, fieldType?: unknown): string {
    // Use explicit column type if specified
    if (field.columnType) {
      return this.mapColumnType(field.columnType, field);
    }

    // Inherit type from referenced field if applicable
    if (field.reference) {
      const refEntity = field.reference();
      const refMeta = getMeta(refEntity);
      const refIdField = refMeta.fields[refMeta.id];
      // Recursively call getSqlType for the referenced ID field
      return this.getSqlType({ ...refIdField, reference: undefined }, refIdField.type);
    }

    // Priority: 1. field.type (explicit logical type)
    //           2. fieldType (inferred TS type)
    const type = field.type ?? fieldType;

    // Handle semantic types (e.g. 'uuid', 'json', 'vector') or any ColumnType string
    if (typeof type === 'string') {
      return this.mapColumnType(type as ColumnType, field);
    }

    if (isNumericType(type)) {
      return field.precision ? this.mapColumnType('decimal', field) : this.mapColumnType('bigint', field);
    }

    if (type === String) {
      return this.mapColumnType('varchar', field);
    }

    if (type === Boolean) {
      return this.getBooleanType();
    }

    if (type === Date) {
      return this.mapColumnType('timestamp', field);
    }

    return this.mapColumnType('varchar', field);
  }

  /**
   * Map uql column type to database-specific SQL type
   */
  public abstract mapColumnType(columnType: ColumnType, field: FieldOptions): string;

  /**
   * Get the boolean type for this database
   */
  public abstract getBooleanType(): string;

  /**
   * Generate ALTER COLUMN statements (database-specific)
   */
  public abstract generateAlterColumnStatements(
    tableName: string,
    column: ColumnSchema,
    newDefinition: string,
  ): string[];

  /**
   * Get table options (e.g., ENGINE for MySQL)
   */
  getTableOptions<E>(meta: EntityMeta<E>): string {
    return '';
  }

  /**
   * Generate column comment clause (if supported)
   */
  public abstract generateColumnComment(tableName: string, columnName: string, comment: string): string;

  /**
   * Format a default value for SQL
   */
  public formatDefaultValue(value: unknown): string {
    if (value === null) {
      return 'NULL';
    }
    if (typeof value === 'string') {
      return `'${value.replace(/'/g, "''")}'`;
    }
    if (typeof value === 'boolean') {
      return value ? 'TRUE' : 'FALSE';
    }
    if (typeof value === 'number' || typeof value === 'bigint') {
      return String(value);
    }
    if (value instanceof Date) {
      return `'${value.toISOString()}'`;
    }
    return String(value);
  }

  /**
   * Compare two schemas and return the differences
   */
  diffSchema<E>(entity: Type<E>, currentSchema: TableSchema | undefined): SchemaDiff | undefined {
    const meta = getMeta(entity);

    if (!currentSchema) {
      // Table doesn't exist, need to create
      return {
        tableName: this.resolveTableName(entity, meta),
        type: 'create',
      };
    }

    const columnsToAdd: ColumnSchema[] = [];
    const columnsToAlter: { from: ColumnSchema; to: ColumnSchema }[] = [];
    const columnsToDrop: string[] = [];

    const currentColumns = new Map(currentSchema.columns.map((c: any) => [c.name, c]));
    const fieldKeys = getKeys(meta.fields) as FieldKey<E>[];

    // Check for new or altered columns
    for (const key of fieldKeys) {
      const field = meta.fields[key];
      if (field?.virtual) continue;

      const columnName = this.resolveColumnName(key as string, field);
      const currentColumn = currentColumns.get(columnName);

      if (!currentColumn) {
        // Column needs to be added
        columnsToAdd.push(this.fieldToColumnSchema(key as string, field, meta));
      } else {
        // Check if column needs alteration
        const desiredColumn = this.fieldToColumnSchema(key as string, field, meta);
        if (this.columnsNeedAlteration(currentColumn, desiredColumn)) {
          columnsToAlter.push({ from: currentColumn, to: desiredColumn });
        }
      }
      currentColumns.delete(columnName);
    }

    // Remaining columns in currentColumns should be dropped
    for (const [name] of currentColumns) {
      columnsToDrop.push(name);
    }

    if (columnsToAdd.length === 0 && columnsToAlter.length === 0 && columnsToDrop.length === 0) {
      return undefined; // No changes needed
    }

    return {
      tableName: this.resolveTableName(entity, meta),
      type: 'alter',
      columnsToAdd: columnsToAdd.length > 0 ? columnsToAdd : undefined,
      columnsToAlter: columnsToAlter.length > 0 ? columnsToAlter : undefined,
      columnsToDrop: columnsToDrop.length > 0 ? columnsToDrop : undefined,
    };
  }

  /**
   * Convert field options to ColumnSchema
   */
  protected fieldToColumnSchema<E>(fieldKey: string, field: FieldOptions, meta: EntityMeta<E>): ColumnSchema {
    const isPrimaryKey = field.isId === true && meta.id === fieldKey;

    return {
      name: this.resolveColumnName(fieldKey, field),
      type: this.getSqlType(field, field.type),
      nullable: field.nullable ?? !isPrimaryKey,
      defaultValue: field.defaultValue,
      isPrimaryKey,
      isAutoIncrement: isAutoIncrement(field, isPrimaryKey),
      isUnique: field.unique ?? false,
      length: field.length,
      precision: field.precision,
      scale: field.scale,
      comment: field.comment,
    };
  }

  /**
   * Check if two columns differ enough to require alteration
   */
  protected columnsNeedAlteration(current: ColumnSchema, desired: ColumnSchema): boolean {
    // If both are primary keys, we skip alteration by default.
    // Altering primary keys is complex, dangerous, and often requires
    // dropping and recreating foreign keys.
    if (current.isPrimaryKey && desired.isPrimaryKey) {
      return false;
    }

    if (current.isPrimaryKey !== desired.isPrimaryKey) return true;
    if (current.nullable !== desired.nullable) return true;
    if (current.isUnique !== desired.isUnique) return true;

    if (!this.isTypeEqual(current, desired)) return true;
    if (!this.isDefaultValueEqual(current.defaultValue, desired.defaultValue)) return true;

    return false;
  }

  /**
   * Compare two column types for equality, accounting for dialect-specific differences
   */
  protected isTypeEqual(current: ColumnSchema, desired: ColumnSchema): boolean {
    const cType = this.normalizeType(current);
    const dType = this.normalizeType(desired);
    return cType === dType;
  }

  /**
   * Normalize a column type string for comparison
   */
  protected normalizeType(column: ColumnSchema): string {
    let type = column.type.toLowerCase();

    // Remove any extra spaces and standardize common aliases
    type = type
      .replace(/\s+/g, '')
      .replace(/^integer$/, 'int')
      .replace(/^boolean$/, 'tinyint(1)') // Common in MySQL
      .replace(/^doubleprecision$/, 'double') // Postgres vs MySQL
      .replace(/^characterany$/, 'varchar')
      .replace(/^charactervarying$/, 'varchar')
      .replace(/generated(always|bydefault)asidentity$/, '') // Ignore identity keywords
      .replace(/unsigned$/, ''); // Ignore unsigned for type comparison

    // Strip display width/length for integer types as they are often
    // inconsistent between introspection and generation (e.g. bigint(20) vs bigint)
    if (type.includes('int')) {
      type = type.replace(/\(\d+\)/, '');
    }

    // Add length if it's not already in the type string
    if (column.length && !type.includes('(')) {
      type = `${type}(${column.length})`;
    } else if (column.precision !== undefined && !type.includes('(')) {
      if (column.scale !== undefined) {
        type = `${type}(${column.precision},${column.scale})`;
      } else {
        type = `${type}(${column.precision})`;
      }
    }

    return type;
  }

  /**
   * Compare two default values for equality
   */
  protected isDefaultValueEqual(current: unknown, desired: unknown): boolean {
    if (current === desired) return true;
    if (current === undefined || desired === undefined) return current === desired;

    const normalize = (val: unknown): string => {
      if (val === null) return 'null';
      if (typeof val === 'string') {
        // Remove type casts first (common in Postgres like ::text, ::character varying, ::timestamp without time zone)
        let s = val.replace(/::[a-z_]+(\s+[a-z_]+)*(\[\])?$/i, '');
        // Remove surrounding quotes
        s = s.replace(/^'(.*)'$/, '$1');
        if (s.toLowerCase() === 'null') return 'null';
        return s;
      }
      return typeof val === 'object' ? JSON.stringify(val) : String(val);
    };

    return normalize(current) === normalize(desired);
  }
}
