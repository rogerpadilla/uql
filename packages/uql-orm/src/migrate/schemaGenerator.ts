import { type AbstractDialect, AbstractSqlDialect } from '../dialect/index.js';
import { getMeta } from '../entity/index.js';
import {
  areTypesEqual,
  canonicalToSql,
  fieldOptionsToCanonical,
  isVectorCategory,
  sqlToCanonical,
} from '../schema/canonicalType.js';
import type { SchemaAST } from '../schema/schemaAST.js';
import { buildSchemaAST } from '../schema/schemaASTBuilder.js';
import type { CanonicalType, ColumnNode, ForeignKeyAction, IndexNode, TableNode } from '../schema/types.js';
import type {
  ColumnSchema,
  CreateSchemaOptions,
  DialectFeatures,
  DropSchemaOptions,
  EntityMeta,
  FieldKey,
  FieldOptions,
  IndexSchema,
  NamingStrategy,
  SchemaDiff,
  SchemaGenerator,
  SqlDdlGenerator,
  Type,
} from '../type/index.js';
import { escapeSqlId, getKeys, isAutoIncrement } from '../util/index.js';
import { formatDefaultValue } from './builder/expressions.js';
import type { FullColumnDefinition, TableDefinition, TableForeignKeyDefinition } from './builder/types.js';
import { fullColumnDefinitionToNode, tableDefinitionToNode } from './generator/definitionToNode.js';
import { indexNodeToSchema } from './generator/indexNodeToSchema.js';

/**
 * Unified SQL schema generator.
 * Parameterized by dialect to handle Postgres, MySQL, MariaDB, and SQLite.
 */
export class SqlSchemaGenerator implements SqlDdlGenerator {
  constructor(
    protected readonly dialect: AbstractSqlDialect,
    protected readonly defaultForeignKeyAction: ForeignKeyAction = 'NO ACTION',
  ) {}

  get namingStrategy(): NamingStrategy | undefined {
    return this.dialect.namingStrategy;
  }

  get features(): DialectFeatures {
    return this.dialect.features;
  }

  resolveTableName<E>(entity: Type<E>, meta: EntityMeta<E>): string {
    return this.dialect.resolveTableName(entity, meta);
  }

  resolveColumnName(key: string, field: FieldOptions): string {
    return this.dialect.resolveColumnName(key, field);
  }

  /**
   * Escape an identifier (table name, column name, etc.)
   */
  protected escapeId(identifier: string): string {
    return escapeSqlId(identifier, this.dialect.escapeIdChar);
  }

  /**
   * Primary key type for auto-increment integer IDs
   */
  protected get serialPrimaryKeyType(): string {
    return this.dialect.serialPrimaryKey;
  }

  /**
   * Convert FieldOptions to CanonicalType using the unified type system.
   */
  protected getCanonicalType(field: FieldOptions, fieldType?: unknown): CanonicalType {
    return fieldOptionsToCanonical(field, fieldType);
  }

  protected canonicalTypeToSql(type: CanonicalType): string {
    return canonicalToSql(type, this.dialect);
  }

  /**
   * Every `CREATE TABLE` for `entities`, then their foreign keys.
   *
   * Two phases rather than inline constraints, because a relation graph is routinely cyclic: any
   * `createdBy`-style back-reference makes `A` reference `B` while `B` references `A`, and no create
   * order satisfies that. TypeORM's schema builder splits for the same reason (`createNewTables()`
   * then `createForeignKeys()`). SQLite is the exception and keeps them inline: it cannot `ALTER` a
   * foreign key in, but it resolves targets lazily, so a forward reference is fine there.
   */
  generateCreateSchema(entities: readonly Type<unknown>[], options: CreateSchemaOptions = {}): string[] {
    const tables = this.orderedTables(entities, 'create', options.only);
    const withForeignKeys = options.foreignKeys ?? true;
    // Inline only where a constraint cannot be added afterwards, which is what makes the cyclic case
    // work everywhere else.
    const inline = withForeignKeys && !this.features.foreignKeyAlter;

    const statements = tables.flatMap((table) =>
      this.generateCreateTableFromNode(inline ? table : { ...table, outgoingRelations: [] }, options),
    );

    if (withForeignKeys && !inline) {
      for (const table of tables) {
        for (const rel of table.outgoingRelations) {
          statements.push(
            this.generateAddForeignKeySql(table.name, {
              name: rel.name,
              columns: rel.from.columns.map((c) => c.name),
              referencesTable: rel.to.table.name,
              referencesColumns: rel.to.columns.map((c) => c.name),
              onDelete: rel.onDelete ?? this.defaultForeignKeyAction,
              onUpdate: rel.onUpdate ?? this.defaultForeignKeyAction,
            }),
          );
        }
      }
    }

    return statements;
  }

  generateDropSchema(entities: readonly Type<unknown>[], options: DropSchemaOptions = {}): string[] {
    return this.orderedTables(entities, 'drop').map((table) => this.generateDropTable(table.name, options));
  }

  /**
   * The tables of `entities` in dependency order, optionally narrowed to `only`. The AST always spans
   * every entity even when narrowed, so a relation pointing at a table outside the subset still
   * resolves instead of being silently dropped.
   */
  private orderedTables(
    entities: readonly Type<unknown>[],
    direction: 'create' | 'drop',
    only?: readonly string[],
  ): TableNode[] {
    const ast = buildEntityAST(this, entities, this.defaultForeignKeyAction);
    const tables = direction === 'create' ? ast.getCreateOrder() : ast.getDropOrder();
    if (!only) {
      return tables;
    }
    const wanted = new Set(only);
    return tables.filter((table) => wanted.has(table.name));
  }

  generateDropTable(tableName: string, options: DropSchemaOptions = {}): string {
    const ifExists = options.ifExists ? 'IF EXISTS ' : '';
    const cascade = options.cascade && this.features.dropTableCascade ? ' CASCADE' : '';
    return `DROP TABLE ${ifExists}${this.escapeId(tableName)}${cascade};`;
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

  generateCreateIndex(tableName: string, index: IndexSchema, options: { ifNotExists?: boolean } = {}): string {
    return this.dialect.getCreateIndexStatement(tableName, index, options);
  }

  generateDropIndex(tableName: string, indexName: string): string {
    if (this.dialect.dropIndexSyntax === 'on-table') {
      return `DROP INDEX ${this.escapeId(indexName)} ON ${this.escapeId(tableName)};`;
    }
    return `DROP INDEX IF EXISTS ${this.escapeId(indexName)};`;
  }

  /**
   * Generate a column definition from a {@link ColumnSchema}, whose type is the engine's own spelling
   * and may already carry its precision (or even `PRIMARY KEY`, for a serial).
   */
  public generateColumnDefinitionFromSchema(
    column: ColumnSchema,
    options: { includePrimaryKey?: boolean; includeUnique?: boolean } = {},
  ): string {
    const { includePrimaryKey = true, includeUnique = true } = options;
    let type = column.type;

    if (!type.includes('(')) {
      if (column.precision !== undefined) {
        type += column.scale === undefined ? `(${column.precision})` : `(${column.precision}, ${column.scale})`;
      } else if (column.length !== undefined) {
        type += `(${column.length})`;
      }
    }

    if (!includePrimaryKey) {
      type = type.replace(/\s+PRIMARY\s+KEY/i, '');
    }

    // `includePrimaryKey: false` suppresses the keyword, not the fact: the column is still the primary
    // key, so it must not pick up `NOT NULL` (implied) or `UNIQUE` (redundant) on the way out.
    return this.renderColumn({
      ...column,
      type,
      isUnique: column.isUnique && includeUnique,
      declaresPrimaryKey: includePrimaryKey && column.isPrimaryKey,
    });
  }

  /**
   * The one place a column definition is spelled. Both callers reach it - the `ColumnSchema` path above
   * and the `ColumnNode` path below - because the clause order and the "no NOT NULL on a primary key"
   * rules are the same everywhere, and having them written twice is how the two paths drifted.
   */
  private renderColumn(column: {
    name: string;
    type: string;
    nullable: boolean;
    isPrimaryKey: boolean;
    isUnique: boolean;
    declaresPrimaryKey: boolean;
    defaultValue?: unknown;
    comment?: string;
  }): string {
    let def = `${this.escapeId(column.name)} ${column.type}`;

    if (column.declaresPrimaryKey && !column.type.includes('PRIMARY KEY')) {
      def += ' PRIMARY KEY';
    }
    if (!column.nullable && !column.isPrimaryKey) {
      def += ' NOT NULL';
    }
    if (column.isUnique && !column.isPrimaryKey) {
      def += ' UNIQUE';
    }
    if (column.defaultValue !== undefined) {
      def += ` DEFAULT ${this.formatDefaultValue(column.defaultValue)}`;
    }
    if (column.comment) {
      def += this.generateColumnComment(column.name, column.comment);
    }

    return def;
  }

  public getSqlType(field: FieldOptions, fieldType?: unknown): string {
    // If field has a reference, inherit type from the target primary key
    if (field.references) {
      const refEntity = field.references();
      const refMeta = getMeta(refEntity);
      const refIdField = refMeta.fields[refMeta.id];
      return this.getSqlType(
        { ...refIdField, references: undefined, isId: undefined, autoIncrement: false },
        refIdField!.type,
      );
    }

    // Get canonical type and convert to SQL
    const canonical = this.getCanonicalType(field, fieldType);

    // Special case for serial primary keys
    if (isAutoIncrement(field, field.isId === true)) {
      return this.dialect.serialPrimaryKey;
    }

    return this.canonicalTypeToSql(canonical);
  }

  /**
   * Generate ALTER COLUMN statements (database-specific)
   */
  public generateAlterColumnStatements(tableName: string, column: ColumnSchema, newDefinition: string): string[] {
    const table = this.escapeId(tableName);
    const colName = this.escapeId(column.name);

    if (this.dialect.alterColumnSyntax === 'none') {
      throw new Error(
        `${this.dialect}: Cannot alter column "${column.name}" - you must recreate the table. ` +
          `This database does not support ALTER COLUMN.`,
      );
    }

    if (this.dialect.alterColumnStrategy === 'separate-clauses') {
      const statements: string[] = [];
      // Separate ALTER COLUMN clauses for different changes (Postgres)
      statements.push(`ALTER TABLE ${table} ALTER COLUMN ${colName} TYPE ${column.type};`);

      if (column.nullable) {
        statements.push(`ALTER TABLE ${table} ALTER COLUMN ${colName} DROP NOT NULL;`);
      } else {
        statements.push(`ALTER TABLE ${table} ALTER COLUMN ${colName} SET NOT NULL;`);
      }

      if (column.defaultValue !== undefined) {
        statements.push(
          `ALTER TABLE ${table} ALTER COLUMN ${colName} SET DEFAULT ${this.formatDefaultValue(column.defaultValue)};`,
        );
      } else {
        statements.push(`ALTER TABLE ${table} ALTER COLUMN ${colName} DROP DEFAULT;`);
      }
      return statements;
    }

    return [`ALTER TABLE ${table} ${this.dialect.alterColumnSyntax} ${newDefinition};`];
  }

  /**
   * Generate column comment clause (if supported)
   */
  public generateColumnComment(columnName: string, comment: string): string {
    if (this.features.columnComment) {
      const escapedComment = comment.replace(/'/g, "''");
      return ` COMMENT '${escapedComment}'`;
    }
    return '';
  }

  /**
   * Format a default value for SQL
   */
  public formatDefaultValue(value: unknown): string {
    if (this.dialect.booleanLiteral === 'integer' && typeof value === 'boolean') {
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
        tableName: this.dialect.resolveTableName(entity, meta),
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
      if (!field || field.virtual) continue;

      const columnName = this.dialect.resolveColumnName(key, field);
      const currentColumn = currentColumns.get(columnName);

      if (!currentColumn) {
        columnsToAdd.push(this.fieldToColumnSchema(key, field, meta));
      } else {
        const desiredColumn = this.fieldToColumnSchema(key, field, meta);
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

    const indexesToAdd = this.missingIndexes(entity, currentTable);

    if (
      columnsToAdd.length === 0 &&
      columnsToAlter.length === 0 &&
      columnsToDrop.length === 0 &&
      indexesToAdd.length === 0
    ) {
      return undefined;
    }

    return {
      tableName: this.dialect.resolveTableName(entity, meta),
      type: 'alter',
      columnsToAdd: columnsToAdd.length > 0 ? columnsToAdd : undefined,
      columnsToAlter: columnsToAlter.length > 0 ? columnsToAlter : undefined,
      columnsToDrop: columnsToDrop.length > 0 ? columnsToDrop : undefined,
      indexesToAdd: indexesToAdd.length > 0 ? indexesToAdd : undefined,
    };
  }

  /**
   * Indexes the entity declares that the table does not have, matched by name and built the same way
   * `CREATE TABLE` builds them, so adding an `@Index` to an entity already in the database is picked
   * up rather than waiting for the table to be created from scratch somewhere else.
   *
   * Only ever additive. An index the entity does not name is left alone: it may well have been
   * created deliberately outside the ORM, and dropping it is a decision for a reviewed migration.
   */
  private missingIndexes<E>(entity: Type<E>, currentTable: TableNode): IndexSchema[] {
    const desired = buildEntityAST(this, [entity]).getTable(currentTable.name)?.indexes ?? [];
    const present = new Set(currentTable.indexes.map((index) => index.name));
    return desired
      .filter((index) => !present.has(index.name) && !this.isInlineVectorIndex(index))
      .map(indexNodeToSchema);
  }

  /**
   * A vector index this dialect declares inside `CREATE TABLE` rather than as a statement of its own,
   * which MariaDB is alone in doing. It has no `CREATE INDEX` form, so it can only ever be created
   * with its table, never added to one.
   */
  private isInlineVectorIndex(index: IndexNode): boolean {
    return this.features.inlineVectorIndex && index.type === 'vector';
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
   * Convert field options to ColumnSchema. Both sides of a diff are the engine's SQL spelling: what it
   * would create for this field, against what it reported for the existing column.
   */
  protected fieldToColumnSchema<E>(fieldKey: string, field: FieldOptions, meta: EntityMeta<E>): ColumnSchema {
    const isPrimaryKey = field.isId === true && meta.id === fieldKey;

    return {
      name: this.dialect.resolveColumnName(fieldKey, field),
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
   * Whether two column types are the same *as this engine stores them*.
   *
   * Both sides are SQL spellings, parsed back to canonical so that `INT` and `INTEGER`, or `DATETIME`
   * and `TIMESTAMP`, do not read as a change. Do not "simplify" this into comparing the entity's
   * canonical type against the column's: several canonical types share one storage type per engine
   * (`boolean` is `TINYINT(1)` on MySQL and `INTEGER` on SQLite), so that comparison reports an
   * alteration for those columns on every single sync.
   */
  protected isTypeEqual(current: ColumnSchema, desired: ColumnSchema): boolean {
    return areTypesEqual(sqlToCanonical(current.type), sqlToCanonical(desired.type));
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

  generateCreateTableFromNode(table: TableNode, options: { ifNotExists?: boolean } = {}): string[] {
    const columns: string[] = [];
    const constraints: string[] = [];

    const vectorIndexes = table.indexes.filter((index) => this.isInlineVectorIndex(index));
    const regularIndexes = table.indexes.filter((index) => !this.isInlineVectorIndex(index));
    // MariaDB rejects a `VECTOR INDEX` whose column is nullable ("All parts of a VECTOR index must
    // be NOT NULL"), so being indexed decides it rather than the entity's own nullability.
    const indexedVectorColumns = new Set(vectorIndexes.flatMap((idx) => idx.entries.map((entry) => entry.column)));

    for (const col of table.columns.values()) {
      const colDef = this.generateColumnFromNode(
        indexedVectorColumns.has(col.name) ? { ...col, nullable: false } : col,
      );
      columns.push(colDef);
    }

    if (table.primaryKey.length > 1) {
      const pkCols = table.primaryKey.map((c) => this.escapeId(c.name)).join(', ');
      constraints.push(`PRIMARY KEY (${pkCols})`);
    }

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

    const ifNotExists = options.ifNotExists && this.features.ifNotExists ? 'IF NOT EXISTS ' : '';
    let createSql = `CREATE TABLE ${ifNotExists}${this.escapeId(table.name)} (\n`;
    createSql += columns.map((col) => `  ${col}`).join(',\n');

    if (constraints.length > 0) {
      createSql += ',\n';
      createSql += constraints.map((c) => `  ${c}`).join(',\n');
    }

    if (vectorIndexes.length > 0) {
      createSql += ',\n';
      createSql += vectorIndexes
        .map((idx) => `  ${this.dialect.getInlineVectorIndexDeclaration(indexNodeToSchema(idx))}`)
        .join(',\n');
    }

    createSql += '\n)';

    if (this.dialect.tableOptions) {
      createSql += ` ${this.dialect.tableOptions}`;
    }

    createSql += ';';

    const statements: string[] = [];
    if (this.dialect.vectorExtension) {
      const hasVectorCol = [...table.columns.values()].some((c) => isVectorCategory(c.type.category));
      if (hasVectorCol) {
        statements.push(`CREATE EXTENSION IF NOT EXISTS ${this.dialect.vectorExtension};`);
      }
    }
    statements.push(createSql);
    for (const idx of regularIndexes) {
      statements.push(this.generateCreateIndexFromNode(idx));
    }
    return statements;
  }

  /**
   * Generate a column definition from a ColumnNode. A composite key is declared as a table constraint,
   * so only a lone primary key column carries `PRIMARY KEY` inline.
   */
  protected generateColumnFromNode(col: ColumnNode): string {
    return this.renderColumn({
      ...col,
      type: col.isPrimaryKey && col.isAutoIncrement ? this.serialPrimaryKeyType : this.canonicalTypeToSql(col.type),
      declaresPrimaryKey: col.isPrimaryKey && col.table.primaryKey.length === 1,
    });
  }

  /**
   * Generate CREATE INDEX SQL from an IndexNode.
   * Delegates to `generateCreateIndex` for unified SQL assembly.
   */
  generateCreateIndexFromNode(index: IndexNode, options: { ifNotExists: boolean } = { ifNotExists: false }): string {
    return this.generateCreateIndex(index.table.name, indexNodeToSchema(index), options);
  }

  generateCreateTableFromDefinition(table: TableDefinition, options: { ifNotExists?: boolean } = {}): string[] {
    const tableNode = tableDefinitionToNode(table);
    return this.generateCreateTableFromNode(tableNode, options);
  }

  generateRenameTableSql(oldName: string, newName: string): string {
    if (this.dialect.renameTableSyntax === 'rename-table') {
      return `RENAME TABLE ${this.escapeId(oldName)} TO ${this.escapeId(newName)};`;
    }
    return `ALTER TABLE ${this.escapeId(oldName)} RENAME TO ${this.escapeId(newName)};`;
  }

  generateAddColumnSql(tableName: string, column: FullColumnDefinition): string {
    const colSql = this.generateColumnFromNode(fullColumnDefinitionToNode(column, tableName));
    return `ALTER TABLE ${this.escapeId(tableName)} ADD COLUMN ${colSql};`;
  }

  generateAlterColumnSql(tableName: string, columnName: string, column: FullColumnDefinition): string {
    const node = fullColumnDefinitionToNode(column, tableName);
    return this.generateAlterColumnStatements(
      tableName,
      { ...this.columnNodeToSchema(node), name: columnName },
      this.generateColumnFromNode(node),
    ).join('\n');
  }

  generateDropColumnSql(tableName: string, columnName: string): string {
    return `ALTER TABLE ${this.escapeId(tableName)} DROP COLUMN ${this.escapeId(columnName)};`;
  }

  generateRenameColumnSql(tableName: string, oldName: string, newName: string): string {
    return `ALTER TABLE ${this.escapeId(tableName)} RENAME COLUMN ${this.escapeId(oldName)} TO ${this.escapeId(newName)};`;
  }

  generateAddForeignKeySql(tableName: string, foreignKey: TableForeignKeyDefinition): string {
    const fkCols = foreignKey.columns.map((c) => this.escapeId(c)).join(', ');
    const refCols = foreignKey.referencesColumns.map((c) => this.escapeId(c)).join(', ');
    const constraintName = foreignKey.name
      ? this.escapeId(foreignKey.name)
      : this.escapeId(`fk_${tableName}_${foreignKey.columns.join('_')}`);

    if (!this.features.foreignKeyAlter) {
      throw new Error(`Dialect ${this.dialect} does not support adding foreign keys to existing tables`);
    }

    return (
      `ALTER TABLE ${this.escapeId(tableName)} ADD CONSTRAINT ${constraintName} ` +
      `FOREIGN KEY (${fkCols}) REFERENCES ${this.escapeId(foreignKey.referencesTable)} (${refCols}) ` +
      `ON DELETE ${foreignKey.onDelete ?? this.defaultForeignKeyAction} ON UPDATE ${foreignKey.onUpdate ?? this.defaultForeignKeyAction};`
    );
  }

  generateDropForeignKeySql(tableName: string, constraintName: string): string {
    return `ALTER TABLE ${this.escapeId(tableName)} ${this.dialect.dropForeignKeySyntax} ${this.escapeId(constraintName)};`;
  }
}

/**
 * The entities as an AST, named the way `generator` names things.
 *
 * Its resolvers rather than a naming strategy, because the two disagree: a strategy renames whatever
 * it is handed, while a generator leaves an explicit `@Entity({ name })` alone. Build the AST the
 * other way and the table is created under one name and compared under another, which reports every
 * table of a project using a naming strategy as both missing and unexpected.
 */
export function buildEntityAST(
  generator: Pick<SchemaGenerator, 'resolveTableName' | 'resolveColumnName'>,
  entities: readonly Type<unknown>[],
  defaultForeignKeyAction?: ForeignKeyAction,
): SchemaAST {
  return buildSchemaAST(entities, {
    resolveTableName: (entity, meta) => generator.resolveTableName(entity, meta),
    resolveColumnName: (key, field) => generator.resolveColumnName(key, field),
    defaultForeignKeyAction,
  });
}

/**
 * Synchronous factory for SQL schema generators only.
 * For MongoDB, use `createSchemaGeneratorAsync` from `./schemaGeneratorAsync.js` so the optional `mongodb` peer is not loaded at import time.
 */
export function createSchemaGenerator(
  dialect: AbstractDialect,
  defaultForeignKeyAction?: ForeignKeyAction,
): SqlSchemaGenerator | undefined {
  if (!(dialect instanceof AbstractSqlDialect)) {
    return undefined;
  }
  return new SqlSchemaGenerator(dialect, defaultForeignKeyAction);
}
