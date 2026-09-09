import type { AbstractSqlDialect } from '../../dialect/index.js';
import { canonicalColumnType } from '../../schema/canonicalType.js';
import type { IndexFacet } from '../../schema/indexDifferences.js';
import { createTableNode, SchemaAST } from '../../schema/schemaAST.js';
import type { ColumnNode, IndexNode, RelationshipNode, TableNode } from '../../schema/types.js';
import type { TableSchema } from '../../type/migration.js';
import { escapeSqlId } from '../../util/index.js';
import { derivedForeignKeyName } from '../../util/sql.util.js';

/**
 * Base class for SQL introspectors with shared AST building logic.
 */
export abstract class BaseSqlIntrospector {
  /** Columns and uniqueness only; each introspector opts in to what its catalogue queries report. */
  readonly indexFacets: ReadonlySet<IndexFacet> = new Set();

  /**
   * The one schema these queries read, `undefined` for the connection's own default. Every table
   * reported is stamped with it, so a diff compares like with like: entity and database both say
   * `undefined` for "wherever the connection points", and name a schema only when one was asked for.
   */
  constructor(
    protected readonly dialect: AbstractSqlDialect,
    readonly schema?: string,
  ) {}

  protected escapeId(identifier: string): string {
    return escapeSqlId(identifier, this.dialect.escapeIdChar);
  }
  /**
   * The database as a {@link SchemaAST}, or just the tables named. A name nothing matches is left out
   * rather than raised: the point of naming them is to read a database other things are still
   * changing, where scanning every table is both wasted work and a relation that can vanish mid-scan.
   */
  async introspect(tables?: readonly string[]): Promise<SchemaAST> {
    const tableNames = tables ?? (await this.getTableNames());
    const tableSchemas: TableSchema[] = [];

    for (const tableName of tableNames) {
      const schema = await this.getTableSchema(tableName);
      if (schema) {
        tableSchemas.push(schema);
      }
    }

    return this.buildAST(tableSchemas);
  }

  abstract getTableNames(): Promise<string[]>;
  abstract getTableSchema(tableName: string): Promise<TableSchema | undefined>;

  /**
   * Build SchemaAST from table schemas.
   */
  protected buildAST(tableSchemas: TableSchema[]): SchemaAST {
    const ast = new SchemaAST();
    const tableNodes = new Map<string, TableNode>();

    this.buildTables(ast, tableNodes, tableSchemas);
    this.buildRelationships(ast, tableNodes, tableSchemas);
    this.buildIndexes(ast, tableNodes, tableSchemas);

    return ast;
  }

  private buildTables(ast: SchemaAST, tableNodes: Map<string, TableNode>, tableSchemas: TableSchema[]) {
    for (const schema of tableSchemas) {
      const table = createTableNode(schema.name, this.schema);
      const { columns } = table;

      for (const col of schema.columns) {
        // Spread, not field by field: a `ColumnSchema` is a `ColumnNode` minus the graph links, so
        // everything but the type crosses unchanged and a field either shape gains cannot be dropped
        // here. Listed by hand this had already lost `enum` and `generatedAs`.
        const { type, length: _length, precision: _precision, scale: _scale, ...rest } = col;
        const column: ColumnNode = {
          ...rest,
          type: canonicalColumnType(type, col),
          table,
          referencedBy: [],
        };
        columns.set(col.name, column);
      }

      // From the ordered list the query returned, not from the per-column flags: `(a, b)` is a
      // different key from `(b, a)`, and a flag says only that a column is *in* the key. Falls back
      // to the flags for an introspector that reports no key of its own.
      const keyColumns = schema.primaryKey ?? schema.columns.filter((col) => col.isPrimaryKey).map((col) => col.name);
      table.primaryKey.push(...keyColumns.flatMap((name) => columns.get(name) ?? []));
      table.primaryKeyName = schema.primaryKeyName;

      tableNodes.set(schema.name, table);
      ast.addTable(table);
    }
  }

  private buildRelationships(ast: SchemaAST, tableNodes: Map<string, TableNode>, tableSchemas: TableSchema[]) {
    for (const schema of tableSchemas) {
      if (!schema.foreignKeys) continue;
      const fromTable = tableNodes.get(schema.name);
      if (!fromTable) continue;

      for (const fk of schema.foreignKeys) {
        const toTable = tableNodes.get(fk.references.table);
        if (!toTable) continue;

        const fromColumns = fk.columns.flatMap((name) => fromTable.columns.get(name) ?? []);
        const toColumns = fk.references.columns.flatMap((name) => toTable.columns.get(name) ?? []);

        if (fromColumns.length > 0 && toColumns.length > 0) {
          const rel: RelationshipNode = {
            name: fk.name ?? derivedForeignKeyName(schema.name, fk.columns),
            type: fromColumns[0].isUnique ? 'OneToOne' : 'ManyToOne',
            from: { table: fromTable, columns: fromColumns },
            to: { table: toTable, columns: toColumns },
            onDelete: fk.onDelete || 'NO ACTION',
            onUpdate: fk.onUpdate || 'NO ACTION',
          };
          ast.addRelationship(rel);
        }
      }
    }
  }

  private buildIndexes(ast: SchemaAST, tableNodes: Map<string, TableNode>, tableSchemas: TableSchema[]) {
    for (const schema of tableSchemas) {
      if (!schema.indexes) continue;
      const table = tableNodes.get(schema.name);
      if (!table) continue;

      for (const idx of schema.indexes) {
        // An expression has no column to resolve. Dropping the entries that name a column this table
        // does not have, and the index if that leaves none, is what the entity side does too.
        const entries = idx.entries.filter((entry) => entry.expression || table.columns.has(entry.column));
        if (entries.length > 0) {
          const index: IndexNode = {
            name: idx.name,
            table,
            entries,
            unique: idx.unique,
            type: idx.type,
            where: idx.where,
            include: idx.include,
            source: 'database',
          };
          ast.addIndex(index);
        }
      }
    }
  }
}
