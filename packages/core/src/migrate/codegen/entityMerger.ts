/**
 * Entity Merger
 *
 * Merges generated entity code with existing TypeScript entity files.
 * Uses string-based parsing to add new fields with JSDoc comments.
 */

import { canonicalToColumnType, canonicalToTypeScript } from '../../schema/canonicalType.js';
import type { CanonicalType, ColumnNode, RelationshipNode } from '../../schema/types.js';
import { camelCase, pascalCase, singularize } from '../../util/string.util.js';

/**
 * Options for entity merging.
 */
export interface EntityMergerOptions {
  /** Add JSDoc @sync-added comments to new fields */
  addSyncComments?: boolean;
  /** Mark removed fields with @deprecated instead of deleting */
  markRemovedAsDeprecated?: boolean;
  /** Custom property name transformer */
  propertyNameTransformer?: (columnName: string) => string;
}

/**
 * Represents a field to add to an entity.
 */
export interface FieldToAdd {
  column: ColumnNode;
  propertyName: string;
  isRelation?: boolean;
  relation?: RelationshipNode;
}

/**
 * Represents a field to mark as deprecated.
 */
export interface FieldToDeprecate {
  propertyName: string;
  reason: string;
}

/**
 * Result of entity merge operation.
 */
export interface MergeResult {
  /** The merged source code */
  code: string;
  /** Number of fields added */
  fieldsAdded: number;
  /** Number of fields marked deprecated */
  fieldsDeprecated: number;
  /** Whether the file was modified */
  modified: boolean;
}

/**
 * Merges new fields from database schema into existing entity files.
 */
export class EntityMerger {
  private readonly options: Required<EntityMergerOptions>;

  constructor(options: EntityMergerOptions = {}) {
    this.options = {
      addSyncComments: options.addSyncComments ?? true,
      markRemovedAsDeprecated: options.markRemovedAsDeprecated ?? true,
      propertyNameTransformer: options.propertyNameTransformer ?? this.defaultPropertyNameTransformer.bind(this),
    };
  }

  /**
   * Merge new fields into existing entity source code.
   */
  merge(existingCode: string, fieldsToAdd: FieldToAdd[], fieldsToDeprecate: FieldToDeprecate[] = []): MergeResult {
    let code = existingCode;
    let fieldsAdded = 0;
    let fieldsDeprecated = 0;

    // Find the existing property names to avoid duplicates
    const existingProps = this.extractPropertyNames(code);

    // Filter out fields that already exist
    const newFields = fieldsToAdd.filter((f) => !existingProps.has(f.propertyName));

    // Find the position to insert new fields (before closing brace)
    const insertPosition = this.findInsertPosition(code);
    if (insertPosition === -1) {
      return { code, fieldsAdded: 0, fieldsDeprecated: 0, modified: false };
    }

    // Generate code for new fields
    const newFieldsCode = this.generateFieldsCode(newFields);

    if (newFieldsCode) {
      // Insert the new fields
      code = code.slice(0, insertPosition) + newFieldsCode + code.slice(insertPosition);
      fieldsAdded = newFields.length;
    }

    // Mark fields as deprecated
    if (this.options.markRemovedAsDeprecated) {
      for (const field of fieldsToDeprecate) {
        const deprecatedCode = this.markFieldAsDeprecated(code, field);
        if (deprecatedCode !== code) {
          code = deprecatedCode;
          fieldsDeprecated++;
        }
      }
    }

    return {
      code,
      fieldsAdded,
      fieldsDeprecated,
      modified: fieldsAdded > 0 || fieldsDeprecated > 0,
    };
  }

  /**
   * Extract existing property names from entity code.
   */
  private extractPropertyNames(code: string): Set<string> {
    const props = new Set<string>();

    // Match property declarations: propertyName?: Type;
    const regex = /^\s*(?:readonly\s+)?(\w+)\s*[?!]?\s*:/gm;

    let match = regex.exec(code);
    while (match !== null) {
      props.add(match[1]);
      match = regex.exec(code);
    }

    return props;
  }

  /**
   * Find the position to insert new fields (before the last closing brace).
   */
  private findInsertPosition(code: string): number {
    // Find the last closing brace that ends the class
    const lines = code.split('\n');
    let braceCount = 0;
    let inClass = false;
    let lastPropertyLine = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.includes('class ')) {
        inClass = true;
      }

      if (inClass) {
        // Count braces
        for (const char of line) {
          if (char === '{') braceCount++;
          if (char === '}') braceCount--;
        }

        // Track property declarations
        if (/^\s*(?:@\w+|readonly\s+|\w+\s*[?!]?:)/.test(line)) {
          lastPropertyLine = i;
        }

        // Found the closing brace
        if (braceCount === 0 && inClass) {
          // Insert before the closing brace, after the last property
          const insertLineIndex = lastPropertyLine >= 0 ? lastPropertyLine + 1 : i;

          // Calculate character position
          let pos = 0;
          for (let j = 0; j < insertLineIndex; j++) {
            pos += lines[j].length + 1; // +1 for newline
          }

          return pos;
        }
      }
    }

    return -1;
  }

  /**
   * Generate code for new fields.
   */
  private generateFieldsCode(fields: FieldToAdd[]): string {
    if (fields.length === 0) return '';

    const lines: string[] = [''];

    for (const field of fields) {
      if (field.isRelation && field.relation) {
        lines.push(...this.generateRelationField(field));
      } else {
        lines.push(...this.generateColumnField(field));
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Generate code for a column field.
   */
  private generateColumnField(field: FieldToAdd): string[] {
    const lines: string[] = [];
    const col = field.column;
    const tsType = canonicalToTypeScript(col.type);

    // JSDoc comment
    if (this.options.addSyncComments) {
      lines.push('  /**');
      lines.push(`   * @sync-added ${new Date().toISOString().split('T')[0]}`);
      lines.push(`   * Column discovered in database but not in entity.`);
      lines.push(`   * Type: ${this.formatTypeDescription(col.type)}, Nullable: ${col.nullable}`);
      lines.push('   */');
    }

    // Decorator
    if (col.isPrimaryKey) {
      lines.push(`  @Id()`);
    } else {
      const fieldOptions = this.buildFieldOptions(col);
      lines.push(`  @Field(${fieldOptions})`);
    }

    // Property
    const nullable = col.nullable ? '?' : '';
    lines.push(`  ${field.propertyName}${nullable}: ${tsType};`);

    return lines;
  }

  /**
   * Generate code for a relation field.
   */
  private generateRelationField(field: FieldToAdd): string[] {
    const lines: string[] = [];
    const rel = field.relation;
    if (!rel) return lines;

    // Determine related table and decorator
    const isOutgoing = rel.from.columns.some((c) => c.name === field.column.name);
    const relatedTable = isOutgoing ? rel.to.table : rel.from.table;
    const decoratorName = this.getRelationDecoratorName(rel.type, !isOutgoing);

    const relatedClassName = this.toPascalCase(this.singularize(relatedTable.name));

    // JSDoc comment
    if (this.options.addSyncComments) {
      lines.push('  /**');
      lines.push(`   * @sync-added ${new Date().toISOString().split('T')[0]}`);
      lines.push(`   * Foreign key relation detected: references "${relatedTable.name}"`);
      lines.push('   */');
    }

    // Decorator
    lines.push(`  @${decoratorName}({ entity: () => ${relatedClassName} })`);

    // Property
    const isArray = decoratorName === 'OneToMany' || decoratorName === 'ManyToMany';
    const typeStr = isArray ? `Relation<${relatedClassName}[]>` : `Relation<${relatedClassName}>`;
    lines.push(`  ${field.propertyName}?: ${typeStr};`);

    return lines;
  }

  /**
   * Mark a field as deprecated in the source code.
   */
  private markFieldAsDeprecated(code: string, field: FieldToDeprecate): string {
    // Find the property declaration
    const propRegex = new RegExp(`(^\\s*)(@\\w+.*?\\n\\s*)*?(${field.propertyName}\\s*[?!]?\\s*:)`, 'm');
    const match = propRegex.exec(code);

    if (!match) return code;

    // Check if already has @deprecated
    const beforeMatch = code.slice(Math.max(0, match.index - 100), match.index);
    if (beforeMatch.includes('@deprecated')) return code;

    // Add @deprecated JSDoc
    const indent = match[1] || '  ';
    const deprecationComment = [
      `${indent}/**`,
      `${indent} * @deprecated ${field.reason}`,
      `${indent} * @sync-removed ${new Date().toISOString().split('T')[0]}`,
      `${indent} */`,
      '',
    ].join('\n');

    return code.slice(0, match.index) + deprecationComment + code.slice(match.index);
  }

  /**
   * Build Field decorator options string.
   */
  private buildFieldOptions(col: ColumnNode): string {
    const options: string[] = [];

    const columnType = canonicalToColumnType(col.type);
    if (columnType) {
      options.push(`columnType: '${columnType}'`);
    }

    if (col.type.length && col.type.category === 'string') {
      options.push(`length: ${col.type.length}`);
    }

    if (col.type.precision !== undefined) {
      options.push(`precision: ${col.type.precision}`);
    }

    if (col.type.scale !== undefined) {
      options.push(`scale: ${col.type.scale}`);
    }

    if (col.nullable) {
      options.push('nullable: true');
    }

    return options.length > 0 ? `{ ${options.join(', ')} }` : '';
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
    return desc;
  }

  /**
   * Get relation decorator name.
   */
  private getRelationDecoratorName(type: string, inverse: boolean): string {
    if (inverse) {
      if (type === 'ManyToOne') return 'OneToMany';
      if (type === 'OneToMany') return 'ManyToOne';
    }
    return type;
  }

  /**
   * Default property name transformer (delegates to shared utility).
   */
  private defaultPropertyNameTransformer(columnName: string): string {
    return camelCase(columnName);
  }

  /**
   * Convert to PascalCase (delegates to shared utility).
   */
  private toPascalCase(str: string): string {
    return pascalCase(str);
  }

  /**
   * Singularize (delegates to shared utility).
   */
  private singularize(name: string): string {
    return singularize(name);
  }
}

/**
 * Create an EntityMerger instance.
 */
export function createEntityMerger(options?: EntityMergerOptions): EntityMerger {
  return new EntityMerger(options);
}
