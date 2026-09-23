import { canonicalToTypeScript } from '../../schema/canonicalType.js';
import type { SchemaAST } from '../../schema/schemaAST.js';
import {
  type CanonicalType,
  type ColumnNode,
  DEFAULT_FOREIGN_KEY_ACTION,
  type RelationshipNode,
  type RelationshipType,
  type TableNode,
} from '../../schema/types.js';
import { camelCase, lowerFirst, pascalCase, singularize } from '../../util/string.util.js';
import { buildFieldOptionsSource, fieldNeedsRaw } from './fieldOptionsSource.js';
import { buildIndexDecoratorSource, indexNeedsRaw, isPlainFieldIndex } from './indexDecoratorSource.js';
import { memberSource } from './sourceLiteral.js';

/** The decorator on the other side of a relation. */
const INVERSE_RELATION: Readonly<Record<RelationshipType, RelationshipType>> = {
  OneToOne: 'OneToOne',
  OneToMany: 'ManyToOne',
  ManyToOne: 'OneToMany',
  ManyToMany: 'ManyToMany',
};

/**
 * Options for entity code generation.
 */
export interface EntityCodeGeneratorOptions {
  /** Base import path for uql-orm (default: 'uql-orm') */
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
      uqlImportPath: options.uqlImportPath ?? 'uql-orm',
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

    for (const col of table.columns.values()) {
      if (col.isPrimaryKey) {
        uqlImports.add('Id');
      }
      if (fieldNeedsRaw(col)) {
        uqlImports.add('raw');
      }
    }

    // Check for relation decorators
    if (this.options.includeRelations) {
      for (const rel of [...table.incomingRelations, ...table.outgoingRelations]) {
        uqlImports.add(rel.type);

        const relatedTable = rel.from.table === table ? rel.to.table : rel.from.table;
        const relatedClassName = this.options.classNameTransformer(relatedTable.name);
        if (!relatedImports.includes(relatedClassName)) {
          relatedImports.push(relatedClassName);
        }
      }
    }

    if (this.options.includeIndexes) {
      const declared = this.declaredIndexes(table);
      if (declared.length > 0) {
        uqlImports.add('Index');
      }
      if (declared.some(indexNeedsRaw)) {
        uqlImports.add('raw');
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

    if (this.options.includeIndexes) {
      const param = lowerFirst(this.options.classNameTransformer(table.name));
      for (const index of this.declaredIndexes(table)) {
        lines.push(buildIndexDecoratorSource(index, this.options.propertyNameTransformer, param));
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
      lines.push('   */');
    }

    // Decorator
    if (col.isPrimaryKey) {
      const idOptions = this.buildIdOptions(col, propertyName);
      lines.push(`  @Id(${idOptions})`);
    } else {
      const fieldOptions = this.buildFieldOptions(col, propertyName);
      lines.push(`  @Field(${fieldOptions})`);
    }

    // Property. A generated column is the database's to write, so it is `readonly`: a write payload
    // leaves those out, and one naming it would be dropped rather than persisted.
    const nullable = col.nullable ? '?' : '';
    const written = col.generatedAs === undefined ? '' : 'readonly ';
    lines.push(`  ${written}${propertyName}${nullable}: ${tsType};`);

    return lines.join('\n');
  }

  /**
   * Build Id decorator options.
   */
  private buildIdOptions(col: ColumnNode, propertyName: string): string {
    return propertyName === col.name ? '' : `{ name: '${col.name}' }`;
  }

  /**
   * Build Field decorator options.
   */
  private buildFieldOptions(col: ColumnNode, propertyName: string): string {
    const indexes = this.options.includeIndexes ? col.table.indexes : [];
    const fieldIndex = indexes.find((idx) => isPlainFieldIndex(idx) && idx.entries[0]?.column === col.name);
    return buildFieldOptionsSource(col, propertyName, fieldIndex?.name);
  }

  /**
   * The indexes this table needs an `@Index` for, which is every one a `@Field({ index })` cannot
   * carry on its own.
   */
  private declaredIndexes(table: TableNode) {
    return table.indexes.filter((index) => !isPlainFieldIndex(index));
  }

  /**
   * Build relation definitions.
   */
  private buildRelations(table: TableNode): string {
    const lines: string[] = [];

    // Outgoing relations (this table has FK)
    for (const rel of table.outgoingRelations) {
      const relCode = this.buildOutgoingRelation(rel);
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
  private buildOutgoingRelation(rel: RelationshipNode): string {
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

    // JSDoc
    if (this.options.addSyncComments) {
      lines.push('  /**');
      lines.push(`   * @sync-added ${new Date().toISOString().split('T')[0]}`);
      lines.push(`   * Relation to ${rel.to.table.name} via ${rel.from.columns.map((c) => c.name).join(', ')}`);
      lines.push('   */');
    }

    // Decorator. `onDelete`/`onUpdate` only when introspection found a real referential action, so a
    // round-trip through an unconstrained column stays as terse as before.
    const options = [`entity: () => ${relatedClassName}`];
    const references = this.referencesSource(rel, relatedClassName);
    if (references) options.push(`references: ${references}`);
    if (rel.onDelete && rel.onDelete !== DEFAULT_FOREIGN_KEY_ACTION) options.push(`onDelete: '${rel.onDelete}'`);
    if (rel.onUpdate && rel.onUpdate !== DEFAULT_FOREIGN_KEY_ACTION) options.push(`onUpdate: '${rel.onUpdate}'`);
    lines.push(`  @${rel.type}({ ${options.join(', ')} })`);

    // Property
    lines.push(`  ${propertyName}?: ${relatedClassName};`);

    return lines.join('\n');
  }

  /**
   * The `references` callback of a to-one: its foreign key column where that is the target's whole primary
   * key, column pairs otherwise, and nothing when the columns do not pair up.
   */
  private referencesSource(rel: RelationshipNode, relatedClassName: string): string | undefined {
    if (!rel.from.columns.length || rel.from.columns.length !== rel.to.columns.length) {
      return undefined;
    }
    const member = (param: string, column: ColumnNode) =>
      memberSource(param, this.options.propertyNameTransformer(column.name));
    const own = lowerFirst(this.options.classNameTransformer(rel.from.table.name));
    const key = rel.to.table.primaryKey?.columns ?? [];
    if (rel.from.columns.length === 1 && key.length === 1 && rel.to.columns[0].name === key[0]) {
      return `(${own}) => ${member(own, rel.from.columns[0])}`;
    }
    const target = lowerFirst(relatedClassName);
    const [local, foreign] = own === target ? ['local', 'foreign'] : [own, target];
    const pairs = rel.from.columns.map(
      (column, i) => `{ local: ${member(local, column)}, foreign: ${member(foreign, rel.to.columns[i])} }`,
    );
    return `(${local}, ${foreign}) => [${pairs.join(', ')}]`;
  }

  /**
   * Build incoming relation (OneToMany where other tables have FK to this).
   */
  private buildIncomingRelation(rel: RelationshipNode, table: TableNode): string {
    const lines: string[] = [];
    const relatedClassName = this.options.classNameTransformer(rel.from.table.name);
    const propertyName = this.options.propertyNameTransformer(rel.from.table.name);

    // JSDoc
    if (this.options.addSyncComments) {
      lines.push('  /**');
      lines.push(`   * @sync-added ${new Date().toISOString().split('T')[0]}`);
      lines.push(`   * Inverse relation from ${rel.from.table.name}`);
      lines.push('   */');
    }

    // The inverse side, mapped by the related class's property that points back at this one.
    const param = lowerFirst(relatedClassName);
    const inverse = memberSource(param, this.options.propertyNameTransformer(this.options.singularize(table.name)));
    const inverseType = INVERSE_RELATION[rel.type];
    lines.push(`  @${inverseType}({ entity: () => ${relatedClassName}, mappedBy: (${param}) => ${inverse} })`);
    const many = inverseType === 'OneToMany' || inverseType === 'ManyToMany';
    lines.push(`  ${propertyName}?: ${relatedClassName}${many ? '[]' : ''};`);

    return lines.join('\n');
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
