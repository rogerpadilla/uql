/**
 * Entity Code Generator
 *
 * Generates TypeScript entity files from SchemaAST.
 * Supports:
 * - ES Module syntax
 * - TypeScript types
 * - Relations with proper decorators
 * - Indexes
 * - JSDoc comments for sync-added fields
 */

import { canonicalToColumnType, canonicalToTypeScript } from '../../schema/canonicalType.js';
import type { SchemaAST } from '../../schema/schemaAST.js';
import type { CanonicalType, ColumnNode, RelationshipNode, RelationshipType, TableNode } from '../../schema/types.js';
import { camelCase, pascalCase, singularize } from '../../util/string.util.js';

/**
 * Options for entity code generation.
 */
export interface EntityCodeGeneratorOptions {
  /** Base import path for @uql/core (default: '@uql/core') */
  uqlImportPath?: string;
  /** Whether to add JSDoc with @sync-added for generated fields */
  addSyncComments?: boolean;
  /** Custom class name transformer (default: PascalCase singularized) */
  classNameTransformer?: (tableName: string) => string;
  /** Custom property name transformer (default: camelCase) */
  propertyNameTransformer?: (columnName: string) => string;
  /** Whether to generate relation properties (default: true) */
  includeRelations?: boolean;
  /** Whether to include index decorators (default: true) */
  includeIndexes?: boolean;
  /** Custom singularize function */
  singularize?: (name: string) => string;
}

/**
 * Generated entity result.
 */
export interface GeneratedEntity {
  /** The entity class name */
  className: string;
  /** The table name */
  tableName: string;
  /** The generated TypeScript code */
  code: string;
  /** The suggested file name */
  fileName: string;
}

/**
 * Generates TypeScript entity code from SchemaAST.
 */
export class EntityCodeGenerator {
  private readonly options: Required<EntityCodeGeneratorOptions>;

  constructor(
    private readonly ast: SchemaAST,
    options: EntityCodeGeneratorOptions = {},
  ) {
    this.options = {
      uqlImportPath: options.uqlImportPath ?? '@uql/core',
      addSyncComments: options.addSyncComments ?? true,
      classNameTransformer: options.classNameTransformer ?? this.defaultClassNameTransformer.bind(this),
      propertyNameTransformer: options.propertyNameTransformer ?? this.defaultPropertyNameTransformer.bind(this),
      includeRelations: options.includeRelations ?? true,
      includeIndexes: options.includeIndexes ?? true,
      singularize: options.singularize ?? this.defaultSingularize.bind(this),
    };
  }

  /**
   * Generate entities for all tables in the AST.
   */
  generateAll(): GeneratedEntity[] {
    const entities: GeneratedEntity[] = [];

    for (const table of this.ast.tables.values()) {
      entities.push(this.generateEntity(table));
    }

    return entities;
  }

  /**
   * Generate entity for a specific table.
   */
  generateForTable(tableName: string): GeneratedEntity | undefined {
    const table = this.ast.getTable(tableName);
    if (!table) return undefined;
    return this.generateEntity(table);
  }

  /**
   * Generate entity code for a table.
   */
  private generateEntity(table: TableNode): GeneratedEntity {
    const className = this.options.classNameTransformer(table.name);
    const fileName = `${className}.ts`;

    const imports = this.buildImports(table);
    const decorators = this.buildEntityDecorators(table);
    const fields = this.buildFields(table);
    const relations = this.options.includeRelations ? this.buildRelations(table) : '';

    const code = [imports, '', decorators, `export class ${className} {`, fields, relations, '}', ''].join('\n');

    return {
      className,
      tableName: table.name,
      code,
      fileName,
    };
  }

  /**
   * Build import statements.
   */
  private buildImports(table: TableNode): string {
    const uqlImports = new Set<string>(['Entity', 'Field']);
    const relatedImports: string[] = [];

    // Check for Id decorator
    for (const col of table.columns.values()) {
      if (col.isPrimaryKey) {
        uqlImports.add('Id');
      }
    }

    // Check for relation decorators
    if (this.options.includeRelations) {
      for (const rel of [...table.incomingRelations, ...table.outgoingRelations]) {
        uqlImports.add(this.getRelationDecoratorName(rel.type));
        uqlImports.add('Relation');

        const relatedTable = rel.from.table === table ? rel.to.table : rel.from.table;
        const relatedClassName = this.options.classNameTransformer(relatedTable.name);
        if (!relatedImports.includes(relatedClassName)) {
          relatedImports.push(relatedClassName);
        }
      }
    }

    // Check for composite index decorators
    if (this.options.includeIndexes) {
      const compositeIndexes = this.ast.getTableIndexes(table.name).filter((idx) => idx.columns.length > 1);
      if (compositeIndexes.length > 0) {
        uqlImports.add('Index');
      }
    }

    let code = `import { ${Array.from(uqlImports).sort().join(', ')} } from '${this.options.uqlImportPath}';\n`;

    // Add related entity imports
    for (const className of relatedImports.sort()) {
      code += `import { ${className} } from './${className}.js';\n`;
    }

    return code;
  }

  /**
   * Build entity decorators.
   */
  private buildEntityDecorators(table: TableNode): string {
    const lines: string[] = [];

    // Add composite index decorators
    if (this.options.includeIndexes) {
      const compositeIndexes = this.ast.getTableIndexes(table.name).filter((idx) => idx.columns.length > 1);

      for (const idx of compositeIndexes) {
        const propNames = idx.columns.map((c) => `'${this.options.propertyNameTransformer(c.name)}'`).join(', ');
        const options: string[] = [];
        if (idx.name) options.push(`name: '${idx.name}'`);
        if (idx.unique) options.push('unique: true');

        const optStr = options.length > 0 ? `, { ${options.join(', ')} }` : '';
        lines.push(`@Index([${propNames}]${optStr})`);
      }
    }

    // Entity decorator
    lines.push(`@Entity({ name: '${table.name}' })`);

    return lines.join('\n');
  }

  /**
   * Build field definitions.
   */
  private buildFields(table: TableNode): string {
    const lines: string[] = [];

    for (const col of table.columns.values()) {
      const fieldCode = this.buildField(col);
      lines.push(fieldCode);
    }

    return lines.join('\n\n');
  }

  /**
   * Build a single field definition.
   */
  private buildField(col: ColumnNode): string {
    const lines: string[] = [];
    const propertyName = this.options.propertyNameTransformer(col.name);
    const tsType = canonicalToTypeScript(col.type);

    // JSDoc comment if enabled
    if (this.options.addSyncComments) {
      lines.push('  /**');
      lines.push(`   * @sync-added ${new Date().toISOString().split('T')[0]}`);
      lines.push(`   * Column: ${col.name} (${this.formatTypeDescription(col.type)})`);
      if (col.comment) {
        lines.push(`   * ${col.comment}`);
      }
      lines.push('   */');
    }

    // Decorator
    if (col.isPrimaryKey) {
      const idOptions = this.buildIdOptions(col);
      lines.push(`  @Id(${idOptions})`);
    } else {
      const fieldOptions = this.buildFieldOptions(col);
      lines.push(`  @Field(${fieldOptions})`);
    }

    // Property
    const nullable = col.nullable ? '?' : '';
    lines.push(`  ${propertyName}${nullable}: ${tsType};`);

    return lines.join('\n');
  }

  /**
   * Build Id decorator options.
   */
  private buildIdOptions(col: ColumnNode): string {
    const options: string[] = [];

    if (col.name !== 'id') {
      options.push(`name: '${col.name}'`);
    }

    return options.length > 0 ? `{ ${options.join(', ')} }` : '';
  }

  /**
   * Build Field decorator options.
   */
  private buildFieldOptions(col: ColumnNode): string {
    const options: string[] = [];

    // Column type
    const columnType = canonicalToColumnType(col.type);
    if (columnType) {
      options.push(`columnType: '${columnType}'`);
    }

    // Length
    if (col.type.length && col.type.category === 'string') {
      options.push(`length: ${col.type.length}`);
    }

    // Precision and scale
    if (col.type.precision) {
      options.push(`precision: ${col.type.precision}`);
      if (col.type.scale) {
        options.push(`scale: ${col.type.scale}`);
      }
    }

    // Nullable
    if (col.nullable) {
      options.push('nullable: true');
    }

    // Unique
    if (col.isUnique) {
      options.push('unique: true');
    }

    // Default value
    if (col.defaultValue !== undefined) {
      options.push(`defaultValue: ${this.formatDefaultValue(col.defaultValue)}`);
    }

    // Index (single column)
    if (this.options.includeIndexes) {
      const indexes = this.ast.getTableIndexes(col.table.name);
      const singleColIndex = indexes.find((idx) => idx.columns.length === 1 && idx.columns[0].name === col.name);

      if (singleColIndex) {
        options.push(`index: '${singleColIndex.name}'`);
      }
    }

    return options.length > 0 ? `{ ${options.join(', ')} }` : '';
  }

  /**
   * Build relation definitions.
   */
  private buildRelations(table: TableNode): string {
    const lines: string[] = [];

    // Outgoing relations (this table has FK)
    for (const rel of table.outgoingRelations) {
      const relCode = this.buildOutgoingRelation(rel, table);
      lines.push(relCode);
    }

    // Incoming relations (other tables have FK to this)
    for (const rel of table.incomingRelations) {
      const relCode = this.buildIncomingRelation(rel, table);
      lines.push(relCode);
    }

    if (lines.length > 0) {
      return '\n' + lines.join('\n\n');
    }

    return '';
  }

  /**
   * Build outgoing relation (ManyToOne or OneToOne where this table has FK).
   */
  private buildOutgoingRelation(rel: RelationshipNode, table: TableNode): string {
    const lines: string[] = [];
    const relatedClassName = this.options.classNameTransformer(rel.to.table.name);

    // Try to derive property name from FK column name (e.g., author_id -> author)
    let propertyName = '';
    const firstCol = rel.from.columns[0]?.name;
    if (firstCol && (firstCol.toLowerCase().endsWith('_id') || firstCol.toLowerCase().endsWith('id'))) {
      const baseName = firstCol.replace(/_?id$/i, '');
      propertyName = this.options.propertyNameTransformer(baseName);
    } else {
      propertyName = this.options.propertyNameTransformer(this.options.singularize(rel.to.table.name));
    }

    const decoratorName = this.getRelationDecoratorName(rel.type);

    // JSDoc
    if (this.options.addSyncComments) {
      lines.push('  /**');
      lines.push(`   * @sync-added ${new Date().toISOString().split('T')[0]}`);
      lines.push(`   * Relation to ${rel.to.table.name} via ${rel.from.columns.map((c) => c.name).join(', ')}`);
      if (rel.confidence !== undefined && rel.confidence < 1.0) {
        lines.push(`   * Inferred (${(rel.confidence * 100).toFixed(0)}% confidence)`);
      }
      lines.push('   */');
    }

    // Decorator
    lines.push(`  @${decoratorName}({ entity: () => ${relatedClassName} })`);

    // Property
    lines.push(`  ${propertyName}?: Relation<${relatedClassName}>;`);

    return lines.join('\n');
  }

  /**
   * Build incoming relation (OneToMany where other tables have FK to this).
   */
  private buildIncomingRelation(rel: RelationshipNode, table: TableNode): string {
    const lines: string[] = [];
    const relatedClassName = this.options.classNameTransformer(rel.from.table.name);
    const propertyName = this.options.propertyNameTransformer(rel.from.table.name);
    const inverseType = this.ast.getInverseRelationType(rel.type);
    const decoratorName = this.getRelationDecoratorName(inverseType);

    // JSDoc
    if (this.options.addSyncComments) {
      lines.push('  /**');
      lines.push(`   * @sync-added ${new Date().toISOString().split('T')[0]}`);
      lines.push(`   * Inverse relation from ${rel.from.table.name}`);
      lines.push('   */');
    }

    // Decorator - includes references to property name
    const inverseProp = this.options.propertyNameTransformer(this.options.singularize(table.name));
    lines.push(`  @${decoratorName}({ entity: () => ${relatedClassName}, references: '${inverseProp}' })`);

    // Property
    if (inverseType === 'OneToMany' || inverseType === 'ManyToMany') {
      lines.push(`  ${propertyName}?: Relation<${relatedClassName}[]>;`);
    } else {
      lines.push(`  ${propertyName}?: Relation<${relatedClassName}>;`);
    }

    return lines.join('\n');
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Get decorator name for relation type.
   */
  private getRelationDecoratorName(type: RelationshipType): string {
    switch (type) {
      case 'OneToOne':
        return 'OneToOne';
      case 'OneToMany':
        return 'OneToMany';
      case 'ManyToOne':
        return 'ManyToOne';
      case 'ManyToMany':
        return 'ManyToMany';
    }
  }

  /**
   * Format type for description.
   */
  private formatTypeDescription(type: CanonicalType): string {
    let desc = type.category.toUpperCase();
    if (type.size) desc = `${type.size.toUpperCase()}${desc}`;
    if (type.length) desc += `(${type.length})`;
    if (type.precision) {
      desc += `(${type.precision}`;
      if (type.scale) desc += `,${type.scale}`;
      desc += ')';
    }
    if (type.unsigned) desc += ' UNSIGNED';
    return desc;
  }

  /**
   * Format default value for code.
   */
  private formatDefaultValue(value: unknown): string {
    if (typeof value === 'string') {
      // Check for SQL expressions
      if (
        value.includes('(') ||
        value.toUpperCase() === 'CURRENT_TIMESTAMP' ||
        value.toUpperCase().includes('NEXTVAL')
      ) {
        return `'${value}'`; // Keep as string for expressions
      }
      return `'${value.replace(/'/g, "\\'")}'`;
    }
    if (typeof value === 'boolean') {
      return value.toString();
    }
    if (typeof value === 'number') {
      return value.toString();
    }
    if (value === null) {
      return 'null';
    }
    return JSON.stringify(value);
  }

  /**
   * Default class name transformer: table_name -> TableName (PascalCase, singular).
   */
  private defaultClassNameTransformer(tableName: string): string {
    const singular = this.options.singularize(tableName);
    return this.toPascalCase(singular);
  }

  /**
   * Default property name transformer: column_name -> columnName (camelCase).
   */
  private defaultPropertyNameTransformer(name: string): string {
    return this.toCamelCase(name);
  }

  /**
   * Convert to PascalCase (delegates to shared utility).
   */
  private toPascalCase(str: string): string {
    return pascalCase(str);
  }

  /**
   * Convert to camelCase (delegates to shared utility).
   */
  private toCamelCase(str: string): string {
    return camelCase(str);
  }

  /**
   * Default singularize function (delegates to shared utility).
   */
  private defaultSingularize(name: string): string {
    return singularize(name);
  }
}

/**
 * Create an EntityCodeGenerator from SchemaAST.
 */
export function createEntityCodeGenerator(ast: SchemaAST, options?: EntityCodeGeneratorOptions): EntityCodeGenerator {
  return new EntityCodeGenerator(ast, options);
}
