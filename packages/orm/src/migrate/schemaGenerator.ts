import type { AbstractSqlDialect } from '../dialect/index.js';
import { getMeta } from '../entity/index.js';
import { canonicalToSql, engineType, isVectorCategory } from '../schema/canonicalType.js';
import { indexChanges } from '../schema/indexDifferences.js';
import { matchByKey } from '../schema/matchByKey.js';
import type { SchemaAST } from '../schema/schemaAST.js';
import { buildSchemaAST } from '../schema/schemaASTBuilder.js';
import { type DiffOptions, diffRelationshipNodes, diffTable } from '../schema/schemaASTDiffer.js';
import {
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
  ForeignKeySchema,
  IndexSchema,
  PrimaryKeySchema,
  RebuiltTable,
  Rename,
  StoredDefinition,
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
import { rebuildRefusal } from './ddl/tableDdl.js';
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

/** The SQL schema generator, one for every SQL engine, its spellings taken from the dialect and its DDL classes. */
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

  private get features(): DialectFeatures {
    return this.dialect.features;
  }

  /** Escape an identifier (table name, column name, etc.) */
  private escapeId(identifier: string): string {
    return this.dialect.escapeId(identifier);
  }

  /**
   * The SQL type a column is spelled with: its canonical type, plus the engine's generated suffix on an
   * auto-increment key, so a foreign key taking its type from the key gets the same one.
   */
  private columnSqlType(col: Pick<ColumnNode, 'type' | 'isPrimaryKey' | 'isAutoIncrement'>): string {
    const type = canonicalToSql(col.type, this.dialect);
    return col.isPrimaryKey && col.isAutoIncrement ? `${type} ${this.dialect.autoIncrementSuffix}` : type;
  }

  /**
   * The entity side as an AST, carrying this generator's default referential action. Named by the dialect's
   * resolvers rather than a naming strategy, which would also rename an explicit `@Entity({ name })`.
   */
  buildAST(entities: readonly Type<object>[]): SchemaAST {
    const { dialect } = this;
    return buildSchemaAST(entities, {
      // The alias, not `resolveTableName`: a node holds its schema apart, so a name derived from it is one identifier.
      resolveTableName: (meta) => dialect.resolveTableAlias(meta),
      resolveSchema: (meta) => dialect.resolveSchema(meta),
      resolveColumnName: (key, field) => dialect.resolveColumnName(key, field),
      compileDdl: (sql, entity) => dialect.compileDdl(sql, entity),
      compileIndexPredicate: (where, entity, indexName) => {
        assertIndexPredicate(where, dialect.dialectName, indexName);
        return dialect.compileDdl(where, entity);
      },
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
    // Inline only where a constraint cannot be added afterwards, which is what makes the cyclic case work elsewhere.
    const inline = this.features.rebuildsTables;
    return [
      // Namespaces first: a qualified `CREATE TABLE` fails against a schema nobody created.
      ...this.createNamespaces(tables),
      ...tables.flatMap((table) =>
        this.generateCreateTableFromNode(inline ? table : { ...table, outgoingRelations: [] }, options),
      ),
      ...(inline
        ? []
        : tables.flatMap((table) =>
            table.outgoingRelations.map((relation) =>
              this.addForeignKeySql(qualifyName(table.name, table.schema), foreignKeyOf(relation)),
            ),
          )),
      // Triggers last: each needs its own table, and a body may read any other the same schema just made.
      ...terminated(tables.flatMap((table) => table.triggers.flatMap((trigger) => trigger.statements))),
    ];
  }

  /**
   * One statement per distinct schema the tables being created live in, in first-seen order. Only
   * the tables actually being created, so a narrowed `only` does not declare namespaces it is not
   * about to fill. Empty on an engine without schemas, whose tables are never qualified.
   */
  private createNamespaces(tables: readonly TableNode[]): string[] {
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
      return names.map((name) => this.tableDdl.dropForeignKey(tableName, name));
    });
    return [
      ...foreignKeyDrops,
      ...tables.flatMap((table) => {
        const name = qualifyName(table.name, table.schema);
        // A table the database lacks left no function: CockroachDB refuses one named in a schema not made yet.
        const triggers = options.existing && !options.existing.getTable(name) ? [] : table.triggers;
        return [
          this.dropTableSql(name, options),
          ...terminated(triggers.flatMap((trigger) => dropTriggerBody(this.dialect, table.schema, trigger.name))),
        ];
      }),
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

  private dropTableSql(tableName: string, options: DropSchemaOptions = {}): string {
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
    const { tableName, primaryKey, columns, rebuild } = diff;
    const fills = this.defaultFills(columns);
    const moved = Boolean(rebuild || diff.renamedColumns?.length || sides(columns, 'from').length);
    const triggers = (diff.triggers ?? []).filter(({ from, to }) => moved || !from || !to);
    const triggerDrops = terminated(
      sides(triggers, 'from').flatMap((trigger) => dropTrigger(this.dialect, tableName, trigger.name)),
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
    const [dropKey, addKey] = this.tableDdl.replacePrimaryKey(tableName, primaryKey?.from, primaryKey?.to);
    return [
      ...triggerDrops,
      ...sides(diff.foreignKeys, 'from').map((foreignKey) =>
        this.tableDdl.dropForeignKey(tableName, constraintNameOf(tableName, foreignKey)),
      ),
      ...dropKey,
      ...sides(diff.indexes, 'from').map((index) => this.tableDdl.dropIndex(tableName, index.name)),
      ...sides(diff.checks, 'from').map((check) => this.dropCheckSql(tableName, check)),
      ...(diff.renamedColumns ?? []).map(({ from, to }) => this.tableDdl.renameColumn(tableName, from, to)),
      ...added(columns).flatMap((column) => this.addColumnStatements(tableName, column)),
      ...[...fills].map(([column, value]) => {
        const name = this.escapeId(column);
        return `UPDATE ${target} SET ${name} = ${value} WHERE ${name} IS NULL;`;
      }),
      ...this.tableDdl.alterColumns(tableName, alterations(columns)),
      ...addKey,
      ...dropped(columns).flatMap((column) => this.tableDdl.dropColumn(tableName, column.name)),
      ...this.addIndexStatements(tableName, sides(diff.indexes, 'to')),
      ...sides(diff.foreignKeys, 'to').map((foreignKey) => this.addForeignKeySql(tableName, foreignKey)),
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

  /** An index added to a table that may already have rows: its `CREATE`, then what the engine needs after. */
  private addIndexStatements(tableName: string, indexes: readonly IndexSchema[]): string[] {
    return indexes.flatMap((index) => [
      this.indexDdl.getCreateIndexStatement(tableName, index),
      ...this.indexDdl.settleStatements(tableName, index),
    ]);
  }

  /**
   * A column added to a table that exists. `checks` go inline, which is the one way to constrain a table that is
   * rebuilt to alter; a stored generated column, an engine that rebuilds tables takes only in a `CREATE TABLE`.
   */
  private addColumnStatements(tableName: string, column: ColumnSchema, checks: readonly CheckSchema[] = []): string[] {
    if (column.generatedAs) {
      this.assertAlterable(`Adding the stored column "${column.name}" to "${tableName}"`);
    }
    const inline = checks.map((check) => ` ${this.checkConstraint(check)}`).join('');
    return this.tableDdl.addColumnStatements(tableName, column, inline);
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
    const tableName = this.dialect.resolveTableName(meta);

    if (!currentTable) {
      return { tableName, type: 'create' };
    }

    // Keyed by the qualified name this generator resolves, which is the key the AST stores the table
    // under.
    const desired = (desiredAst ?? this.buildAST([entity])).getTable(tableName);
    if (!desired) {
      return undefined;
    }

    const tableDiff = diffTable(desired, currentTable, this.diffOptions());
    const indexes = indexChanges(currentTable.name, desired.indexes, currentTable.indexes, currentTable.indexFacets);

    const columns = (tableDiff?.columns ?? []).map(({ from, to, isBreaking }): ColumnChange => ({
      from: from && this.columnNodeToSchema(from),
      to: to && this.columnNodeToSchema(to),
      isBreaking,
    }));

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
          ...kept.map((index) => this.createIndexFromNode(index)),
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
    const { table: _table, ...column } = col;
    return { ...column, type: this.columnSqlType(col) };
  }

  /** Whether a column's stored default is the one the entity declares, as this engine reprints it. */
  readonly defaultsEqual = (desired: unknown, current: unknown): boolean => sameDefault(desired, current, this.dialect);

  generateCreateTableFromNode(table: TableNode, options: { ifNotExists?: boolean } = {}): string[] {
    // Every key, of any width, as one named constraint, so a later `DROP` has something to name. Except where
    // the serial type states the key itself (SQLite's `INTEGER PRIMARY KEY AUTOINCREMENT`): a second one there.
    const key = table.primaryKey;
    const declaredByColumn =
      this.dialect.features.serialDeclaresPrimaryKey &&
      key?.columns.length === 1 &&
      table.columns.get(key.columns[0])?.isAutoIncrement;
    const definitions = [
      ...[...table.columns.values()].map((column) => this.tableDdl.columnDefinition(this.columnNodeToSchema(column))),
      ...(key && !declaredByColumn ? [this.tableDdl.primaryKeyConstraint(table.name, key)] : []),
      ...table.checks.map((check) => this.checkConstraint(check)),
      ...table.outgoingRelations.map((relation) =>
        this.foreignKeyConstraint(
          table.name,
          foreignKeyOf(relation),
          this.dialect.escapeQualifiedId(relation.to.table.name, relation.to.table.schema),
        ),
      ),
      ...table.externalForeignKeys.map((foreignKey) =>
        this.foreignKeyConstraint(table.name, foreignKey, this.escapeId(foreignKey.references.table)),
      ),
    ];
    const target = this.dialect.escapeQualifiedId(table.name, table.schema);
    const body = definitions.map((definition) => `  ${definition}`).join(',\n');
    const vector =
      this.dialect.vectorExtension &&
      [...table.columns.values()].some((column) => isVectorCategory(column.type.category));
    // A table created only if missing creates its indexes the same way, or re-creating a schema fails on the first.
    const indexOptions = { ifNotExists: !!options.ifNotExists && this.features.indexIfNotExists };
    return [
      ...(vector ? [`CREATE EXTENSION IF NOT EXISTS ${this.dialect.vectorExtension};`] : []),
      `${this.tableDdl.createTable(target, !!options.ifNotExists)} (\n${body}\n)${this.tableDdl.tableSuffix(table.comment)};`,
      ...this.tableDdl.commentStatements(qualifyName(table.name, table.schema), table.comment, [
        ...table.columns.values(),
      ]),
      ...table.indexes.map((index) => this.createIndexFromNode(index, indexOptions)),
    ];
  }

  /** The `CREATE INDEX` for an index of the AST. */
  private createIndexFromNode(index: IndexNode, options: { ifNotExists: boolean } = { ifNotExists: false }): string {
    // The index's own name stays unqualified: it is created in the schema of the table it is on.
    return this.indexDdl.getCreateIndexStatement(
      qualifyName(index.table.name, index.table.schema),
      indexNodeToSchema(index),
      options,
    );
  }

  generateCreateTableFromDefinition(table: TableDefinition, options: { ifNotExists?: boolean } = {}): string[] {
    const tableNode = tableDefinitionToNode(table, (sql) => this.dialect.compileDdl(sql));
    return this.generateCreateTableFromNode(tableNode, options);
  }

  /** `raw` is split, being the one SQL no generator wrote. */
  generateOperation(operation: AnyMigrationOperation): string[] {
    switch (operation.type) {
      case 'createTable':
        return this.generateCreateTableFromDefinition(operation.table);
      case 'dropTable':
        return [this.dropTableSql(operation.tableName, { ifExists: operation.ifExists, cascade: operation.cascade })];
      case 'renameTable':
        return [this.tableDdl.renameTable(operation.oldName, operation.newName)];
      case 'addColumn':
        return this.addColumnSql(operation.tableName, operation.column);
      case 'dropColumn':
        return this.tableDdl.dropColumn(operation.tableName, operation.columnName);
      case 'renameColumn':
        return [this.tableDdl.renameColumn(operation.tableName, operation.oldName, operation.newName)];
      case 'alterColumn':
        this.assertAlterable(`Altering the column "${operation.changes.name}" of "${operation.tableName}"`);
        return this.tableDdl.alterColumns(operation.tableName, [{ to: this.definitionColumn(operation.changes) }]);
      case 'createIndex':
        return this.addIndexStatements(operation.tableName, [
          renderIndexDefinition(operation.index, (sql) => this.dialect.compileDdl(sql)),
        ]);
      case 'dropIndex':
        return [this.tableDdl.dropIndex(operation.tableName, operation.indexName)];
      case 'addForeignKey':
        return [this.addForeignKeySql(operation.tableName, operation.foreignKey)];
      case 'dropForeignKey':
        return [this.tableDdl.dropForeignKey(operation.tableName, operation.constraintName)];
      case 'raw':
        return splitSqlStatements(operation.sql);
    }
  }

  /** `ADD COLUMN`, plus the foreign key and index the column declares, as `CREATE TABLE` lifts them. */
  private addColumnSql(tableName: string, column: FullColumnDefinition): string[] {
    const checks = enumCheck(splitQualifiedName(tableName).name, column, (sql) => this.dialect.compileDdl(sql));
    const statements = this.features.rebuildsTables
      ? this.addColumnStatements(tableName, this.definitionColumn(column), checks)
      : [
          ...this.addColumnStatements(tableName, this.definitionColumn(column)),
          ...checks.map((check) => this.addCheckSql(tableName, check)),
        ];

    const foreignKey = columnForeignKey(column);
    if (foreignKey) {
      statements.push(this.addForeignKeySql(tableName, foreignKey));
    }
    const index = columnIndex(tableName, column);
    if (index) {
      statements.push(this.indexDdl.getCreateIndexStatement(tableName, index));
    }
    return statements;
  }

  /**
   * `CONSTRAINT <name> FOREIGN KEY (...) REFERENCES ... ON DELETE ... ON UPDATE ...`.
   *
   * One spelling for the two places that need it - inline in a `CREATE TABLE`, and after `ADD` in an
   * `ALTER`. Written twice, the two drifted over which end they qualified with a schema.
   */
  private foreignKeyConstraint(tableName: string, foreignKey: ForeignKeySchema, refTableSql: string): string {
    const fkCols = foreignKey.columns.map((c) => this.escapeId(c)).join(', ');
    const refCols = foreignKey.references.columns.map((c) => this.escapeId(c)).join(', ');
    return (
      `CONSTRAINT ${this.escapeId(constraintNameOf(tableName, foreignKey))} ` +
      `FOREIGN KEY (${fkCols}) REFERENCES ${refTableSql} (${refCols}) ` +
      `ON DELETE ${foreignKey.onDelete ?? this.defaultForeignKeyAction} ` +
      `ON UPDATE ${foreignKey.onUpdate ?? this.defaultForeignKeyAction}`
    );
  }

  private addForeignKeySql(tableName: string, foreignKey: ForeignKeySchema): string {
    this.assertAlterable(`Adding a foreign key to "${tableName}"`);
    const constraint = this.foreignKeyConstraint(tableName, foreignKey, this.escapeId(foreignKey.references.table));
    return `ALTER TABLE ${this.escapeId(tableName)} ADD ${constraint};`;
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
 * is already the derived one. An unset action stays unset: the default belongs to the one place
 * that spends it, `foreignKeyConstraint`.
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
