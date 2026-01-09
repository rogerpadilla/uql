import { AbstractDialect } from '../dialect/index.js';
import { getMeta } from '../entity/index.js';
import { areTypesEqual, canonicalToSql, fieldOptionsToCanonical, sqlToCanonical } from '../schema/canonicalType.js';
import { SchemaASTBuilder } from '../schema/schemaASTBuilder.js';
import type {
  CanonicalType,
  ColumnNode,
  ForeignKeyAction,
  IndexNode,
  RelationshipNode,
  TableNode,
} from '../schema/types.js';
import type {
  ColumnSchema,
  Dialect,
  EntityMeta,
  FieldKey,
  FieldOptions,
  IndexSchema,
  NamingStrategy,
  SchemaDiff,
  SchemaGenerator,
  Type,
} from '../type/index.js';
import { escapeSqlId, getKeys, isAutoIncrement } from '../util/index.js';
import { formatDefaultValue } from './builder/expressions.js';
import type { FullColumnDefinition, TableDefinition, TableForeignKeyDefinition } from './builder/types.js';

/**
 * Unified SQL schema generator.
 * Parameterized by dialect to handle Postgres, MySQL, MariaDB, and SQLite.
 */
export class SqlSchemaGenerator extends AbstractDialect implements SchemaGenerator {
  /**
   * Escape an identifier (table name, column name, etc.)
   */
  protected escapeId(identifier: string): string {
    return escapeSqlId(identifier, this.config.quoteChar);
  }

  /**
   * Primary key type for auto-increment integer IDs
   */
  protected get serialPrimaryKeyType(): string {
    return this.config.serialPrimaryKey;
  }

  // ============================================================================
  // CanonicalType Integration (Unified Type System)
  // ============================================================================

  /**
   * Convert FieldOptions to CanonicalType using the unified type system.
   */
  protected getCanonicalType(field: FieldOptions, fieldType?: unknown): CanonicalType {
    return fieldOptionsToCanonical(field, fieldType);
  }

  /**
   * Convert CanonicalType to SQL type string for this dialect.
   * Also handles legacy string types for backward compatibility.
   */
  protected canonicalTypeToSql(type: CanonicalType | string): string {
    // Handle legacy string types
    if (typeof type === 'string') {
      return type;
    }
    return canonicalToSql(type, this.dialect);
  }

  // ============================================================================
  // SchemaGenerator Implementation
  // ============================================================================

  generateCreateTable<E>(entity: Type<E>, options: { ifNotExists?: boolean } = {}): string {
    const builder = new SchemaASTBuilder(this.namingStrategy);
    const ast = builder.fromEntities([entity], {
      resolveTableName: this.resolveTableName.bind(this),
      resolveColumnName: this.resolveColumnName.bind(this),
    });
    const tableNode = ast.getTables()[0];
    return this.generateCreateTableFromNode(tableNode, options);
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

    // Reverse column additions by dropping them
    if (diff.columnsToAdd?.length) {
      for (const column of diff.columnsToAdd) {
        statements.push(`ALTER TABLE ${tableName} DROP COLUMN ${this.escapeId(column.name)};`);
      }
    }

    // Reverse column alterations by restoring original schema
    if (diff.columnsToAlter?.length) {
      for (const { from } of diff.columnsToAlter) {
        const colDef = this.generateColumnDefinitionFromSchema(from, { includePrimaryKey: false });
        const colStatements = this.generateAlterColumnStatements(diff.tableName, from, colDef);
        statements.push(...colStatements);
      }
    }

    // Reverse index additions by dropping them
    if (diff.indexesToAdd?.length) {
      for (const index of diff.indexesToAdd) {
        statements.push(this.generateDropIndex(diff.tableName, index.name));
      }
    }

    if (diff.columnsToDrop?.length || diff.indexesToDrop?.length) {
      statements.push(`-- TODO: Manual reversal needed for dropped columns/indexes`);
    }

    return statements;
  }

  generateCreateIndex(tableName: string, index: IndexSchema): string {
    const unique = index.unique ? 'UNIQUE ' : '';
    const columns = index.columns.map((c) => this.escapeId(c)).join(', ');
    const ifNotExists = this.config.features.indexIfNotExists ? 'IF NOT EXISTS ' : '';
    return `CREATE ${unique}INDEX ${ifNotExists}${this.escapeId(index.name)} ON ${this.escapeId(tableName)} (${columns});`;
  }

  generateDropIndex(tableName: string, indexName: string): string {
    if (this.dialect === 'mysql' || this.dialect === 'mariadb') {
      return `DROP INDEX ${this.escapeId(indexName)} ON ${this.escapeId(tableName)};`;
    }
    return `DROP INDEX IF EXISTS ${this.escapeId(indexName)};`;
  }

  /**
   * Generate column definition from a ColumnSchema object
   */
  public generateColumnDefinitionFromSchema(
    column: ColumnSchema,
    options: { includePrimaryKey?: boolean; includeUnique?: boolean } = {},
  ): string {
    const { includePrimaryKey = true, includeUnique = true } = options;

    let type = column.type;

    if (!type.includes('(')) {
      if (column.precision !== undefined) {
        if (column.scale !== undefined) {
          type += `(${column.precision}, ${column.scale})`;
        } else {
          type += `(${column.precision})`;
        }
      } else if (column.length !== undefined) {
        type += `(${column.length})`;
      }
    }

    if (!includePrimaryKey) {
      type = type.replace(/\s+PRIMARY\s+KEY/i, '');
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

    if (column.comment) {
      definition += this.generateColumnComment(column.name, column.comment);
    }

    return definition;
  }

  public getSqlType(field: FieldOptions, fieldType?: unknown): string {
    // If field has a reference, inherit type from the target primary key
    const reference = field.references ?? field.reference;
    if (reference) {
      const refEntity = reference();
      const refMeta = getMeta(refEntity);
      const refIdField = refMeta.fields[refMeta.id];
      return this.getSqlType(
        { ...refIdField, references: undefined, reference: undefined, isId: undefined, autoIncrement: false },
        refIdField.type,
      );
    }

    // Get canonical type and convert to SQL
    const canonical = this.getCanonicalType(field, fieldType);

    // Special case for serial primary keys
    if (isAutoIncrement(field, field.isId === true)) {
      return this.serialPrimaryKeyType;
    }

    return this.canonicalTypeToSql(canonical);
  }

  /**
   * Get the boolean type for this database
   */
  public getBooleanType(): string {
    return this.canonicalTypeToSql({ category: 'boolean' });
  }

  /**
   * Generate ALTER COLUMN statements (database-specific)
   */
  public generateAlterColumnStatements(tableName: string, column: ColumnSchema, newDefinition: string): string[] {
    const table = this.escapeId(tableName);
    const colName = this.escapeId(column.name);

    if (this.config.alterColumnSyntax === 'none') {
      throw new Error(
        `${this.dialect}: Cannot alter column "${column.name}" - you must recreate the table. ` +
          `This database does not support ALTER COLUMN.`,
      );
    }

    if (this.dialect === 'postgres') {
      const statements: string[] = [];
      // PostgreSQL uses separate ALTER COLUMN clauses for different changes
      // 1. Change type
      statements.push(`ALTER TABLE ${table} ALTER COLUMN ${colName} TYPE ${column.type};`);

      // 2. Change nullability
      if (column.nullable) {
        statements.push(`ALTER TABLE ${table} ALTER COLUMN ${colName} DROP NOT NULL;`);
      } else {
        statements.push(`ALTER TABLE ${table} ALTER COLUMN ${colName} SET NOT NULL;`);
      }

      // 3. Change default value
      if (column.defaultValue !== undefined) {
        statements.push(
          `ALTER TABLE ${table} ALTER COLUMN ${colName} SET DEFAULT ${this.formatDefaultValue(column.defaultValue)};`,
        );
      } else {
        statements.push(`ALTER TABLE ${table} ALTER COLUMN ${colName} DROP DEFAULT;`);
      }
      return statements;
    }

    return [`ALTER TABLE ${table} ${this.config.alterColumnSyntax} ${newDefinition};`];
  }

  /**
   * Get table options (e.g., ENGINE for MySQL)
   */
  public getTableOptions<E>(_meta: EntityMeta<E>): string {
    return this.config.tableOptions ? ` ${this.config.tableOptions}` : '';
  }

  /**
   * Generate column comment clause (if supported)
   */
  public generateColumnComment(columnName: string, comment: string): string {
    if (this.dialect === 'mysql' || this.dialect === 'mariadb') {
      const escapedComment = comment.replace(/'/g, "''");
      return ` COMMENT '${escapedComment}'`;
    }
    return '';
  }

  /**
   * Format a default value for SQL
   */
  public formatDefaultValue(value: unknown): string {
    if (this.dialect === 'sqlite' && typeof value === 'boolean') {
      return value ? '1' : '0';
    }
    return formatDefaultValue(value);
  }

  /**
   * Compare an entity with a database table node and return the differences.
   */
  diffSchema<E>(entity: Type<E>, currentTable: TableNode | undefined): SchemaDiff | undefined {
    const meta = getMeta(entity);

    if (!currentTable) {
      return {
        tableName: this.resolveTableName(entity, meta),
        type: 'create',
      };
    }

    const columnsToAdd: ColumnSchema[] = [];
    const columnsToAlter: { from: ColumnSchema; to: ColumnSchema }[] = [];
    const columnsToDrop: string[] = [];

    const currentColumns = new Map<string, ColumnNode>(currentTable.columns);
    const fieldKeys = getKeys(meta.fields) as FieldKey<E>[];

    for (const key of fieldKeys) {
      const field = meta.fields[key];
      if (field?.virtual) continue;

      const columnName = this.resolveColumnName(key as string, field);
      const currentColumn = currentColumns.get(columnName);

      if (!currentColumn) {
        columnsToAdd.push(this.fieldToColumnSchema(key as string, field, meta));
      } else {
        const desiredColumn = this.fieldToColumnSchema(key as string, field, meta);
        const currentColumnSchema = this.columnNodeToSchema(currentColumn);
        if (this.columnsNeedAlteration(currentColumnSchema, desiredColumn)) {
          columnsToAlter.push({ from: currentColumnSchema, to: desiredColumn });
        }
      }
      currentColumns.delete(columnName);
    }

    for (const [name] of currentColumns) {
      columnsToDrop.push(name);
    }

    if (columnsToAdd.length === 0 && columnsToAlter.length === 0 && columnsToDrop.length === 0) {
      return undefined;
    }

    return {
      tableName: this.resolveTableName(entity, meta),
      type: 'alter',
      columnsToAdd: columnsToAdd.length > 0 ? columnsToAdd : undefined,
      columnsToAlter: columnsToAlter.length > 0 ? columnsToAlter : undefined,
      columnsToDrop: columnsToDrop.length > 0 ? columnsToDrop : undefined,
    };
  }

  private columnNodeToSchema(col: ColumnNode): ColumnSchema {
    return {
      name: col.name,
      type: this.canonicalTypeToSql(col.type),
      nullable: col.nullable,
      defaultValue: col.defaultValue,
      isPrimaryKey: col.isPrimaryKey,
      isAutoIncrement: col.isAutoIncrement,
      isUnique: col.isUnique,
      comment: col.comment,
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
   * Compare two column types for equality using the canonical type system
   */
  protected isTypeEqual(current: ColumnSchema, desired: ColumnSchema): boolean {
    const typeA = sqlToCanonical(current.type);
    const typeB = sqlToCanonical(desired.type);
    return areTypesEqual(typeA, typeB);
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
        let s = val.replace(/::[a-z_]+(\s+[a-z_]+)*(\[\])?$/i, '');
        s = s.replace(/^'(.*)'$/, '$1');
        if (s.toLowerCase() === 'null') return 'null';
        return s;
      }
      return typeof val === 'object' ? JSON.stringify(val) : String(val);
    };

    return normalize(current) === normalize(desired);
  }

  // ============================================================================
  // SchemaAST Support Methods
  // ============================================================================

  /**
   * Generate CREATE TABLE SQL from a TableNode.
   */
  generateCreateTableFromNode(table: TableNode, options: { ifNotExists?: boolean } = {}): string {
    const columns: string[] = [];
    const constraints: string[] = [];

    for (const col of table.columns.values()) {
      const colDef = this.generateColumnFromNode(col);
      columns.push(colDef);
    }

    if (table.primaryKey.length > 1) {
      const pkCols = table.primaryKey.map((c) => this.escapeId(c.name)).join(', ');
      constraints.push(`PRIMARY KEY (${pkCols})`);
    }

    // Add table-level foreign keys if any
    for (const rel of table.outgoingRelations) {
      if (rel.from.columns.length > 0) {
        const fromCols = rel.from.columns.map((c) => this.escapeId(c.name)).join(', ');
        const toCols = rel.to.columns.map((c) => this.escapeId(c.name)).join(', ');
        const constraintName = rel.name ? `CONSTRAINT ${this.escapeId(rel.name)} ` : '';
        constraints.push(
          `${constraintName}FOREIGN KEY (${fromCols}) REFERENCES ${this.escapeId(rel.to.table.name)} (${toCols})` +
            ` ON DELETE ${rel.onDelete ?? this.defaultForeignKeyAction} ON UPDATE ${rel.onUpdate ?? this.defaultForeignKeyAction}`,
        );
      }
    }

    const ifNotExists = options.ifNotExists && this.config.features.ifNotExists ? 'IF NOT EXISTS ' : '';
    let sql = `CREATE TABLE ${ifNotExists}${this.escapeId(table.name)} (\n`;
    sql += columns.map((col) => `  ${col}`).join(',\n');

    if (constraints.length > 0) {
      sql += ',\n';
      sql += constraints.map((c) => `  ${c}`).join(',\n');
    }

    sql += '\n)';

    if (this.config.tableOptions) {
      sql += ` ${this.config.tableOptions}`;
    }

    sql += ';';

    // Generate indexes as separate statements
    const indexStatements = table.indexes.map((idx) => this.generateCreateIndexFromNode(idx, options)).join('\n');

    return indexStatements ? `${sql}\n${indexStatements}` : sql;
  }

  /**
   * Generate a column definition from a ColumnNode.
   */
  protected generateColumnFromNode(col: ColumnNode): string {
    const colName = this.escapeId(col.name);
    let sqlType = this.canonicalTypeToSql(col.type);

    if (col.isPrimaryKey && col.isAutoIncrement) {
      sqlType = this.serialPrimaryKeyType;
    }

    let def = `${colName} ${sqlType}`;

    if (!col.nullable && !col.isPrimaryKey) {
      def += ' NOT NULL';
    }

    if (col.isPrimaryKey && col.table.primaryKey.length === 1 && !sqlType.includes('PRIMARY KEY')) {
      def += ' PRIMARY KEY';
    }

    if (col.isUnique && !col.isPrimaryKey) {
      def += ' UNIQUE';
    }

    if (col.defaultValue !== undefined) {
      def += ` DEFAULT ${this.formatDefaultValue(col.defaultValue)}`;
    }

    if (col.comment) {
      def += this.generateColumnComment(col.name, col.comment);
    }

    return def;
  }

  /**
   * Generate CREATE INDEX SQL from an IndexNode.
   */
  generateCreateIndexFromNode(index: IndexNode, options: { ifNotExists?: boolean } = {}): string {
    const uniqueStr = index.unique ? 'UNIQUE ' : '';
    const columns = index.columns.map((c) => this.escapeId(c.name)).join(', ');
    const tableName = this.escapeId(index.table.name);
    const ifNotExists = options.ifNotExists && this.config.features.indexIfNotExists ? 'IF NOT EXISTS ' : '';

    return `CREATE ${uniqueStr}INDEX ${ifNotExists}${this.escapeId(index.name)} ON ${tableName} (${columns});`;
  }

  /**
   * Generate DROP TABLE SQL from a TableNode.
   */
  generateDropTableFromNode(table: TableNode, options: { ifExists?: boolean } = {}): string {
    const ifExists = options.ifExists ? 'IF EXISTS ' : '';
    return `DROP TABLE ${ifExists}${this.escapeId(table.name)};`;
  }

  // ============================================================================
  // Phase 3: Builder Operation Methods (Moved forward for unification)
  // ============================================================================

  generateCreateTableFromDefinition(table: TableDefinition, options: { ifNotExists?: boolean } = {}): string {
    const tableNode = this.tableDefinitionToNode(table);
    return this.generateCreateTableFromNode(tableNode, options);
  }

  generateDropTableSql(tableName: string, options?: { ifExists?: boolean; cascade?: boolean }): string {
    const ifExists = options?.ifExists ? 'IF EXISTS ' : '';
    // Use dialect-specific cascade support from config
    const cascade = options?.cascade && this.config.features.dropTableCascade ? ' CASCADE' : '';
    return `DROP TABLE ${ifExists}${this.escapeId(tableName)}${cascade};`;
  }

  generateRenameTableSql(oldName: string, newName: string): string {
    if (this.dialect === 'mysql' || this.dialect === 'mariadb') {
      return `RENAME TABLE ${this.escapeId(oldName)} TO ${this.escapeId(newName)};`;
    }
    return `ALTER TABLE ${this.escapeId(oldName)} RENAME TO ${this.escapeId(newName)};`;
  }

  generateAddColumnSql(tableName: string, column: FullColumnDefinition): string {
    const colSql = this.generateColumnFromNode(this.fullColumnDefinitionToNode(column, tableName));
    return `ALTER TABLE ${this.escapeId(tableName)} ADD COLUMN ${colSql};`;
  }

  generateAlterColumnSql(tableName: string, columnName: string, column: FullColumnDefinition): string {
    const colSql = this.generateColumnFromNode(this.fullColumnDefinitionToNode(column, tableName));
    return this.generateAlterColumnStatements(tableName, { name: columnName, type: '' } as ColumnSchema, colSql).join(
      '\n',
    );
  }

  generateDropColumnSql(tableName: string, columnName: string): string {
    return `ALTER TABLE ${this.escapeId(tableName)} DROP COLUMN ${this.escapeId(columnName)};`;
  }

  generateRenameColumnSql(tableName: string, oldName: string, newName: string): string {
    return `ALTER TABLE ${this.escapeId(tableName)} RENAME COLUMN ${this.escapeId(oldName)} TO ${this.escapeId(newName)};`;
  }

  generateCreateIndexSql(tableName: string, index: IndexSchema): string {
    return this.generateCreateIndex(tableName, index);
  }

  generateDropIndexSql(tableName: string, indexName: string): string {
    return this.generateDropIndex(tableName, indexName);
  }

  generateAddForeignKeySql(tableName: string, foreignKey: TableForeignKeyDefinition): string {
    const fkCols = foreignKey.columns.map((c) => this.escapeId(c)).join(', ');
    const refCols = foreignKey.referencesColumns.map((c) => this.escapeId(c)).join(', ');
    const constraintName = foreignKey.name
      ? this.escapeId(foreignKey.name)
      : this.escapeId(`fk_${tableName}_${foreignKey.columns.join('_')}`);

    if (!this.config.features.foreignKeyAlter) {
      throw new Error(`Dialect ${this.dialect} does not support adding foreign keys to existing tables`);
    }

    return (
      `ALTER TABLE ${this.escapeId(tableName)} ADD CONSTRAINT ${constraintName} ` +
      `FOREIGN KEY (${fkCols}) REFERENCES ${this.escapeId(foreignKey.referencesTable)} (${refCols}) ` +
      `ON DELETE ${foreignKey.onDelete ?? this.defaultForeignKeyAction} ON UPDATE ${foreignKey.onUpdate ?? this.defaultForeignKeyAction};`
    );
  }

  generateDropForeignKeySql(tableName: string, constraintName: string): string {
    return `ALTER TABLE ${this.escapeId(tableName)} ${this.config.dropForeignKeySyntax} ${this.escapeId(constraintName)};`;
  }

  private tableDefinitionToNode(def: TableDefinition): TableNode {
    const columns = new Map<string, ColumnNode>();
    const pkNodes: ColumnNode[] = [];

    const table: TableNode = {
      name: def.name,
      columns,
      primaryKey: [], // placeholder
      indexes: [],
      schema: { tables: new Map(), relationships: [], indexes: [] },
      incomingRelations: [],
      outgoingRelations: [],
      comment: def.comment,
    };

    for (const colDef of def.columns) {
      const node = this.fullColumnDefinitionToNode(colDef, def.name);
      (node as { table: TableNode }).table = table;
      columns.set(node.name, node);
      if (node.isPrimaryKey) {
        pkNodes.push(node);
      }
    }

    const finalPrimaryKey = def.primaryKey
      ? def.primaryKey.map((name) => columns.get(name)).filter((c): c is ColumnNode => c !== undefined)
      : pkNodes;

    (table as { primaryKey: ColumnNode[] }).primaryKey = finalPrimaryKey;

    for (const idxDef of def.indexes) {
      const indexNode: IndexNode = {
        name: idxDef.name,
        table,
        columns: idxDef.columns.map((name) => columns.get(name)).filter((c): c is ColumnNode => c !== undefined),
        unique: idxDef.unique,
      };
      table.indexes.push(indexNode);
    }

    for (const fkDef of def.foreignKeys) {
      const relNode: RelationshipNode = {
        name: fkDef.name ?? `fk_${def.name}_${fkDef.columns.join('_')}`,
        type: 'ManyToOne', // Builder default
        from: {
          table,
          columns: fkDef.columns.map((name) => columns.get(name)).filter((c): c is ColumnNode => c !== undefined),
        },
        to: {
          table: { name: fkDef.referencesTable } as TableNode,
          columns: fkDef.referencesColumns.map((name) => ({ name }) as ColumnNode),
        },
        onDelete: fkDef.onDelete,
        onUpdate: fkDef.onUpdate,
      };
      table.outgoingRelations.push(relNode);
    }

    return table;
  }

  private fullColumnDefinitionToNode(col: FullColumnDefinition, tableName: string): ColumnNode {
    return {
      name: col.name,
      type: col.type,
      nullable: col.nullable,
      defaultValue: col.defaultValue,
      isPrimaryKey: col.primaryKey,
      isAutoIncrement: col.autoIncrement,
      isUnique: col.unique,
      comment: col.comment,
      table: { name: tableName } as TableNode,
      referencedBy: [],
      references: col.foreignKey
        ? {
            name: `fk_${tableName}_${col.name}`,
            type: 'ManyToOne',
            from: { table: { name: tableName } as TableNode, columns: [] },
            to: {
              table: { name: col.foreignKey.table } as TableNode,
              columns: col.foreignKey.columns.map((name) => ({ name }) as ColumnNode),
            },
            onDelete: col.foreignKey.onDelete,
            onUpdate: col.foreignKey.onUpdate,
          }
        : undefined,
    };
  }
}

import { MongoSchemaGenerator } from './generator/mongoSchemaGenerator.js';

export { MongoSchemaGenerator };

/**
 * Factory function to create a SchemaGenerator for a specific dialect.
 * Returns undefined for unsupported dialects.
 */
export function createSchemaGenerator(
  dialect: Dialect,
  namingStrategy?: NamingStrategy,
  defaultForeignKeyAction?: ForeignKeyAction,
): SchemaGenerator | undefined {
  if (dialect === 'mongodb') {
    return new MongoSchemaGenerator(namingStrategy, defaultForeignKeyAction);
  }
  // Check if dialect is supported (has config)
  const supportedDialects: Dialect[] = ['postgres', 'mysql', 'mariadb', 'sqlite'];
  if (!supportedDialects.includes(dialect)) {
    return undefined;
  }
  return new SqlSchemaGenerator(dialect, namingStrategy, defaultForeignKeyAction);
}
