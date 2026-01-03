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
import { escapeSqlId, getKeys } from '../util/index.js';

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
    const columnName = this.escapeId(this.resolveColumnName(fieldKey, field));
    const isId = field.isId === true;
    const isPrimaryKey = isId && meta.id === fieldKey;

    // Determine SQL type
    let sqlType: string;
    if (isPrimaryKey && field.autoIncrement !== false && !field.onInsert) {
      // Auto-increment primary key
      sqlType = this.serialPrimaryKeyType;
    } else {
      sqlType = this.getSqlType(field, field.type);
    }

    let definition = `${columnName} ${sqlType}`;

    // PRIMARY KEY constraint (for non-serial types)
    if (isPrimaryKey && !sqlType.includes('PRIMARY KEY')) {
      definition += ' PRIMARY KEY';
    }

    // NULL/NOT NULL
    if (!isPrimaryKey) {
      const nullable = field.nullable ?? true;
      if (!nullable) {
        definition += ' NOT NULL';
      }
    }

    // UNIQUE constraint
    if (field.unique && !isPrimaryKey) {
      definition += ' UNIQUE';
    }

    // DEFAULT value
    if (field.defaultValue !== undefined) {
      definition += ` DEFAULT ${this.formatDefaultValue(field.defaultValue)}`;
    }

    // COMMENT (if supported)
    if (field.comment) {
      definition += this.generateColumnComment(
        this.resolveTableName(meta.entity, meta),
        this.resolveColumnName(fieldKey, field),
        field.comment,
      );
    }

    return definition;
  }

  /**
   * Generate column definition from a ColumnSchema object
   */
  public generateColumnDefinitionFromSchema(column: ColumnSchema): string {
    const columnName = this.escapeId(column.name);
    let type = column.type;

    if (column.length && !type.includes('(')) {
      type = `${type}(${column.length})`;
    } else if (column.precision !== undefined && !type.includes('(')) {
      if (column.scale !== undefined) {
        type = `${type}(${column.precision}, ${column.scale})`;
      } else {
        type = `${type}(${column.precision})`;
      }
    }

    let definition = `${columnName} ${type}`;

    if (column.isPrimaryKey) {
      definition += ' PRIMARY KEY';
    }

    if (!column.nullable && !column.isPrimaryKey) {
      definition += ' NOT NULL';
    }

    if (column.isUnique && !column.isPrimaryKey) {
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
      if (field?.reference) {
        const refEntity = field.reference();
        const refMeta = getMeta(refEntity);
        const refIdField = refMeta.fields[refMeta.id];
        const columnName = this.resolveColumnName(key as string, field);
        const refTableName = this.resolveTableName(refEntity, refMeta);
        const refColumnName = this.resolveColumnName(refMeta.id, refIdField);
        const fkName = `fk_${tableName}_${columnName}`;

        constraints.push(
          `CONSTRAINT ${this.escapeId(fkName)} FOREIGN KEY (${this.escapeId(columnName)}) ` +
            `REFERENCES ${this.escapeId(refTableName)} (${this.escapeId(refColumnName)})`,
        );
      }
    }

    return constraints;
  }

  getSqlType(field: FieldOptions, fieldType?: unknown): string {
    // Use explicit column type if specified
    if (field.columnType) {
      return this.mapColumnType(field.columnType, field);
    }

    // Handle special types
    if (field.type === 'json' || field.type === 'jsonb') {
      return this.mapColumnType(field.type as ColumnType, field);
    }

    if (field.type === 'vector') {
      return this.mapColumnType('vector', field);
    }

    // Infer from TypeScript type
    const type = fieldType ?? field.type;

    if (type === Number || type === 'number') {
      return field.precision ? this.mapColumnType('decimal', field) : 'BIGINT';
    }

    if (type === String || type === 'string') {
      return this.mapColumnType('varchar', field);
    }

    if (type === Boolean || type === 'boolean') {
      return this.getBooleanType();
    }

    if (type === Date || type === 'date') {
      return 'TIMESTAMP';
    }

    if (type === BigInt || type === 'bigint') {
      return 'BIGINT';
    }

    // Default to varchar
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
    const isId = field.isId === true;
    const isPrimaryKey = isId && meta.id === fieldKey;

    return {
      name: this.resolveColumnName(fieldKey, field),
      type: this.getSqlType(field, field.type),
      nullable: field.nullable ?? !isPrimaryKey,
      defaultValue: field.defaultValue,
      isPrimaryKey,
      isAutoIncrement: isPrimaryKey && field.autoIncrement !== false && !field.onInsert,
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
    // Compare relevant properties
    return (
      current.type.toLowerCase() !== desired.type.toLowerCase() ||
      current.nullable !== desired.nullable ||
      current.isUnique !== desired.isUnique ||
      JSON.stringify(current.defaultValue) !== JSON.stringify(desired.defaultValue)
    );
  }
}
