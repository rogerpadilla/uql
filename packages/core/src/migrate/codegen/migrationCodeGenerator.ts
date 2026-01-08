/**
 * Migration Code Generator
 *
 * Generates TypeScript migration code from SchemaDiff.
 * This enables auto-generating migrations from entity changes.
 */

import type { ColumnSchema, ForeignKeySchema, IndexSchema, SchemaDiff } from '../../type/index.js';

export interface MigrationCodeOptions {
  /** Indentation string (default: 2 spaces) */
  indent?: string;
  /** Whether to include comments explaining changes */
  includeComments?: boolean;
}

export interface GeneratedMigration {
  /** The up migration code */
  up: string;
  /** The down migration code */
  down: string;
  /** Human-readable description of changes */
  description: string;
}

/**
 * Generates TypeScript migration code from schema diffs.
 */
export class MigrationCodeGenerator {
  private readonly indent: string;
  private readonly includeComments: boolean;

  constructor(options: MigrationCodeOptions = {}) {
    this.indent = options.indent ?? '  ';
    this.includeComments = options.includeComments ?? true;
  }

  /**
   * Generate migration code from a single SchemaDiff.
   */
  generate(diff: SchemaDiff): GeneratedMigration {
    const description = this.generateDescription(diff);

    if (diff.type === 'create') {
      return {
        up: this.generateCreateTable(diff),
        down: this.generateDropTable(diff.tableName),
        description,
      };
    }

    if (diff.type === 'drop') {
      return {
        up: this.generateDropTable(diff.tableName),
        down: '// Cannot auto-generate: original table structure unknown',
        description,
      };
    }

    // alter
    return {
      up: this.generateAlterUp(diff),
      down: this.generateAlterDown(diff),
      description,
    };
  }

  /**
   * Generate migration code from multiple diffs.
   */
  generateAll(diffs: SchemaDiff[]): GeneratedMigration {
    const ups: string[] = [];
    const downs: string[] = [];
    const descriptions: string[] = [];

    for (const diff of diffs) {
      const result = this.generate(diff);
      ups.push(result.up);
      downs.push(result.down);
      descriptions.push(result.description);
    }

    return {
      up: ups.join('\n\n'),
      down: downs.reverse().join('\n\n'), // Reverse for correct rollback order
      description: descriptions.join('; '),
    };
  }

  /**
   * Generate a complete migration file template.
   */
  generateFile(diffs: SchemaDiff[], name?: string): string {
    const { up, down, description } = this.generateAll(diffs);
    const timestamp = new Date()
      .toISOString()
      .replace(/[-:T.Z]/g, '')
      .slice(0, 14);
    const migrationName = name ?? `migration_${timestamp}`;

    return `/**
 * Migration: ${migrationName}
 * ${description}
 *
 * Generated at: ${new Date().toISOString()}
 */

import type { IMigrationBuilder } from '@uql/core';

export async function up(builder: IMigrationBuilder): Promise<void> {
${this.indentBlock(up, 1)}
}

export async function down(builder: IMigrationBuilder): Promise<void> {
${this.indentBlock(down, 1)}
}
`;
  }

  // ===========================================================================
  // Private: Code Generation
  // ===========================================================================

  private generateCreateTable(diff: SchemaDiff): string {
    const columns = diff.columnsToAdd ?? [];
    const lines: string[] = [];

    lines.push(`await builder.createTable('${diff.tableName}', (table) => {`);

    for (const col of columns) {
      lines.push(`${this.indent}${this.generateColumnCall(col)};`);
    }

    // Add indexes if any
    for (const idx of diff.indexesToAdd ?? []) {
      lines.push(`${this.indent}${this.generateIndexCall(idx)};`);
    }

    lines.push('});');

    return lines.join('\n');
  }

  private generateDropTable(tableName: string): string {
    return `await builder.dropTable('${tableName}');`;
  }

  private generateAlterUp(diff: SchemaDiff): string {
    const lines: string[] = [];

    // Add columns
    for (const col of diff.columnsToAdd ?? []) {
      lines.push(this.generateAddColumn(diff.tableName, col));
    }

    // Alter columns
    for (const { to } of diff.columnsToAlter ?? []) {
      lines.push(this.generateAlterColumn(diff.tableName, to));
    }

    // Drop columns
    for (const colName of diff.columnsToDrop ?? []) {
      lines.push(`await builder.dropColumn('${diff.tableName}', '${colName}');`);
    }

    // Add indexes
    for (const idx of diff.indexesToAdd ?? []) {
      lines.push(this.generateCreateIndex(diff.tableName, idx));
    }

    // Drop indexes
    for (const idxName of diff.indexesToDrop ?? []) {
      lines.push(`await builder.dropIndex('${diff.tableName}', '${idxName}');`);
    }

    // Add foreign keys
    for (const fk of diff.foreignKeysToAdd ?? []) {
      lines.push(this.generateAddForeignKey(diff.tableName, fk));
    }

    // Drop foreign keys
    for (const fkName of diff.foreignKeysToDrop ?? []) {
      lines.push(`await builder.dropForeignKey('${diff.tableName}', '${fkName}');`);
    }

    return lines.join('\n');
  }

  private generateAlterDown(diff: SchemaDiff): string {
    const lines: string[] = [];

    // Reverse: drop added columns
    for (const col of diff.columnsToAdd ?? []) {
      lines.push(`await builder.dropColumn('${diff.tableName}', '${col.name}');`);
    }

    // Reverse: restore altered columns
    for (const { from } of diff.columnsToAlter ?? []) {
      lines.push(this.generateAlterColumn(diff.tableName, from));
    }

    // Reverse: re-add dropped columns (if we have the schema)
    // Note: This requires the original column definition
    if (diff.columnsToDrop?.length) {
      lines.push(`// TODO: Re-add dropped columns: ${diff.columnsToDrop.join(', ')}`);
    }

    // Reverse: drop added indexes
    for (const idx of diff.indexesToAdd ?? []) {
      lines.push(`await builder.dropIndex('${diff.tableName}', '${idx.name}');`);
    }

    // Reverse: re-add dropped indexes
    if (diff.indexesToDrop?.length) {
      lines.push(`// TODO: Re-add dropped indexes: ${diff.indexesToDrop.join(', ')}`);
    }

    // Reverse: drop added foreign keys
    for (const fk of diff.foreignKeysToAdd ?? []) {
      if (fk.name) {
        lines.push(`await builder.dropForeignKey('${diff.tableName}', '${fk.name}');`);
      }
    }

    // Reverse: re-add dropped foreign keys
    if (diff.foreignKeysToDrop?.length) {
      lines.push(`// TODO: Re-add dropped foreign keys: ${diff.foreignKeysToDrop.join(', ')}`);
    }

    return lines.join('\n');
  }

  private generateAddColumn(tableName: string, col: ColumnSchema): string {
    const options = this.generateColumnOptions(col);
    return `await builder.addColumn('${tableName}', '${col.name}', (col) => col${options});`;
  }

  private generateAlterColumn(tableName: string, col: ColumnSchema): string {
    const options = this.generateColumnOptions(col);
    return `await builder.alterColumn('${tableName}', '${col.name}', (col) => col${options});`;
  }

  private generateCreateIndex(tableName: string, idx: IndexSchema): string {
    const cols = idx.columns.map((c) => `'${c}'`).join(', ');
    const opts: string[] = [];
    if (idx.name) opts.push(`name: '${idx.name}'`);
    if (idx.unique) opts.push('unique: true');
    const optsStr = opts.length ? `, { ${opts.join(', ')} }` : '';
    return `await builder.createIndex('${tableName}', [${cols}]${optsStr});`;
  }

  private generateAddForeignKey(tableName: string, fk: ForeignKeySchema): string {
    const cols = fk.columns.map((c) => `'${c}'`).join(', ');
    const refCols = fk.referencedColumns.map((c: string) => `'${c}'`).join(', ');
    const opts: string[] = [];
    if (fk.name) opts.push(`name: '${fk.name}'`);
    if (fk.onDelete && fk.onDelete !== 'NO ACTION') opts.push(`onDelete: '${fk.onDelete}'`);
    if (fk.onUpdate && fk.onUpdate !== 'NO ACTION') opts.push(`onUpdate: '${fk.onUpdate}'`);
    const optsStr = opts.length ? `, { ${opts.join(', ')} }` : '';
    return `await builder.addForeignKey('${tableName}', [${cols}], { table: '${fk.referencedTable}', columns: [${refCols}] }${optsStr});`;
  }

  // ===========================================================================
  // Private: Column Call Generation
  // ===========================================================================

  private generateColumnCall(col: ColumnSchema): string {
    const method = this.getColumnMethod(col);
    const options = this.generateColumnOptionsObject(col);
    return `table.${method}('${col.name}'${options})`;
  }

  private generateIndexCall(idx: IndexSchema): string {
    const cols = idx.columns.map((c) => `'${c}'`).join(', ');
    if (idx.unique) {
      return `table.unique([${cols}], '${idx.name}')`;
    }
    return `table.index([${cols}], '${idx.name}')`;
  }

  private getColumnMethod(col: ColumnSchema): string {
    const type = col.type as string;

    // Check for auto-increment primary key → id()
    if (col.isPrimaryKey && col.isAutoIncrement) {
      return 'id';
    }

    // Map type string to method name
    const typeMap: Record<string, string> = {
      integer: 'integer',
      int: 'integer',
      bigint: 'bigint',
      smallint: 'smallint',
      float: 'float',
      double: 'double',
      decimal: 'decimal',
      numeric: 'decimal',
      varchar: 'string',
      char: 'char',
      text: 'text',
      boolean: 'boolean',
      bool: 'boolean',
      date: 'date',
      time: 'time',
      timestamp: 'timestamp',
      timestamptz: 'timestamptz',
      json: 'json',
      jsonb: 'jsonb',
      uuid: 'uuid',
      blob: 'blob',
      bytea: 'blob',
      vector: 'vector',
    };

    const lowerType = type.toLowerCase().replace(/\(.*\)/, ''); // Remove (255) etc
    return typeMap[lowerType] ?? 'string';
  }

  private generateColumnOptionsObject(col: ColumnSchema): string {
    const opts: string[] = [];

    // Type-specific options
    if (col.length !== undefined && col.length !== 255) {
      opts.push(`length: ${col.length}`);
    }
    if (col.precision !== undefined) {
      opts.push(`precision: ${col.precision}`);
    }
    if (col.scale !== undefined) {
      opts.push(`scale: ${col.scale}`);
    }

    // Common options (only include non-defaults)
    if (col.nullable) {
      opts.push('nullable: true');
    }
    if (col.isUnique && !col.isPrimaryKey) {
      opts.push('unique: true');
    }
    if (col.isPrimaryKey && !col.isAutoIncrement) {
      opts.push('primaryKey: true');
    }
    if (col.defaultValue !== undefined) {
      opts.push(`defaultValue: ${this.formatValue(col.defaultValue)}`);
    }

    if (opts.length === 0) return '';
    return `, { ${opts.join(', ')} }`;
  }

  private generateColumnOptions(col: ColumnSchema): string {
    const parts: string[] = [];

    if (!col.nullable) {
      parts.push('.notNullable()');
    }
    if (col.isUnique) {
      parts.push('.unique()');
    }
    if (col.defaultValue !== undefined) {
      parts.push(`.defaultValue(${this.formatValue(col.defaultValue)})`);
    }

    return parts.join('');
  }

  private formatValue(value: unknown): string {
    if (value === null) return 'null';
    if (typeof value === 'string') {
      // Check for SQL expressions
      if (
        value.toUpperCase().includes('CURRENT_TIMESTAMP') ||
        value.includes('()') ||
        value.toUpperCase().includes('NOW')
      ) {
        return `t.raw('${value}')`;
      }
      return `'${value.replace(/'/g, "\\'")}'`;
    }
    if (typeof value === 'boolean') return String(value);
    if (typeof value === 'number') return String(value);
    return JSON.stringify(value);
  }

  // ===========================================================================
  // Private: Utilities
  // ===========================================================================

  private generateDescription(diff: SchemaDiff): string {
    const parts: string[] = [];

    if (diff.type === 'create') {
      parts.push(`Create table '${diff.tableName}'`);
    } else if (diff.type === 'drop') {
      parts.push(`Drop table '${diff.tableName}'`);
    } else {
      if (diff.columnsToAdd?.length) {
        parts.push(`Add ${diff.columnsToAdd.length} column(s)`);
      }
      if (diff.columnsToAlter?.length) {
        parts.push(`Alter ${diff.columnsToAlter.length} column(s)`);
      }
      if (diff.columnsToDrop?.length) {
        parts.push(`Drop ${diff.columnsToDrop.length} column(s)`);
      }
    }

    return parts.join(', ') || `Alter table '${diff.tableName}'`;
  }

  private indentBlock(code: string, level: number): string {
    const prefix = this.indent.repeat(level);
    return code
      .split('\n')
      .map((line) => (line.trim() ? prefix + line : line))
      .join('\n');
  }
}

/**
 * Factory function to create a MigrationCodeGenerator.
 */
export function createMigrationCodeGenerator(options?: MigrationCodeOptions): MigrationCodeGenerator {
  return new MigrationCodeGenerator(options);
}
