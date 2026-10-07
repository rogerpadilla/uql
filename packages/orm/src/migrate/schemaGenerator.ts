import type { AbstractSqlDialect } from '../dialect/index.js';
import { getMeta } from '../entity/index.js';
import { canonicalToSql, engineType, isVectorCategory } from '../schema/canonicalType.js';
import { indexChanges } from '../schema/indexDifferences.js';
import { matchByKey } from '../schema/matchByKey.js';
import type { SchemaAST } from '../schema/schemaAST.js';
import { type BuildSchemaASTOptions, buildSchemaAST } from '../schema/schemaASTBuilder.js';
import { type DiffOptions, diffRelationshipNodes, diffTable } from '../schema/schemaASTDiffer.js';
import {
  type CanonicalType,
  type ColumnNode,
  type CheckSchema,
  DEFAULT_FOREIGN_KEY_ACTION,
  type ForeignKeyAction,
  type IndexNode,
  type RelationshipNode,
  type TableNode,
} from '../schema/types.js';
import type {
  Change,
  ColumnChange,
  ColumnSchema,
  CreateSchemaOptions,
  DialectFeatures,
  DropSchemaOptions,
  EntityMeta,
  EntityWhereMeta,
  FieldOptions,
  ForeignKeySchema,
  IndexSchema,
  PrimaryKeySchema,
  RebuiltTable,
  Rename,
  StoredDefinition,
  NamingStrategy,
  SchemaDiff,
  SchemaGenerator,
  Type,
} from '../type/index.js';
import { enumCheck } from '../util/ddlExpression.util.js';
import { qualifyName } from '../util/index.js';
import { derivedForeignKeyName, derivedPrimaryKeyName, isOwnedName, splitQualifiedName } from '../util/sql.util.js';
import { splitSqlStatements } from './builder/splitSqlStatements.js';
import type { AnyMigrationOperation, FullColumnDefinition, TableDefinition } from './builder/types.js';
import { formatDefaultValue, sameDefault } from './ddl/defaultSql.js';
import { type IndexDdl, indexDdlFor, type TableDdl, tableDdlFor } from './ddl/index.js';
import { rebuildRefusal, sizedType } from './ddl/tableDdl.js';
import { rebuildTable } from './ddl/tableRebuild.js';
import {
  columnForeignKey,
  columnIndex,
  bareColumn,
  renderIndexDefinition,
  tableDefinitionToNode,
} from './generator/definitionToNode.js';
import { indexNodeToSchema } from './generator/indexNodeToSchema.js';
import { assertIndexPredicate } from './indexPredicate.js';
import { added, alterations, dropped, needsRebuild, newlyRequired, nonEmpty, sides } from './schemaChange.js';
import { dropTrigger, dropTriggerBody, renderTrigger, stampTriggers } from './triggerSql.js';

/**
 * Unified SQL schema generator.
 * Parameterized by dialect to handle Postgres, MySQL, MariaDB, and SQLite.
 */
export class SqlSchemaGenerator implements SchemaGenerator {
  /** `CREATE INDEX` for this dialect: the migrator's, so a runtime import carries none of it. */
  protected readonly indexDdl: IndexDdl;

  /** The `ALTER TABLE` statements this dialect spells its own way, the migrator's for the same reason. */
  protected readonly tableDdl: TableDdl;

  constructor(
    protected readonly dialect: AbstractSqlDialect,
    protected readonly defaultForeignKeyAction: ForeignKeyAction = DEFAULT_FOREIGN_KEY_ACTION,
  ) {
    this.indexDdl = indexDdlFor(dialect);
    this.tableDdl = tableDdlFor(dialect);
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

  compileDdl(sql: EntityWhereMeta<object>, entity: Type<object>): string {
    return this.dialect.compileDdl(sql, entity);
  }

  compileIndexPredicate(where: EntityWhereMeta<object>, entity: Type<object>, indexName: string): string {
    assertIndexPredicate(where, this.dialect.dialectName, indexName);
    return this.dialect.compileDdl(where, entity);
  }

  /** Escape an identifier (table name, column name, etc.) */
  protected escapeId(identifier: string): string {
    return this.dialect.escapeId(identifier);
  }

  /**
   * An auto-increment key's type: its canonical type rendered like any column's, plus the engine's generated
   * suffix, so a foreign key taking its type from this key gets the same one.
   */
  protected serialType(type: CanonicalType): string {
    return `${this.canonicalTypeToSql(type)} ${this.dialect.autoIncrementSuffix}`;
  }

  /** The SQL type a column is spelled with: the generated-key form for an auto-increment key, the canonical type otherwise. */
  protected columnSqlType(col: Pick<ColumnNode, 'type' | 'isPrimaryKey' | 'isAutoIncrement'>): string {
    return col.isPrimaryKey && col.isAutoIncrement ? this.serialType(col.type) : this.canonicalTypeToSql(col.type);
  }

  protected canonicalTypeToSql(type: CanonicalType): string {
    return canonicalToSql(type, this.dialect);
  }

  /** The entity side as an AST, carrying this generator's default referential action. */
  buildAST(entities: readonly Type<object>[]): SchemaAST {
    return buildEntityAST(this, entities, {
      defaultForeignKeyAction: this.defaultForeignKeyAction,
      renderTriggers: (meta) =>
        [...(meta.triggers ?? []), ...stampTriggers(this.dialect, meta)].map((trigger, i) =>
          renderTrigger(this.dialect, meta, trigger, i),
        ),
      textScoreIndexes: this.dialect.features.textScoreIndexes,
      vectorIndexRequiresNotNull: this.features.vectorIndexRequiresNotNull,
    });
  }

  /**
   * Every `CREATE TABLE` for `entities`, then their foreign keys, since a relation graph is routinely
   * cyclic. SQLite keeps them inline: it cannot add one later, and resolves a forward reference lazily.
   */
  generateCreateSchema(entities: readonly Type<object>[], options: CreateSchemaOptions = {}): string[] {
    const tables = this.orderedTables(entities, 'create', options.only);
    // Inline only where a constraint cannot be added afterwards, which is what makes the cyclic case
    // work everywhere else.
    const inline = this.features.rebuildsTables;

    // Namespaces first: a qualified `CREATE TABLE` fails against a schema nobody created, and the
    // schema is the one part of the layout a migration cannot infer from the table it is making.
    const statements = this.generateCreateSchemas(tables);

    statements.push(
      ...tables.flatMap((table) =>
        this.generateCreateTableFromNode(inline ? table : { ...table, outgoingRelations: [] }, options),
      ),
    );

    if (!inline) {
      for (const table of tables) {
        statements.push(
          ...this.addForeignKeyStatements(
            qualifyName(table.name, table.schema),
            table.outgoingRelations.map(foreignKeyOf),
          ),
        );
      }
    }

    // Triggers last: each needs its own table, and a body may read any other the same schema just made.
    statements.push(...terminated(tables.flatMap((table) => table.triggers.flatMap((trigger) => trigger.statements))));

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

  /**
   * The inverse of {@link generateCreateSchema}: a table's drop takes its triggers along, so only what they
   * leave behind follows it.
   */
  generateDropSchema(entities: readonly Type<object>[], options: DropSchemaOptions = {}): string[] {
    const tables = this.orderedTables(entities, 'drop');
    // A `CASCADE` drop takes the foreign keys with it, and SQLite drops with its constraints off.
    const cascades = options.cascade && this.features.dropTableCascade;
    const existing = cascades || this.features.rebuildsTables ? [] : (options.existing?.getTables() ?? []);
    const foreignKeyDrops = existing.flatMap((table) => {
      const tableName = qualifyName(table.name, table.schema);
      const names = [
        ...table.outgoingRelations.map((relation) => relation.name),
        ...table.externalForeignKeys.map((foreignKey) => constraintNameOf(tableName, foreignKey)),
      ];
      return names.map((name) => this.generateDropForeignKeySql(tableName, name));
    });
    return [
      ...foreignKeyDrops,
      ...tables.flatMap((table) => [
        this.generateDropTable(qualifyName(table.name, table.schema), options),
        ...terminated(table.triggers.flatMap((trigger) => dropTriggerBody(this.dialect, table.schema, trigger.name))),
      ]),
    ];
  }

  /**
   * The tables of `entities` in dependency order, optionally narrowed to `only`. The AST always spans
   * every entity even when narrowed, so a relation pointing at a table outside the subset still
   * resolves instead of being silently dropped.
   */
  private orderedTables(
    entities: readonly Type<object>[],
    direction: 'create' | 'drop',
    only?: readonly string[],
  ): TableNode[] {
    const ast = this.buildAST(entities);
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

  /**
   * The statements taking a table through `diff`, in the one order both directions need: whatever holds
   * something down goes before it and comes back after it. A foreign key holds its columns and the key it
   * points at, so it goes first and comes back last; the key holds its columns; and some engines drop an
   * index along with its column, which would leave nothing to name. A check holds the columns it names, which
   * MySQL refuses to rename or drop under one. An alter is its drop, then its add.
   */
  generateAlterTable(diff: SchemaDiff): string[] {
    const { tableName, schema, primaryKey, columns, rebuild } = diff;
    const fills = this.defaultFills(columns);
    const moved = Boolean(rebuild || diff.renamedColumns?.length || sides(columns, 'from').length);
    const triggers = (diff.triggers ?? []).filter(({ from, to }) => moved || !from || !to);
    const triggerDrops = terminated(
      sides(triggers, 'from').flatMap((trigger) => dropTrigger(this.dialect, tableName, schema, trigger.name)),
    );
    const triggerCreates = terminated(sides(triggers, 'to').flatMap((trigger) => trigger.statements));
    if (rebuild) {
      return [
        ...triggerDrops,
        ...rebuildTable(this.dialect, tableName, rebuild, { renames: diff.renamedColumns ?? [], fills }),
        ...triggerCreates,
      ];
    }
    const target = this.escapeId(tableName);
    return [
      ...triggerDrops,
      ...sides(diff.foreignKeys, 'from').map((foreignKey) =>
        this.generateDropForeignKeySql(tableName, constraintNameOf(tableName, foreignKey)),
      ),
      ...(primaryKey?.from ? [this.generateDropPrimaryKeySql(tableName, primaryKey.from.name)] : []),
      ...sides(diff.indexes, 'from').map((index) => this.generateDropIndex(tableName, index.name, schema)),
      ...sides(diff.checks, 'from').map((check) => this.dropCheckSql(tableName, check)),
      ...(diff.renamedColumns ?? []).map(({ from, to }) => this.generateRenameColumnSql(tableName, from, to)),
      ...added(columns).flatMap((column) => this.addColumnStatements(tableName, column, schema)),
      ...[...fills].map(([column, value]) => {
        const name = this.escapeId(column);
        return `UPDATE ${target} SET ${name} = ${value} WHERE ${name} IS NULL;`;
      }),
      ...this.tableDdl.alterColumns(tableName, alterations(columns), (column) =>
        this.generateColumnDefinitionFromSchema(column),
      ),
      ...dropped(columns).flatMap((column) => this.tableDdl.dropColumn(tableName, column.name)),
      ...this.addIndexStatements(tableName, sides(diff.indexes, 'to')),
      ...(primaryKey?.to ? [this.generateAddPrimaryKeySql(tableName, primaryKey.to.columns, primaryKey.to.name)] : []),
      ...this.addForeignKeyStatements(tableName, sides(diff.foreignKeys, 'to')),
      ...sides(diff.checks, 'to').map((check) => this.addCheckSql(tableName, check)),
      ...triggerCreates,
    ];
  }

  /** `CONSTRAINT <name> CHECK (...)`, in a `CREATE TABLE`, after `ADD`, or inline where a column brings it. */
  private checkConstraint(check: CheckSchema): string {
    return `CONSTRAINT ${this.escapeId(check.name)} CHECK (${check.expression})`;
  }

  private addCheckSql(tableName: string, check: CheckSchema): string {
    return `ALTER TABLE ${this.escapeId(tableName)} ADD ${this.checkConstraint(check)};`;
  }

  private dropCheckSql(tableName: string, check: CheckSchema): string {
    return `ALTER TABLE ${this.escapeId(tableName)} DROP CONSTRAINT ${this.escapeId(check.name)};`;
  }

  /**
   * Each column the changes make required while declaring a default, and that default as SQL: the rows
   * already there hold a null it has to replace, and it is the only value the entity says it may take.
   */
  private defaultFills(columns: SchemaDiff['columns']): Map<string, string> {
    return new Map(
      newlyRequired(columns)
        .filter(({ from, to }) => from && to.defaultValue !== undefined)
        .map(({ to }) => [to.name, formatDefaultValue(to.defaultValue, this.dialect, to.type)]),
    );
  }

  /** `ADD CONSTRAINT` for each of `foreignKeys`. */
  private addForeignKeyStatements(tableName: string, foreignKeys: readonly ForeignKeySchema[]): string[] {
    return foreignKeys.map((foreignKey) => this.generateAddForeignKeySql(tableName, foreignKey));
  }

  /** An index added to a table that may already have rows: its `CREATE`, then what the engine needs after. */
  private addIndexStatements(tableName: string, indexes: readonly IndexSchema[]): string[] {
    return indexes.flatMap((index) => [
      this.generateCreateIndex(tableName, index),
      ...this.indexDdl.settleStatements(tableName, index),
    ]);
  }

  /**
   * A column added to a table that exists, and its comment where the engine keeps one apart. `checks` go
   * inline, which is the one way to constrain a table that is rebuilt to alter.
   */
  private addColumnStatements(
    tableName: string,
    column: ColumnSchema,
    schema?: string,
    checks: readonly CheckSchema[] = [],
  ): string[] {
    this.assertColumnAddable(tableName, column);
    const inline = checks.map((check) => ` ${this.checkConstraint(check)}`).join('');
    return [
      ...this.tableDdl.addColumnStatements(
        tableName,
        column,
        (it) => this.generateColumnDefinitionFromSchema(it) + inline,
      ),
      ...this.generateColumnCommentStatement(tableName, column, schema),
    ];
  }

  generateCreateIndex(tableName: string, index: IndexSchema, options: { ifNotExists?: boolean } = {}): string {
    return this.indexDdl.getCreateIndexStatement(tableName, index, options);
  }

  /**
   * `schema` is the table's, because that is where its indexes live. MySQL takes it from the table
   * operand instead, which is already qualified.
   */
  generateDropIndex(tableName: string, indexName: string, schema?: string): string {
    return this.tableDdl.dropIndex(tableName, indexName, schema);
  }

  /**
   * A column definition from a {@link ColumnSchema}, whose type is already the engine's spelling. Apart from
   * {@link generateColumnFromNode}, which sizes a canonical type; both render through {@link renderColumn}.
   */
  public generateColumnDefinitionFromSchema(column: ColumnSchema): string {
    return this.renderColumn({ ...column, type: sizedType(column) });
  }

  /**
   * The one place a column definition is spelled, so the `ColumnSchema` and `ColumnNode` paths cannot
   * drift. A key column states `NOT NULL` rather than leave it to the key: SQLite lets a key column hold
   * NULL otherwise, and SQL Server adds no key over a nullable column. Never `UNIQUE`: a unique column is
   * a unique index, which the table creates beside it. Nor an enum's `CHECK`, which is the table's, named.
   */
  private renderColumn(column: {
    name: string;
    type: string;
    nullable: boolean;
    isPrimaryKey: boolean;
    isUnique: boolean;
    defaultValue?: unknown;
    comment?: string;
    generatedAs?: string;
  }): string {
    const type = column.generatedAs
      ? this.tableDdl.storedGeneratedColumn(column.type, column.generatedAs)
      : column.type;
    let def = `${this.escapeId(column.name)} ${type}`;

    if (!column.nullable) {
      def += ' NOT NULL';
    }
    def += this.tableDdl.defaultClause(column);
    if (column.comment) {
      def += this.generateColumnComment(column.comment);
    }
    return def;
  }

  /** The inline ` COMMENT '...'` a column declaration carries, where the engine takes one there. */
  public generateColumnComment(comment: string): string {
    return this.features.commentSyntax === 'inline' ? ` COMMENT ${this.dialect.escape(comment)}` : '';
  }

  /** The `COMMENT ON` statements a table and its columns need, after the `CREATE TABLE`, where the engine uses them. */
  protected generateCommentStatements(table: TableNode): string[] {
    if (this.features.commentSyntax !== 'statement') {
      return [];
    }
    const tableRef = this.dialect.escapeQualifiedId(table.name, table.schema);
    const statements = table.comment ? [`COMMENT ON TABLE ${tableRef} IS ${this.dialect.escape(table.comment)};`] : [];
    for (const col of table.columns.values()) {
      statements.push(...this.generateColumnCommentStatement(table.name, col, table.schema));
    }
    return statements;
  }

  /** The `COMMENT ON COLUMN` a column needs where the engine uses one, for `CREATE TABLE` and every path adding a column. */
  protected generateColumnCommentStatement(
    tableName: string,
    column: { name: string; comment?: string },
    schema?: string,
  ): string[] {
    if (!column.comment || this.features.commentSyntax !== 'statement') {
      return [];
    }
    const tableRef = this.dialect.escapeQualifiedId(tableName, schema);
    return [`COMMENT ON COLUMN ${tableRef}.${this.escapeId(column.name)} IS ${this.dialect.escape(column.comment)};`];
  }

  /**
   * How the entity differs from the table the database reported, compared by {@link diffTable}, the one
   * drift detection runs, with types normalized as the engine stores them.
   */
  diffSchema(
    entity: Type<object>,
    currentTable: TableNode | undefined,
    desiredAst?: SchemaAST,
    renamedColumns?: readonly Rename[],
  ): SchemaDiff | undefined {
    const meta = getMeta(entity);
    const tableName = this.resolveTableName(meta);
    const schema = this.resolveSchema(meta);

    if (!currentTable) {
      return { tableName, schema, type: 'create' };
    }

    // Keyed by the qualified name this generator resolves, which is the key the AST stores the table
    // under.
    const desired = (desiredAst ?? this.buildAST([entity])).getTable(tableName);
    if (!desired) {
      return undefined;
    }

    const tableDiff = diffTable(desired, currentTable, { ...this.diffOptions(), compareIndexes: false });
    const indexes = indexChanges(currentTable.name, desired.indexes, currentTable.indexes, currentTable.indexFacets);

    const columns = (tableDiff?.columns ?? []).map((it): ColumnChange => {
      if (it.from === undefined) {
        return { to: this.columnNodeToSchema(it.to) };
      }
      if (it.to === undefined) {
        return { from: this.columnNodeToSchema(it.from), isBreaking: true };
      }
      return { from: this.columnNodeToSchema(it.from), to: this.columnNodeToSchema(it.to), isBreaking: it.isBreaking };
    });

    const keyDiff = tableDiff?.primaryKey;
    // The key added named as this generator names it, so the rollback can drop it by that name.
    const primaryKey: Change<PrimaryKeySchema> | undefined = keyDiff && {
      from: keyDiff.from,
      to: keyDiff.to && { columns: keyDiff.to.columns, name: derivedPrimaryKeyName(tableName, keyDiff.to.columns) },
    };

    const foreignKeys = diffRelationshipNodes(desired.outgoingRelations, currentTable.outgoingRelations).map(
      ({ from, to }) => ({ from: from && foreignKeyOf(from), to: to && foreignKeyOf(to) }),
    );

    const alter: SchemaDiff = {
      tableName,
      schema,
      type: 'alter',
      primaryKey,
      columns: nonEmpty(columns),
      indexes: nonEmpty(
        indexes.changes.map(({ from, to }) => ({
          from: from && indexNodeToSchema(from),
          to: to && indexNodeToSchema(to),
        })),
      ),
      foreignKeys: nonEmpty(foreignKeys),
      checks: nonEmpty(tableDiff?.checks ?? []),
      // A kept trigger as both sides, which the alter cycles only where a column moves under it.
      triggers: nonEmpty([
        ...(tableDiff?.triggers ?? []),
        ...matchByKey(desired.triggers, currentTable.triggers, (it) => it.name).matched.map(([to, from]) => ({
          from,
          to,
        })),
      ]),
      renamedColumns: nonEmpty(renamedColumns ?? []),
    };
    if (!(tableDiff || alter.indexes || alter.foreignKeys || alter.renamedColumns)) {
      return undefined;
    }
    return this.features.rebuildsTables && needsRebuild(alter)
      ? { ...alter, rebuild: this.rebuildOf(desired, currentTable, indexes.kept, renamedColumns ?? []) }
      : alter;
  }

  /**
   * Both ends of rebuilding `actual` as `desired`. The new table is the entity's, keeping what it cannot
   * know of: the indexes, checks and triggers uql did not make, and foreign keys to tables no entity names.
   * The old one is the engine's own statements, so a rollback restores it exactly.
   */
  private rebuildOf(
    desired: TableNode,
    actual: TableNode,
    kept: readonly IndexNode[],
    renames: readonly Rename[],
  ): { from: RebuiltTable; to: RebuiltTable } {
    const definition = actual.definition ?? [];
    const read = new Set(actual.indexes.map((index) => index.name));
    const own = (entry: StoredDefinition) => entry.kind === 'trigger' && isOwnedName(entry.name);
    const stored = (table: TableNode) =>
      [...table.columns.values()].filter((column) => !column.generatedAs).map((column) => column.name);
    return {
      from: {
        statements: terminated(definition.filter((entry) => !own(entry)).map((entry) => entry.sql)),
        columns: stored(actual).map((name) => renames.find((rename) => rename.to === name)?.from ?? name),
      },
      to: {
        statements: [
          ...this.generateCreateTableFromNode({
            ...desired,
            checks: [...desired.checks, ...actual.checks.filter((check) => !isOwnedName(check.name))],
            externalForeignKeys: actual.externalForeignKeys,
          }),
          ...kept.map((index) => this.generateCreateIndexFromNode(index)),
          ...terminated(
            definition
              .filter(
                (entry) =>
                  (entry.kind === 'index' && !read.has(entry.name)) || (entry.kind === 'trigger' && !own(entry)),
              )
              .map((entry) => entry.sql),
          ),
        ],
        columns: stored(desired),
      },
    };
  }

  diffOptions(): DiffOptions {
    return {
      normalizeType: engineType(this.dialect),
      defaultsEqual: this.defaultsEqual,
    };
  }

  /** Converts a builder's column to the `ColumnSchema` its DDL is rendered from. */
  private definitionColumn(col: FullColumnDefinition): ColumnSchema {
    const column = bareColumn(col);
    return { ...column, type: this.columnSqlType(column) };
  }

  /** Spread, not copied field by field, so a field the node gains cannot go missing here. */
  private columnNodeToSchema(col: ColumnNode): ColumnSchema {
    const { table: _table, referencedBy: _referencedBy, references: _references, ...column } = col;
    return { ...column, type: this.columnSqlType(col) };
  }

  /** Whether a column's stored default is the one the entity declares, as this engine reprints it. */
  readonly defaultsEqual = (desired: unknown, current: unknown): boolean => sameDefault(desired, current, this.dialect);

  generateCreateTableFromNode(table: TableNode, options: { ifNotExists?: boolean } = {}): string[] {
    const columns: string[] = [];
    const constraints: string[] = [];

    for (const col of table.columns.values()) {
      columns.push(this.generateColumnFromNode(col));
    }

    // Every key, of any width, as one named constraint beside the checks and foreign keys - so a
    // later `DROP` has something to name. The exception is a dialect whose serial type states the key
    // itself (SQLite's `INTEGER PRIMARY KEY AUTOINCREMENT`, which cannot be split): there the column
    // has already declared it, and saying it again is a second primary key.
    const key = table.primaryKey;
    const declaredByColumn =
      this.dialect.features.serialDeclaresPrimaryKey &&
      key?.columns.length === 1 &&
      table.columns.get(key.columns[0])?.isAutoIncrement;
    if (key && !declaredByColumn) {
      const name = key.name ?? derivedPrimaryKeyName(table.name, key.columns);
      const columns = key.columns.map((column) => this.escapeId(column)).join(', ');
      constraints.push(`CONSTRAINT ${this.escapeId(name)} PRIMARY KEY (${columns})`);
    }

    constraints.push(...table.checks.map((check) => this.checkConstraint(check)));

    for (const rel of table.outgoingRelations) {
      const refTable = this.dialect.escapeQualifiedId(rel.to.table.name, rel.to.table.schema);
      constraints.push(this.foreignKeyConstraint(table.name, foreignKeyOf(rel), refTable));
    }
    for (const foreignKey of table.externalForeignKeys) {
      constraints.push(this.foreignKeyConstraint(table.name, foreignKey, this.escapeId(foreignKey.references.table)));
    }

    const target = this.dialect.escapeQualifiedId(table.name, table.schema);
    let createSql = `${this.tableDdl.createTable(target, !!options.ifNotExists)} (\n`;
    createSql += columns.map((col) => `  ${col}`).join(',\n');

    if (constraints.length > 0) {
      createSql += ',\n';
      createSql += constraints.map((c) => `  ${c}`).join(',\n');
    }

    createSql += '\n)';

    if (this.tableDdl.tableOptions) {
      createSql += ` ${this.tableDdl.tableOptions}`;
    }
    if (table.comment && this.features.commentSyntax === 'inline') {
      createSql += ` COMMENT=${this.dialect.escape(table.comment)}`;
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
    statements.push(...this.generateCommentStatements(table));
    // A table created only if missing creates its indexes the same way, or re-creating a schema fails on the first.
    const indexOptions = { ifNotExists: !!options.ifNotExists && this.features.indexIfNotExists };
    for (const idx of table.indexes) {
      statements.push(this.generateCreateIndexFromNode(idx, indexOptions));
    }
    return statements;
  }

  /**
   * Generate a column definition from a ColumnNode. The primary key is never inline: it is always a table
   * constraint, so a later `DROP` can name it.
   */
  protected generateColumnFromNode(col: ColumnNode): string {
    return this.renderColumn({ ...col, type: this.columnSqlType(col) });
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
    const tableNode = tableDefinitionToNode(table, (sql) => this.dialect.compileDdl(sql));
    return this.generateCreateTableFromNode(tableNode, options);
  }

  generateRenameTableSql(oldName: string, newName: string): string {
    return this.tableDdl.renameTable(oldName, newName);
  }

  /** `raw` is split, being the one SQL no generator wrote. */
  generateOperation(operation: AnyMigrationOperation): string[] {
    switch (operation.type) {
      case 'createTable':
        return this.generateCreateTableFromDefinition(operation.table);
      case 'dropTable':
        return [
          this.generateDropTable(operation.tableName, { ifExists: operation.ifExists, cascade: operation.cascade }),
        ];
      case 'renameTable':
        return [this.generateRenameTableSql(operation.oldName, operation.newName)];
      case 'addColumn':
        return this.generateAddColumnSql(operation.tableName, operation.column);
      case 'dropColumn':
        return this.generateDropColumnSql(operation.tableName, operation.columnName);
      case 'renameColumn':
        return [this.generateRenameColumnSql(operation.tableName, operation.oldName, operation.newName)];
      case 'alterColumn':
        return this.generateAlterColumnSql(operation.tableName, operation.columnName, operation.changes);
      case 'createIndex':
        return this.addIndexStatements(operation.tableName, [
          renderIndexDefinition(operation.index, (sql) => this.dialect.compileDdl(sql)),
        ]);
      case 'dropIndex':
        return [this.generateDropIndex(operation.tableName, operation.indexName)];
      case 'addForeignKey':
        return [this.generateAddForeignKeySql(operation.tableName, operation.foreignKey)];
      case 'dropForeignKey':
        return [this.generateDropForeignKeySql(operation.tableName, operation.constraintName)];
      case 'raw':
        return splitSqlStatements(operation.sql);
    }
  }

  /** `ADD COLUMN`, plus the foreign key and index the column declares, as `CREATE TABLE` lifts them. */
  generateAddColumnSql(tableName: string, column: FullColumnDefinition): string[] {
    const checks = enumCheck(splitQualifiedName(tableName).name, column, (sql) => this.dialect.compileDdl(sql));
    const statements = this.features.rebuildsTables
      ? this.addColumnStatements(tableName, this.definitionColumn(column), undefined, checks)
      : [
          ...this.addColumnStatements(tableName, this.definitionColumn(column)),
          ...checks.map((check) => this.addCheckSql(tableName, check)),
        ];

    const foreignKey = columnForeignKey(column);
    if (foreignKey) {
      statements.push(...this.addForeignKeyStatements(tableName, [foreignKey]));
    }
    const index = columnIndex(tableName, column);
    if (index) {
      statements.push(this.generateCreateIndex(tableName, index));
    }
    return statements;
  }

  generateAlterColumnSql(tableName: string, columnName: string, column: FullColumnDefinition): string[] {
    this.assertAlterable(`Altering the column "${columnName}" of "${tableName}"`);
    const schema = this.definitionColumn(column);
    return this.tableDdl.alterColumn(tableName, { ...schema, name: columnName }, this.renderColumn(schema));
  }

  generateDropColumnSql(tableName: string, columnName: string): string[] {
    return this.tableDdl.dropColumn(tableName, columnName);
  }

  generateRenameColumnSql(tableName: string, oldName: string, newName: string): string {
    return this.tableDdl.renameColumn(tableName, oldName, newName);
  }

  /**
   * `CONSTRAINT <name> FOREIGN KEY (...) REFERENCES ... ON DELETE ... ON UPDATE ...`.
   *
   * One spelling for the two places that need it - inline in a `CREATE TABLE`, and after `ADD` in an
   * `ALTER`. Written twice, the two drifted over which end they qualified with a schema.
   */
  protected foreignKeyConstraint(tableName: string, foreignKey: ForeignKeySchema, refTableSql: string): string {
    const fkCols = foreignKey.columns.map((c) => this.escapeId(c)).join(', ');
    const refCols = foreignKey.references.columns.map((c) => this.escapeId(c)).join(', ');
    return (
      `CONSTRAINT ${this.escapeId(constraintNameOf(tableName, foreignKey))} ` +
      `FOREIGN KEY (${fkCols}) REFERENCES ${refTableSql} (${refCols}) ` +
      `ON DELETE ${foreignKey.onDelete ?? this.defaultForeignKeyAction} ` +
      `ON UPDATE ${foreignKey.onUpdate ?? this.defaultForeignKeyAction}`
    );
  }

  generateAddForeignKeySql(tableName: string, foreignKey: ForeignKeySchema): string {
    this.assertAlterable(`Adding a foreign key to "${tableName}"`);
    const constraint = this.foreignKeyConstraint(tableName, foreignKey, this.escapeId(foreignKey.references.table));
    return `ALTER TABLE ${this.escapeId(tableName)} ADD ${constraint};`;
  }

  generateDropForeignKeySql(tableName: string, constraintName: string): string {
    return this.tableDdl.dropForeignKey(tableName, constraintName);
  }

  /**
   * `ALTER TABLE ... ADD CONSTRAINT <name> PRIMARY KEY (...)`, the other half of
   * {@link generateDropPrimaryKeySql}. Refused where the engine cannot alter a key at all, by name,
   * rather than emitting DDL it will reject.
   */
  generateAddPrimaryKeySql(tableName: string, columns: readonly string[], name?: string): string {
    this.assertAlterable(`Changing the primary key of "${tableName}"`);
    const constraintName = this.escapeId(name ?? derivedPrimaryKeyName(tableName, columns));
    const pkCols = columns.map((c) => this.escapeId(c)).join(', ');
    return `ALTER TABLE ${this.escapeId(tableName)} ADD CONSTRAINT ${constraintName} PRIMARY KEY (${pkCols});`;
  }

  /**
   * Drops the table's key, by the name the constraint really has: introspected, or derived where this
   * generator added it. MySQL takes no name.
   */
  generateDropPrimaryKeySql(tableName: string, constraintName?: string): string {
    this.assertAlterable(`Changing the primary key of "${tableName}"`);
    return this.tableDdl.dropPrimaryKey(tableName, constraintName);
  }

  /** A stored generated column, which an engine that rebuilds tables takes only in a `CREATE TABLE`. */
  private assertColumnAddable(tableName: string, column: { readonly name: string; readonly generatedAs?: string }) {
    if (column.generatedAs) {
      this.assertAlterable(`Adding the stored column "${column.name}" to "${tableName}"`);
    }
  }

  /**
   * Refuses `what` where the engine makes it only by rebuilding the table, which a migration generated
   * from the entities does and a lone statement of the builder cannot.
   */
  private assertAlterable(what: string): void {
    if (this.features.rebuildsTables) {
      throw rebuildRefusal(this.dialect, what);
    }
  }
}

/** Statements as a migration runs them, each ended. */
function terminated(statements: readonly string[]): string[] {
  return statements.map((sql) => `${sql};`);
}

/**
 * What a constraint is called: its own name, or one derived from its columns where nothing named it.
 * Shared by the add and the drop so a `DROP CONSTRAINT` names exactly what an `ADD CONSTRAINT` made.
 */
export function constraintNameOf(tableName: string, foreignKey: ForeignKeySchema): string {
  return foreignKey.name ?? derivedForeignKeyName(tableName, foreignKey.columns);
}

/**
 * A relationship node as the migration's own `ForeignKeySchema`. The node's `name` is kept rather
 * than derived: on the database's side it is the only name a `DROP` can use, and on the entity's it
 * is already the derived one. An unset action stays unset - the default belongs to the one place
 * that spends it, `addForeignKeyStatements`.
 */
function foreignKeyOf(relation: RelationshipNode): ForeignKeySchema {
  return {
    name: relation.name,
    columns: relation.from.columns.map((column) => column.name),
    references: {
      table: qualifyName(relation.to.table.name, relation.to.table.schema),
      columns: relation.to.columns.map((column) => column.name),
    },
    onDelete: relation.onDelete,
    onUpdate: relation.onUpdate,
  };
}

/**
 * The entities as an AST, named by `generator`'s resolvers rather than a naming strategy, which would
 * also rename an explicit `@Entity({ name })` and so compare each table under another name.
 */
export function buildEntityAST(
  generator: Pick<
    SchemaGenerator,
    'resolveTableAlias' | 'resolveSchema' | 'resolveColumnName' | 'compileDdl' | 'compileIndexPredicate'
  >,
  entities: readonly Type<object>[],
  options: Pick<
    BuildSchemaASTOptions,
    'defaultForeignKeyAction' | 'textScoreIndexes' | 'vectorIndexRequiresNotNull' | 'renderTriggers'
  > = {},
): SchemaAST {
  return buildSchemaAST(entities, {
    // The alias, not `resolveTableName`: a node holds its schema separately, so that a name derived
    // from it stays a single identifier.
    resolveTableName: (meta) => generator.resolveTableAlias(meta),
    resolveSchema: (meta) => generator.resolveSchema(meta),
    resolveColumnName: (key, field) => generator.resolveColumnName(key, field),
    compileDdl: (sql, entity) => generator.compileDdl(sql, entity),
    compileIndexPredicate: (where, entity, indexName) => generator.compileIndexPredicate(where, entity, indexName),
    ...options,
  });
}
