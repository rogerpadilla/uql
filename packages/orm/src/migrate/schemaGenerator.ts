import type { AbstractSqlDialect } from '../dialect/index.js';
import { getMeta } from '../entity/index.js';
import { canonicalToSql, engineType, isVectorCategory, resolveColumnCanonicalType } from '../schema/canonicalType.js';
import { indexChanges } from '../schema/indexDifferences.js';
import type { SchemaAST } from '../schema/schemaAST.js';
import { type BuildSchemaASTOptions, buildSchemaAST } from '../schema/schemaASTBuilder.js';
import { type DiffOptions, diffRelationshipNodes, diffTable } from '../schema/schemaASTDiffer.js';
import type {
  CanonicalType,
  ColumnNode,
  EnumValues,
  ForeignKeyAction,
  IndexNode,
  RelationshipNode,
  TableNode,
} from '../schema/types.js';
import type {
  ColumnSchema,
  CreateSchemaOptions,
  DialectFeatures,
  DropSchemaOptions,
  EntityMeta,
  InstalledTriggers,
  EntityWhereMeta,
  FieldMeta,
  FieldOptions,
  ForeignKeySchema,
  IndexSchema,
  NamingStrategy,
  SchemaDiff,
  SchemaGenerator,
  Type,
} from '../type/index.js';
import { isAutoIncrement, qualifyName } from '../util/index.js';
import { derivedCheckName, derivedForeignKeyName, derivedPrimaryKeyName, isOwnedName } from '../util/sql.util.js';
import { formatDefaultValue, SqlExpression } from './builder/expressions.js';
import { splitSqlStatements } from './builder/splitSqlStatements.js';
import type { AnyMigrationOperation, FullColumnDefinition, IndexDefinition, TableDefinition } from './builder/types.js';
import { type IndexDdl, indexDdlFor, type TableDdl, tableDdlFor } from './ddl/index.js';
import { sizedType } from './ddl/tableDdl.js';
import {
  columnForeignKey,
  columnIndex,
  fullColumnDefinitionToNode,
  renderIndexDefinition,
  tableDefinitionToNode,
} from './generator/definitionToNode.js';
import { indexNodeToSchema } from './generator/indexNodeToSchema.js';
import { assertIndexPredicate } from './indexPredicate.js';
import { dropTrigger, type RenderedTrigger, renderTrigger, stampTriggers } from './triggerSql.js';

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
    protected readonly defaultForeignKeyAction: ForeignKeyAction = 'NO ACTION',
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
  protected columnSqlType(col: ColumnNode): string {
    return col.isPrimaryKey && col.isAutoIncrement ? this.serialType(col.type) : this.canonicalTypeToSql(col.type);
  }

  protected canonicalTypeToSql(type: CanonicalType): string {
    return canonicalToSql(type, this.dialect);
  }

  /** The entity side as an AST, carrying this generator's default referential action. */
  buildAST(entities: readonly Type<object>[]): SchemaAST {
    return buildEntityAST(this, entities, {
      defaultForeignKeyAction: this.defaultForeignKeyAction,
      textScoreIndexes: this.dialect.features.textScoreIndexes,
    });
  }

  /**
   * Every `CREATE TABLE` for `entities`, then their foreign keys, since a relation graph is routinely
   * cyclic. SQLite keeps them inline: it cannot add one later, and resolves a forward reference lazily.
   */
  generateCreateSchema(entities: readonly Type<object>[], options: CreateSchemaOptions = {}): string[] {
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
        statements.push(
          ...this.addForeignKeyStatements(
            qualifyName(table.name, table.schema),
            table.outgoingRelations.map(foreignKeyOf),
          ),
        );
      }
    }

    // Triggers last: each needs its own table, and a body may read any other the same schema just made.
    const made = new Set(tables.map((table) => qualifyName(table.name, table.schema)));
    statements.push(
      ...entities
        .filter((entity) => made.has(this.resolveTableName(getMeta(entity))))
        .flatMap((entity) => this.generateTriggers(entity)),
    );

    return statements;
  }

  /**
   * The installed triggers on `entity`'s table it does not declare, and the declared ones not installed,
   * compared by name alone: a name carries a hash of the trigger's SQL, so an edited one is a new name.
   * Every trigger counts - the ones it authored, and one per event each stamp names.
   */
  private triggerChanges(entity: Type<object>, installed: InstalledTriggers) {
    const meta = getMeta(entity);
    const triggers = [...(meta.triggers ?? []), ...stampTriggers(this.dialect, meta)];
    const rendered = triggers.map((trigger, i) => renderTrigger(this.dialect, meta, trigger, i));
    const declared = new Set(rendered.map((trigger) => trigger.name));
    return {
      stale: [...installed]
        .filter(([name]) => isOwnedName(name) && !declared.has(name))
        .map(([name, statements]): RenderedTrigger => ({ name, statements })),
      missing: rendered.filter((trigger) => !installed.has(trigger.name)),
    };
  }

  generateTriggers(entity: Type<object>, installed: InstalledTriggers = new Map()): string[] {
    const { stale, missing } = this.triggerChanges(entity, installed);
    return this.swapTriggers(entity, stale, missing);
  }

  generateTriggersDown(entity: Type<object>, installed: InstalledTriggers = new Map()): string[] {
    const { stale, missing } = this.triggerChanges(entity, installed);
    return this.swapTriggers(entity, missing, stale);
  }

  /** `dropped` taken off `entity`'s table and `created` put on, which is a reconcile read either way. */
  private swapTriggers(
    entity: Type<object>,
    dropped: readonly RenderedTrigger[],
    created: readonly RenderedTrigger[],
  ): string[] {
    return [
      ...this.generateTriggerDrops(
        entity,
        dropped.map((trigger) => trigger.name),
      ),
      ...created.flatMap((trigger) => trigger.statements.map((sql) => `${sql};`)),
    ];
  }

  generateTriggerDrops(entity: Type<object>, names: readonly string[]): string[] {
    const meta = getMeta(entity);
    return names.filter(isOwnedName).flatMap((name) => dropTrigger(this.dialect, meta, name).map((sql) => `${sql};`));
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

  generateDropSchema(entities: readonly Type<object>[], options: DropSchemaOptions = {}): string[] {
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

  generateAlterTable(diff: SchemaDiff): string[] {
    const statements: string[] = [];

    // Before the columns, because a key column being added cannot be part of the old key, and after
    // it is dropped the table is free to take the new one below.
    if (diff.primaryKey?.from.length) {
      statements.push(this.generateDropPrimaryKeySql(diff.tableName, diff.primaryKey.fromName));
    }

    // Before the columns: a constraint holds its columns down, so one the entity dropped cannot go
    // while a foreign key still names it. An alter is a drop and an add, and this is its drop half.
    statements.push(
      ...this.dropForeignKeyStatements(diff.tableName, [
        ...(diff.foreignKeysToDrop ?? []),
        ...(diff.foreignKeysToAlter ?? []).map((it) => constraintNameOf(diff.tableName, it.from)),
      ]),
    );

    // Before the adds, which may reuse a dropped index's name, and before the columns: some engines
    // drop an index along with its column, which would leave nothing here to name.
    statements.push(...this.dropIndexStatements(diff.tableName, diff.indexesToDrop, diff.schema));

    for (const column of diff.columnsToAdd ?? []) {
      this.assertColumnAddable(diff.tableName, column);
      statements.push(this.tableDdl.addColumn(diff.tableName, this.generateColumnDefinitionFromSchema(column)));
      statements.push(...this.generateColumnCommentStatement(diff.tableName, column, diff.schema));
    }
    statements.push(
      ...this.alterColumnStatements(
        diff.tableName,
        (diff.columnsToAlter ?? []).map((it) => it.to),
      ),
    );
    for (const columnName of diff.columnsToDrop ?? []) {
      statements.push(...this.tableDdl.dropColumn(diff.tableName, columnName));
    }

    statements.push(...this.addIndexStatements(diff.tableName, diff.indexesToAdd));

    // Last, so every column it names exists by now.
    if (diff.primaryKey?.to.length) {
      statements.push(this.generateAddPrimaryKeySql(diff.tableName, diff.primaryKey.to));
    }

    // After the columns, for the same reason the key is: a constraint cannot name one that is not
    // there yet. The add half of an alter rides along, its drop having gone out above.
    statements.push(
      ...this.addForeignKeyStatements(diff.tableName, [
        ...(diff.foreignKeysToAdd ?? []),
        ...(diff.foreignKeysToAlter ?? []).map((it) => it.to),
      ]),
    );

    return statements;
  }

  /** `ADD CONSTRAINT` for each of `foreignKeys`. */
  private addForeignKeyStatements(tableName: string, foreignKeys: readonly ForeignKeySchema[]): string[] {
    return foreignKeys.map((foreignKey) => this.generateAddForeignKeySql(tableName, foreignKey));
  }

  /** `DROP CONSTRAINT` for each of `constraintNames`, the mirror of {@link addForeignKeyStatements}. */
  private dropForeignKeyStatements(tableName: string, constraintNames: readonly string[]): string[] {
    return constraintNames.map((name) => this.generateDropForeignKeySql(tableName, name));
  }

  /** The `ALTER COLUMN` restating each of `columns`. */
  private alterColumnStatements(tableName: string, columns: readonly ColumnSchema[]): string[] {
    return columns.flatMap((column) =>
      this.generateAlterColumnStatements(tableName, column, this.generateColumnDefinitionFromSchema(column)),
    );
  }

  /** An index added to a table that may already have rows: its `CREATE`, then what the engine needs after. */
  private addIndexStatements(tableName: string, indexes: readonly IndexSchema[] = []): string[] {
    return indexes.flatMap((index) => [
      this.generateCreateIndex(tableName, index),
      ...this.indexDdl.settleStatements(tableName, index),
    ]);
  }

  /** `DROP INDEX` for each of `indexes`, the mirror of {@link addIndexStatements}. */
  private dropIndexStatements(tableName: string, indexes: readonly IndexSchema[] = [], schema?: string): string[] {
    return indexes.map((index) => this.generateDropIndex(tableName, index.name, schema));
  }

  generateAlterTableDown(diff: SchemaDiff): string[] {
    const statements: string[] = [];

    // Constraints first, mirroring the up direction: the up added them last, so the down drops them
    // first, and a column it is about to drop is then free of anything naming it.
    statements.push(
      ...this.dropForeignKeyStatements(diff.tableName, [
        ...(diff.foreignKeysToAdd ?? []).map((it) => constraintNameOf(diff.tableName, it)),
        ...(diff.foreignKeysToAlter ?? []).map((it) => constraintNameOf(diff.tableName, it.to)),
      ]),
    );

    // The key next, for the same reason: a column the up added cannot be dropped below while the new
    // key still names it. Restored under the name the database gave it, which is what the table had
    // before, rather than a derived one that was never on it.
    if (diff.primaryKey?.to.length) {
      statements.push(
        this.generateDropPrimaryKeySql(diff.tableName, derivedPrimaryKeyName(diff.tableName, diff.primaryKey.to)),
      );
    }

    for (const column of diff.columnsToAdd ?? []) {
      statements.push(...this.tableDdl.dropColumn(diff.tableName, column.name));
    }
    statements.push(
      ...this.alterColumnStatements(
        diff.tableName,
        (diff.columnsToAlter ?? []).map((it) => it.from),
      ),
    );

    statements.push(...this.dropIndexStatements(diff.tableName, diff.indexesToAdd, diff.schema));
    statements.push(...this.addIndexStatements(diff.tableName, diff.indexesToDrop));

    if (diff.primaryKey?.from.length) {
      statements.push(this.generateAddPrimaryKeySql(diff.tableName, diff.primaryKey.from, diff.primaryKey.fromName));
    }

    // The constraint the up replaced, back under the name the database had for it. A foreign key the
    // up *dropped* is not restored: only its name survived the diff, never what it pointed at.
    statements.push(
      ...this.addForeignKeyStatements(
        diff.tableName,
        (diff.foreignKeysToAlter ?? []).map((it) => it.from),
      ),
    );

    if (diff.columnsToDrop?.length || diff.foreignKeysToDrop?.length) {
      statements.push(`-- TODO: Manual reversal needed for dropped columns/foreign keys`);
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
   * A column definition from a {@link ColumnSchema}, whose type is already the engine's spelling. Apart from
   * {@link generateColumnFromNode}, which alone knows an `enum`; both render through {@link renderColumn}.
   */
  public generateColumnDefinitionFromSchema(column: ColumnSchema): string {
    return this.renderColumn({ ...column, type: sizedType(column) });
  }

  /**
   * The one place a column definition is spelled, so the `ColumnSchema` and `ColumnNode` paths cannot
   * drift. A key column states `NOT NULL` rather than leave it to the key: SQLite lets a key column hold
   * NULL otherwise, and SQL Server adds no key over a nullable column. `UNIQUE` is left to the key. An
   * enum's `CHECK` comes last, the only place MariaDB takes it.
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
    generatedAs?: string;
  }): string {
    const type = column.generatedAs
      ? this.tableDdl.storedGeneratedColumn(column.type, column.generatedAs)
      : column.type;
    let def = `${this.escapeId(column.name)} ${type}`;

    if (!column.nullable) {
      def += ' NOT NULL';
    }
    if (column.isUnique && !column.isPrimaryKey) {
      def += ' UNIQUE';
    }
    def += this.tableDdl.defaultClause(column);
    if (column.comment) {
      def += this.generateColumnComment(column.comment);
    }
    if (column.enum?.length) {
      const values = column.enum.map((value) => this.dialect.escape(value)).join(', ');
      def += ` CHECK (${this.escapeId(column.name)} IN (${values}))`;
    }

    return def;
  }

  /**
   * The column type a field gets, resolved as its table resolves it. A field alone cannot tell that it is
   * one column of a composite key, which its table never makes serial.
   */
  public getSqlType(field: FieldMeta): string {
    const canonical = resolveColumnCanonicalType(field);
    return isAutoIncrement(field, field.isId === true)
      ? this.serialType(canonical)
      : this.canonicalTypeToSql(canonical);
  }

  /** The statements that alter `column` in place, as this dialect spells them. */
  public generateAlterColumnStatements(tableName: string, column: ColumnSchema, newDefinition: string): string[] {
    return this.tableDdl.alterColumn(tableName, column, newDefinition);
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

    // Indexes are matched here rather than by the differ, which pairs them by name so that a changed
    // one reads as one index that altered. A migration needs the opposite: an index already in the
    // table, under whatever name, must not be created again, and one whose shape differs is dropped
    // and created anew - no engine alters an index's columns or uniqueness.
    const tableDiff = diffTable(desired, currentTable, { ...this.diffOptions(), compareIndexes: false });
    const indexes = indexChanges(currentTable.name, desired.indexes, currentTable.indexes);
    const indexesToAdd = indexes.toAdd.map(indexNodeToSchema);
    const indexesToDrop = indexes.toDrop.map(indexNodeToSchema);

    const columnDiffs = tableDiff?.columnDiffs ?? [];
    const columnsToAdd = columnDiffs.flatMap((it) => (it.type === 'add' ? [this.columnNodeToSchema(it.expected)] : []));
    const columnsToDrop = columnDiffs.flatMap((it) => (it.type === 'drop' ? [it.column] : []));
    // Without its values: an alter restates the whole column, and MySQL answers a restated `CHECK` by
    // adding a *second* constraint rather than replacing the first, so the column would accumulate one
    // per alter. An enum's values reach the database with the column and are never restated - which is
    // also why changing them is a hand-written migration. See architecture/roadmap.md.
    const columnsToAlter = columnDiffs.flatMap((it) =>
      it.type === 'alter'
        ? [
            {
              from: this.columnNodeToSchema(it.actual),
              to: { ...this.columnNodeToSchema(it.expected), enum: undefined },
            },
          ]
        : [],
    );
    const primaryKey = tableDiff?.primaryKeyDiff && {
      from: tableDiff.primaryKeyDiff.actual,
      to: tableDiff.primaryKeyDiff.expected,
      fromName: tableDiff.primaryKeyDiff.actualName,
    };

    // This table's own foreign keys. None where the engine cannot alter one (SQLite, short of rebuilding
    // the table), since a difference nothing can apply would throw on every sync; `drift:check` names it.
    const relationDiffs = this.features.foreignKeyAlter
      ? diffRelationshipNodes(desired.outgoingRelations, currentTable.outgoingRelations, this.diffOptions())
      : [];
    const foreignKeysToAdd = relationDiffs.flatMap((it) => (it.type === 'create' ? [foreignKeyOf(it.expected)] : []));
    const foreignKeysToDrop = relationDiffs.flatMap((it) => (it.type === 'drop' ? [it.name] : []));
    const foreignKeysToAlter = relationDiffs.flatMap((it) =>
      it.type === 'alter' ? [{ from: foreignKeyOf(it.actual), to: foreignKeyOf(it.expected) }] : [],
    );

    if (
      !columnsToAdd.length &&
      !columnsToAlter.length &&
      !columnsToDrop.length &&
      !indexesToAdd.length &&
      !indexesToDrop.length &&
      !foreignKeysToAdd.length &&
      !foreignKeysToDrop.length &&
      !foreignKeysToAlter.length &&
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
      indexesToDrop: indexesToDrop.length ? indexesToDrop : undefined,
      foreignKeysToAdd: foreignKeysToAdd.length ? foreignKeysToAdd : undefined,
      foreignKeysToDrop: foreignKeysToDrop.length ? foreignKeysToDrop : undefined,
      foreignKeysToAlter: foreignKeysToAlter.length ? foreignKeysToAlter : undefined,
    };
  }

  protected diffOptions(): DiffOptions {
    return {
      normalizeType: engineType(this.dialect),
      defaultsEqual: (expected, actual) => this.isDefaultValueEqual(actual, expected),
    };
  }

  /** Spread, not copied field by field, so a field the node gains cannot go missing here. */
  private columnNodeToSchema(col: ColumnNode): ColumnSchema {
    const { table: _table, referencedBy: _referencedBy, references: _references, ...column } = col;
    return { ...column, type: this.columnSqlType(col) };
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
      this.dialect.features.serialDeclaresPrimaryKey &&
      table.primaryKey.length === 1 &&
      table.primaryKey[0].isAutoIncrement;
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
      const refTable = this.dialect.escapeQualifiedId(rel.to.table.name, rel.to.table.schema);
      constraints.push(this.foreignKeyConstraint(table.name, foreignKeyOf(rel), refTable));
    }

    const target = this.dialect.escapeQualifiedId(table.name, table.schema);
    let createSql = `${this.tableDdl.createTable(target, !!options.ifNotExists)} (\n`;
    createSql += columns.map((col) => `  ${col}`).join(',\n');

    if (constraints.length > 0) {
      createSql += ',\n';
      createSql += constraints.map((c) => `  ${c}`).join(',\n');
    }

    createSql += '\n)';

    if (this.dialect.tableOptions) {
      createSql += ` ${this.dialect.tableOptions}`;
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
   * Generate a column definition from a ColumnNode. A composite key is declared as a table constraint,
   * so only a lone primary key column carries `PRIMARY KEY` inline.
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

  generateCreateIndexFromDefinition(tableName: string, index: IndexDefinition): string {
    return this.generateCreateIndex(
      tableName,
      renderIndexDefinition(index, (sql) => this.dialect.compileDdl(sql)),
    );
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
    this.assertColumnAddable(tableName, column);
    const colSql = this.generateColumnFromNode(fullColumnDefinitionToNode(column, tableName));
    const statements = [this.tableDdl.addColumn(tableName, colSql)];

    const foreignKey = columnForeignKey(column);
    if (foreignKey) {
      statements.push(...this.addForeignKeyStatements(tableName, [foreignKey]));
    }
    const index = columnIndex(tableName, column);
    if (index) {
      statements.push(this.generateCreateIndex(tableName, index));
    }
    statements.push(...this.generateColumnCommentStatement(tableName, column));
    return statements;
  }

  generateAlterColumnSql(tableName: string, columnName: string, column: FullColumnDefinition): string[] {
    const node = fullColumnDefinitionToNode(column, tableName);
    return this.generateAlterColumnStatements(
      tableName,
      { ...this.columnNodeToSchema(node), name: columnName },
      this.generateColumnFromNode(node),
    );
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
    if (!this.features.foreignKeyAlter) {
      throw new TypeError(`Dialect ${this.dialect} does not support adding foreign keys to existing tables`);
    }
    const constraint = this.foreignKeyConstraint(tableName, foreignKey, this.escapeId(foreignKey.references.table));
    return `ALTER TABLE ${this.escapeId(tableName)} ADD ${constraint};`;
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
   * Drops the table's key, by the name the constraint really has: introspected, or derived where this
   * generator added it. MySQL takes no name.
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

  /**
   * A column an `ALTER` can carry. Only a generated one is ever refused, and only where the engine
   * takes it in a `CREATE TABLE` but not afterwards.
   */
  private assertColumnAddable(
    tableName: string,
    column: { readonly name: string; readonly generatedAs?: string },
  ): void {
    if (!column.generatedAs || this.features.generatedColumnAdd) {
      return;
    }
    throw new TypeError(
      `${this.dialect}: Cannot add the computed column "${column.name}" to the existing table ` +
        `"${tableName}" - this database only accepts one in a CREATE TABLE. Drop \`stored\` to have the ` +
        'expression spliced into each statement instead, or recreate the table in a written migration.',
    );
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
 * What a constraint is called: its own name, or one derived from its columns where nothing named it.
 * Shared by the add and the drop so a `DROP CONSTRAINT` names exactly what an `ADD CONSTRAINT` made.
 */
function constraintNameOf(tableName: string, foreignKey: ForeignKeySchema): string {
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
  options: Pick<BuildSchemaASTOptions, 'defaultForeignKeyAction' | 'textScoreIndexes'> = {},
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
