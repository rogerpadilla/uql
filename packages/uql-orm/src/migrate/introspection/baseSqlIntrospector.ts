import type { AbstractSqlDialect } from '../../dialect/index.js';
import { canonicalColumnType } from '../../schema/canonicalType.js';
import type { IndexFacet } from '../../schema/indexDifferences.js';
import { createTableNode, SchemaAST } from '../../schema/schemaAST.js';
import type { ColumnNode, IndexNode, RelationshipNode, TableNode } from '../../schema/types.js';
import type { TableSchema } from '../../type/migration.js';
import { escapeSqlId } from '../../util/index.js';

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
   * Introspect entire database schema and return SchemaAST.
   */
  async introspect(): Promise<SchemaAST> {
    const tableNames = await this.getTableNames();
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
        const column: ColumnNode = {
          name: col.name,
          type: canonicalColumnType(col.type, col),
          nullable: col.nullable,
          defaultValue: col.defaultValue,
          isPrimaryKey: col.isPrimaryKey,
          isAutoIncrement: col.isAutoIncrement,
          isUnique: col.isUnique,
          comment: col.comment,
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
        const toTable = tableNodes.get(fk.referencedTable);
        if (!toTable) continue;

        const fromColumns = fk.columns.flatMap((name) => fromTable.columns.get(name) ?? []);
        const toColumns = fk.referencedColumns.flatMap((name) => toTable.columns.get(name) ?? []);

        if (fromColumns.length > 0 && toColumns.length > 0) {
          const rel: RelationshipNode = {
            name: fk.name,
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
