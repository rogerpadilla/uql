import { type AbstractDialect, AbstractSqlDialect } from '../dialect/index.js';
import { getMeta, soleIdOf } from '../entity/index.js';
import {
  areTypesEqual,
  canonicalToSql,
  fieldOptionsToCanonical,
  isVectorCategory,
  sqlToCanonical,
} from '../schema/canonicalType.js';
import { indexSignature } from '../schema/indexDifferences.js';
import type { SchemaAST } from '../schema/schemaAST.js';
import { buildSchemaAST } from '../schema/schemaASTBuilder.js';
import { type DiffOptions, diffTable } from '../schema/schemaASTDiffer.js';
import type {
  CanonicalType,
  CheckSchema,
  ColumnNode,
  EnumValues,
  ForeignKeyAction,
  IndexNode,
  TableNode,
} from '../schema/types.js';
import type {
  ColumnSchema,
  CreateSchemaOptions,
  DialectFeatures,
  DropSchemaOptions,
  EntityMeta,
  FieldKey,
  FieldMeta,
  FieldOptions,
  IndexSchema,
  NamingStrategy,
  SchemaDiff,
  SchemaGenerator,
  SqlDdlGenerator,
  Type,
} from '../type/index.js';
import { getKeys, isAutoIncrement, isSoleIdField, qualifyName } from '../util/index.js';
import { derivedCheckName, derivedForeignKeyName, derivedPrimaryKeyName } from '../util/sql.util.js';
import { formatDefaultValue, SqlExpression } from './builder/expressions.js';
import type { FullColumnDefinition, TableDefinition, TableForeignKeyDefinition } from './builder/types.js';
import { type IndexDdl, indexDdlFor } from './ddl/index.js';
import { fullColumnDefinitionToNode, tableDefinitionToNode } from './generator/definitionToNode.js';
import { indexNodeToSchema } from './generator/indexNodeToSchema.js';

/**
 * Unified SQL schema generator.
 * Parameterized by dialect to handle Postgres, MySQL, MariaDB, and SQLite.
 */
export class SqlSchemaGenerator implements SqlDdlGenerator {
  /** `CREATE INDEX` for this dialect: the migrator's, so a runtime import carries none of it. */
  protected readonly indexDdl: IndexDdl;

  constructor(
    protected readonly dialect: AbstractSqlDialect,
    protected readonly defaultForeignKeyAction: ForeignKeyAction = 'NO ACTION',
  ) {
    this.indexDdl = indexDdlFor(dialect);
  }

  get namingStrategy(): NamingStrategy | undefined {
    return this.dialect.namingStrategy;
  }

  get features(): DialectFeatures {
    return this.dialect.features;
  }

  resolveTableName<E>(meta: EntityMeta<E>): string {
    return this.dialect.resolveTableName(meta);
  }

  resolveTableAlias<E>(meta: EntityMeta<E>): string {
    return this.dialect.resolveTableAlias(meta);
  }

  resolveSchema<E>(meta: EntityMeta<E>): string | undefined {
    return this.dialect.resolveSchema(meta);
  }

  resolveColumnName(key: string, field: FieldOptions): string {
    return this.dialect.resolveColumnName(key, field);
  }

  /** Escape an identifier (table name, column name, etc.) */
  protected escapeId(identifier: string): string {
    return this.dialect.escapeId(identifier);
  }

  /**
   * Primary key type for auto-increment integer IDs
   */
  protected get serialType(): string {
    return this.dialect.serialType;
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

    // Namespaces first: a qualified `CREATE TABLE` fails against a schema nobody created, and the
    // schema is the one part of the layout a migration cannot infer from the table it is making.
    const statements = this.generateCreateSchemas(tables);

    statements.push(
      ...tables.flatMap((table) =>
        this.generateCreateTableFromNode(inline ? table : { ...table, outgoingRelations: [] }, options),
      ),
    );

    if (withForeignKeys && !inline) {
      for (const table of tables) {
        for (const rel of table.outgoingRelations) {
          statements.push(
            this.generateAddForeignKeySql(qualifyName(table.name, table.schema), {
              name: rel.name,
              columns: rel.from.columns.map((c) => c.name),
              referencesTable: qualifyName(rel.to.table.name, rel.to.table.schema),
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

  /**
   * One statement per distinct schema the tables being created live in, in first-seen order. Only
   * the tables actually being created, so a narrowed `only` does not declare namespaces it is not
   * about to fill. Empty on an engine without schemas, whose tables are never qualified.
   */
  private generateCreateSchemas(tables: readonly TableNode[]): string[] {
    const named = tables.map((table) => table.schema).filter((it) => it !== undefined);
    return [...new Set(named)].map((schema) => this.dialect.createSchemaSql(schema));
  }

  generateDropSchema(entities: readonly Type<unknown>[], options: DropSchemaOptions = {}): string[] {
    return this.orderedTables(entities, 'drop').map((table) =>
      this.generateDropTable(qualifyName(table.name, table.schema), options),
    );
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
    return tables.filter((table) => wanted.has(qualifyName(table.name, table.schema)));
  }

  generateDropTable(tableName: string, options: DropSchemaOptions = {}): string {
    const ifExists = options.ifExists ? 'IF EXISTS ' : '';
    const cascade = options.cascade && this.features.dropTableCascade ? ' CASCADE' : '';
    return `DROP TABLE ${ifExists}${this.escapeId(tableName)}${cascade};`;
  }

  generateAlterTable(diff: SchemaDiff): string[] {
    const statements: string[] = [];
    const tableName = this.escapeId(diff.tableName);

    // Before the columns, because a key column being added cannot be part of the old key, and after
    // it is dropped the table is free to take the new one below.
    if (diff.primaryKey?.from.length) {
      statements.push(this.generateDropPrimaryKeySql(diff.tableName, diff.primaryKey.fromName));
    }

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
        statements.push(this.generateDropIndex(diff.tableName, indexName, diff.schema));
      }
    }

    // Last, so every column it names exists by now.
    if (diff.primaryKey?.to.length) {
      statements.push(this.generateAddPrimaryKeySql(diff.tableName, diff.primaryKey.to));
    }

    return statements;
  }

  generateAlterTableDown(diff: SchemaDiff): string[] {
    const statements: string[] = [];
    const tableName = this.escapeId(diff.tableName);

    // The key first, mirroring the up direction: a column the up added cannot be dropped below while
    // the new key still names it. Restored under the name the database gave it, which is what the
    // table had before, rather than a derived one that was never on it.
    if (diff.primaryKey?.to.length) {
      statements.push(
        this.generateDropPrimaryKeySql(diff.tableName, derivedPrimaryKeyName(diff.tableName, diff.primaryKey.to)),
      );
    }

    // Reverse column additions by dropping them
    if (diff.columnsToAdd?.length) {
      for (const column of diff.columnsToAdd) {
        statements.push(`ALTER TABLE ${tableName} DROP COLUMN ${this.escapeId(column.name)};`);
      }
    }

    // Reverse column alterations by restoring original schema
    if (diff.columnsToAlter?.length) {
      for (const { from } of diff.columnsToAlter) {
        const colDef = this.generateColumnDefinitionFromSchema(from);
        const colStatements = this.generateAlterColumnStatements(diff.tableName, from, colDef);
        statements.push(...colStatements);
      }
    }

    // Reverse index additions by dropping them
    if (diff.indexesToAdd?.length) {
      for (const index of diff.indexesToAdd) {
        statements.push(this.generateDropIndex(diff.tableName, index.name, diff.schema));
      }
    }

    if (diff.primaryKey?.from.length) {
      statements.push(this.generateAddPrimaryKeySql(diff.tableName, diff.primaryKey.from, diff.primaryKey.fromName));
    }

    if (diff.columnsToDrop?.length || diff.indexesToDrop?.length) {
      statements.push(`-- TODO: Manual reversal needed for dropped columns/indexes`);
    }

    return statements;
  }

  generateCreateIndex(tableName: string, index: IndexSchema, options: { ifNotExists?: boolean } = {}): string {
    return this.indexDdl.getCreateIndexStatement(tableName, index, options);
  }

  /**
   * `schema` is the table's, because that is where its indexes live. MySQL takes it from the table
   * operand instead, which is already qualified.
   */
  generateDropIndex(tableName: string, indexName: string, schema?: string): string {
    if (this.dialect.dropIndexSyntax === 'on-table') {
      return `DROP INDEX ${this.escapeId(indexName)} ON ${this.escapeId(tableName)};`;
    }
    return `DROP INDEX IF EXISTS ${this.dialect.escapeQualifiedId(indexName, schema)};`;
  }

  /**
   * A column definition from a {@link ColumnSchema}, whose type is already the engine's own spelling
   * and may carry its own size.
   *
   * Kept apart from {@link generateColumnFromNode} rather than folded into it: a `ColumnSchema` has no
   * `enum`, because introspection reads one back as a `CHECK` constraint and not as a property of the
   * column, so only the node knows enough to emit that clause. Both spell the definition through
   * {@link renderColumn}, which is the part that must not be written twice.
   */
  public generateColumnDefinitionFromSchema(column: ColumnSchema): string {
    let type = column.type;

    if (!type.includes('(')) {
      if (column.precision !== undefined) {
        type += column.scale === undefined ? `(${column.precision})` : `(${column.precision}, ${column.scale})`;
      } else if (column.length !== undefined) {
        type += `(${column.length})`;
      }
    }

    return this.renderColumn({ ...column, type });
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
    defaultValue?: unknown;
    enum?: EnumValues;
    comment?: string;
  }): string {
    let def = `${this.escapeId(column.name)} ${column.type}`;

    if (!column.nullable && !column.isPrimaryKey) {
      def += ' NOT NULL';
    }
    if (column.isUnique && !column.isPrimaryKey) {
      def += ' UNIQUE';
    }
    if (column.enum?.length) {
      const values = column.enum.map((value) => this.dialect.escape(value)).join(', ');
      def += ` CHECK (${this.escapeId(column.name)} IN (${values}))`;
    }
    def += this.defaultClause(column);

    if (column.comment) {
      def += this.generateColumnComment(column.name, column.comment);
    }

    return def;
  }

  /** ` DEFAULT <sql>`, or nothing where the column declares none. Empty rather than `DEFAULT NULL`
   * so an absent default stays absent - `defaultValue: null` is the way to ask for one. */
  private defaultClause(column: { defaultValue?: unknown; type: string }): string {
    return column.defaultValue === undefined
      ? ''
      : ` DEFAULT ${formatDefaultValue(column.defaultValue, this.dialect, column.type)}`;
  }

  public getSqlType(field: FieldMeta, fieldType?: unknown, isSoleKey = field.isId === true): string {
    // If field has a reference, inherit type from the target primary key
    if (field.references) {
      const refEntity = field.references();
      const refMeta = getMeta(refEntity);
      const refIdField = refMeta.fields[field.referencedKey ?? soleIdOf(refMeta, 'a foreign key')];
      return this.getSqlType(
        { ...refIdField, references: undefined, isId: undefined, autoIncrement: false },
        refIdField!.type,
      );
    }

    // Get canonical type and convert to SQL
    const canonical = this.getCanonicalType(field, fieldType);

    // Special case for serial primary keys
    if (isAutoIncrement(field, isSoleKey)) {
      return this.dialect.serialType;
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
      throw new TypeError(
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
        statements.push(`ALTER TABLE ${table} ALTER COLUMN ${colName} SET${this.defaultClause(column)};`);
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
   * Compare an entity with a database table node and return the differences.
   */
  /**
   * How this entity differs from the table the database reported, as the migrator's `SchemaDiff`.
   *
   * The comparison itself is {@link diffTable}, the same one drift detection runs, so the two can no
   * longer disagree about what has changed. Only two things are this side's own: the entity becomes a
   * table node first, and types are compared as the *engine* would store them - see `normalizeType`.
   */
  diffSchema<E>(entity: Type<E>, currentTable: TableNode | undefined): SchemaDiff | undefined {
    const meta = getMeta(entity);
    const tableName = this.resolveTableName(meta);
    const schema = this.resolveSchema(meta);

    if (!currentTable) {
      return { tableName, schema, type: 'create' };
    }

    // Keyed by the qualified name this generator resolves, which is the key the AST it just built
    // stores the table under.
    const desired = buildEntityAST(this, [entity]).getTable(tableName);
    if (!desired) {
      return undefined;
    }

    // Indexes are matched here rather than by the differ, which pairs them by name so that a changed
    // one reads as one index that altered. A migration needs the opposite: an index already in the
    // table, under whatever name, must not be created again, and one whose shape differs is a
    // separate index rather than a change - no engine alters an index's columns or uniqueness.
    const tableDiff = diffTable(desired, currentTable, { ...this.diffOptions(), compareIndexes: false });
    const indexesToAdd = this.missingIndexes(desired, currentTable);

    const columnDiffs = tableDiff?.columnDiffs ?? [];
    const columnsToAdd = columnDiffs.flatMap((it) => (it.type === 'add' ? [this.columnNodeToSchema(it.expected)] : []));
    const columnsToDrop = columnDiffs.flatMap((it) => (it.type === 'drop' ? [it.column] : []));
    const columnsToAlter = columnDiffs.flatMap((it) =>
      it.type === 'alter'
        ? [{ from: this.columnNodeToSchema(it.actual), to: this.columnNodeToSchema(it.expected) }]
        : [],
    );
    const primaryKey = tableDiff?.primaryKeyDiff && {
      from: tableDiff.primaryKeyDiff.actual,
      to: tableDiff.primaryKeyDiff.expected,
      fromName: tableDiff.primaryKeyDiff.actualName,
    };

    if (
      !columnsToAdd.length &&
      !columnsToAlter.length &&
      !columnsToDrop.length &&
      !indexesToAdd.length &&
      !primaryKey
    ) {
      return undefined;
    }

    return {
      tableName,
      schema,
      type: 'alter',
      primaryKey,
      columnsToAdd: columnsToAdd.length ? columnsToAdd : undefined,
      columnsToAlter: columnsToAlter.length ? columnsToAlter : undefined,
      columnsToDrop: columnsToDrop.length ? columnsToDrop : undefined,
      indexesToAdd: indexesToAdd.length ? indexesToAdd : undefined,
    };
  }

  /**
   * What the shared differ needs from a dialect: a type as this engine would actually store it.
   *
   * `boolean` is `TINYINT(1)` on MySQL and `INTEGER` on SQLite, so two canonical types that differ on
   * paper can be one column in the database. Round-tripping through the engine's own spelling is what
   * stops every such column reporting an alteration on every sync.
   */
  /**
   * Indexes the entity declares that the table does not already have, in any shape.
   *
   * Additive only: an index the entity does not name may well have been created deliberately outside
   * the ORM, and dropping it is a decision for a reviewed migration.
   */
  private missingIndexes(desired: TableNode, currentTable: TableNode): IndexSchema[] {
    const present = new Set(currentTable.indexes.map(indexSignature));
    return desired.indexes.filter((index) => !present.has(indexSignature(index))).map(indexNodeToSchema);
  }

  protected diffOptions(): DiffOptions {
    return {
      normalizeType: (type) => sqlToCanonical(this.canonicalTypeToSql(type)),
      defaultsEqual: (expected, actual) => this.isDefaultValueEqual(actual, expected),
    };
  }

  private columnNodeToSchema(col: ColumnNode): ColumnSchema {
    return {
      name: col.name,
      // The same rule `generateColumnFromNode` renders by, so a column added to an existing table
      // gets the type it would have had if the table were created from scratch.
      type: col.isPrimaryKey && col.isAutoIncrement ? this.serialType : this.canonicalTypeToSql(col.type),
      nullable: col.nullable,
      defaultValue: col.defaultValue,
      isPrimaryKey: col.isPrimaryKey,
      isAutoIncrement: col.isAutoIncrement,
      isUnique: col.isUnique,
      comment: col.comment,
    };
  }

  /**
   * Compare two default values for equality
   */
  protected isDefaultValueEqual(current: unknown, desired: unknown): boolean {
    if (current === desired) return true;
    // Both spellings of "no default" are the same fact, and engines disagree on which they report:
    // MariaDB says `null` where MySQL says nothing at all. Reading them as different values asked to
    // `MODIFY` every nullable column, on every sync, forever.
    if (current == null || desired == null) return current == null && desired == null;

    const normalize = (value: unknown): string => {
      if (value === null) return 'null';
      // Render first: the desired side may be a symbolic expression, the current side is always the
      // engine's own text, and `{"kind":"now"}` matches no spelling of `CURRENT_TIMESTAMP`.
      const val = SqlExpression.isExpression(value) ? formatDefaultValue(value, this.dialect) : value;
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

    // MariaDB rejects a `VECTOR INDEX` whose column is nullable ("All parts of a VECTOR index must
    // be NOT NULL"), so being indexed decides it rather than the entity's own nullability.
    const indexedVectorColumns = new Set(
      this.features.vectorIndexRequiresNotNull
        ? table.indexes.filter((index) => index.type === 'vector').flatMap((idx) => idx.entries.map((e) => e.column))
        : [],
    );

    for (const col of table.columns.values()) {
      const colDef = this.generateColumnFromNode(
        indexedVectorColumns.has(col.name) ? { ...col, nullable: false } : col,
      );
      columns.push(colDef);
    }

    // Every key, of any width, as one named constraint beside the checks and foreign keys - so a
    // later `DROP` has something to name. The exception is a dialect whose serial type states the key
    // itself (SQLite's `INTEGER PRIMARY KEY AUTOINCREMENT`, which cannot be split): there the column
    // has already declared it, and saying it again is a second primary key.
    const declaredByColumn =
      this.dialect.serialDeclaresPrimaryKey && table.primaryKey.length === 1 && table.primaryKey[0].isAutoIncrement;
    if (table.primaryKey.length && !declaredByColumn) {
      const pkColumns = table.primaryKey.map((c) => c.name);
      const pkName = table.primaryKeyName ?? derivedPrimaryKeyName(table.name, pkColumns);
      const pkCols = pkColumns.map((c) => this.escapeId(c)).join(', ');
      constraints.push(`CONSTRAINT ${this.escapeId(pkName)} PRIMARY KEY (${pkCols})`);
    }

    (table.checks ?? []).forEach((check, i) => {
      const name = check.name ?? derivedCheckName(table.name, i + 1);
      constraints.push(`CONSTRAINT ${this.escapeId(name)} CHECK (${check.expression})`);
    });

    for (const rel of table.outgoingRelations) {
      if (rel.from.columns.length > 0) {
        const fromCols = rel.from.columns.map((c) => this.escapeId(c.name)).join(', ');
        const toCols = rel.to.columns.map((c) => this.escapeId(c.name)).join(', ');
        const constraintName = rel.name ? `CONSTRAINT ${this.escapeId(rel.name)} ` : '';
        constraints.push(
          `${constraintName}FOREIGN KEY (${fromCols}) REFERENCES ${this.dialect.escapeQualifiedId(rel.to.table.name, rel.to.table.schema)} (${toCols})` +
            ` ON DELETE ${rel.onDelete ?? this.defaultForeignKeyAction} ON UPDATE ${rel.onUpdate ?? this.defaultForeignKeyAction}`,
        );
      }
    }

    const ifNotExists = options.ifNotExists && this.features.ifNotExists ? 'IF NOT EXISTS ' : '';
    let createSql = `CREATE TABLE ${ifNotExists}${this.dialect.escapeQualifiedId(table.name, table.schema)} (\n`;
    createSql += columns.map((col) => `  ${col}`).join(',\n');

    if (constraints.length > 0) {
      createSql += ',\n';
      createSql += constraints.map((c) => `  ${c}`).join(',\n');
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
    for (const idx of table.indexes) {
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
      type: col.isPrimaryKey && col.isAutoIncrement ? this.serialType : this.canonicalTypeToSql(col.type),
    });
  }

  /**
   * Generate CREATE INDEX SQL from an IndexNode.
   * Delegates to `generateCreateIndex` for unified SQL assembly.
   */
  generateCreateIndexFromNode(index: IndexNode, options: { ifNotExists: boolean } = { ifNotExists: false }): string {
    // The index's own name stays unqualified: it is created in the schema of the table it is on.
    return this.generateCreateIndex(
      qualifyName(index.table.name, index.table.schema),
      indexNodeToSchema(index),
      options,
    );
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
      : this.escapeId(derivedForeignKeyName(tableName, foreignKey.columns));

    if (!this.features.foreignKeyAlter) {
      throw new TypeError(`Dialect ${this.dialect} does not support adding foreign keys to existing tables`);
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

  /**
   * `ALTER TABLE ... ADD CONSTRAINT <name> PRIMARY KEY (...)`, the other half of
   * {@link generateDropPrimaryKeySql}. Refused where the engine cannot alter a key at all, by name,
   * rather than emitting DDL it will reject.
   */
  generateAddPrimaryKeySql(tableName: string, columns: readonly string[], name?: string): string {
    this.assertPrimaryKeyAlterable(tableName);
    const constraintName = this.escapeId(name ?? derivedPrimaryKeyName(tableName, columns));
    const pkCols = columns.map((c) => this.escapeId(c)).join(', ');
    return `ALTER TABLE ${this.escapeId(tableName)} ADD CONSTRAINT ${constraintName} PRIMARY KEY (${pkCols});`;
  }

  /**
   * Drops whatever key the table has.
   *
   * `constraintName` has to be what the constraint is *actually* called: the name introspection
   * reported for a key the database already had, or the derived one for a key this generator itself
   * added, which is what reversing a migration drops. Guessing either way names nothing. MySQL takes
   * no name at all - a table's key is always `PRIMARY` there.
   */
  generateDropPrimaryKeySql(tableName: string, constraintName?: string): string {
    this.assertPrimaryKeyAlterable(tableName);
    const table = this.escapeId(tableName);
    if (this.dialect.dropPrimaryKeySyntax === 'DROP PRIMARY KEY') {
      return `ALTER TABLE ${table} DROP PRIMARY KEY;`;
    }
    if (!constraintName) {
      throw new TypeError(
        `Cannot drop the primary key of "${tableName}": ${this.dialect} names the constraint, and ` +
          'introspection did not report a name for it.',
      );
    }
    return `ALTER TABLE ${table} DROP CONSTRAINT ${this.escapeId(constraintName)};`;
  }

  private assertPrimaryKeyAlterable(tableName: string): void {
    if (this.features.primaryKeyAlter) {
      return;
    }
    throw new TypeError(
      `${this.dialect}: Cannot change the primary key of "${tableName}" - this database has no ALTER ` +
        'for it. Recreate the table in a written migration.',
    );
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
  generator: Pick<SchemaGenerator, 'resolveTableAlias' | 'resolveSchema' | 'resolveColumnName'>,
  entities: readonly Type<unknown>[],
  defaultForeignKeyAction?: ForeignKeyAction,
): SchemaAST {
  return buildSchemaAST(entities, {
    // The alias, not `resolveTableName`: a node holds its schema separately, so that a name derived
    // from it stays a single identifier.
    resolveTableName: (meta) => generator.resolveTableAlias(meta),
    resolveSchema: (meta) => generator.resolveSchema(meta),
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
