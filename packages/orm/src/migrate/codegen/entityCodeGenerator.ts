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
import { camelCase, lowerFirst, pascalCase, singularize, upperFirst } from '../../util/string.util.js';
import { buildFieldOptionsSource, fieldImports } from './fieldOptionsSource.js';
import { buildIndexDecoratorSource, indexNeedsRaw, isPlainFieldIndex } from './indexDecoratorSource.js';
import { memberSource, quoted } from './sourceLiteral.js';

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
    const singular = options.singularize ?? singularize;
    this.options = {
      uqlImportPath: options.uqlImportPath ?? 'uql-orm',
      addSyncComments: options.addSyncComments ?? true,
      classNameTransformer: options.classNameTransformer ?? ((tableName) => pascalCase(singular(tableName))),
      propertyNameTransformer: options.propertyNameTransformer ?? camelCase,
      includeRelations: options.includeRelations ?? true,
      includeIndexes: options.includeIndexes ?? true,
      singularize: singular,
    };
  }

  /** An entity for each table of the AST. */
  generateAll(): GeneratedEntity[] {
    return [...this.ast.tables.values()].map((table) => this.generateEntity(table));
  }

  /** The entity for the table named, if the AST has it. */
  generateForTable(tableName: string): GeneratedEntity | undefined {
    const table = this.ast.getTable(tableName);
    return table && this.generateEntity(table);
  }

  private generateEntity(table: TableNode): GeneratedEntity {
    const className = this.options.classNameTransformer(table.name);
    const fileName = `${className}.ts`;

    const imports = this.buildImports(table);
    const decorators = this.buildEntityDecorators(table);
    const brand = this.idKeyBrand(table);
    const fields = brand ? `${brand}\n\n${this.buildFields(table)}` : this.buildFields(table);
    const relations = this.options.includeRelations ? this.buildRelations(table) : '';

    const code = [imports, '', decorators, `export class ${className} {`, fields, relations, '}', ''].join('\n');

    return {
      className,
      tableName: table.name,
      code,
      fileName,
    };
  }

  private buildImports(table: TableNode): string {
    const uqlImports = new Set<string>(['Entity', 'Field']);
    const relatedImports: string[] = [];

    if (this.idKeyBrand(table)) {
      uqlImports.add('idKey');
    }
    for (const col of table.columns.values()) {
      if (col.isPrimaryKey) {
        uqlImports.add('Id');
      }
      for (const name of fieldImports(col)) {
        uqlImports.add(name);
      }
      if (col.type.category === 'json') {
        uqlImports.add('type Json');
      }
    }

    // Check for relation decorators
    if (this.options.includeRelations) {
      for (const rel of table.outgoingRelations) {
        uqlImports.add(rel.type);
      }
      for (const rel of table.incomingRelations) {
        uqlImports.add(INVERSE_RELATION[rel.type]);
      }
      for (const rel of [...table.incomingRelations, ...table.outgoingRelations]) {
        const relatedTable = rel.from.table === table ? rel.to.table : rel.from.table;
        const relatedClassName = this.options.classNameTransformer(relatedTable.name);
        if (relatedTable !== table && !relatedImports.includes(relatedClassName)) {
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

    return [
      `import { ${Array.from(uqlImports).sort().join(', ')} } from '${this.options.uqlImportPath}';`,
      ...relatedImports.sort().map((className) => `import { ${className} } from './${className}.js';`),
    ].join('\n');
  }

  private buildEntityDecorators(table: TableNode): string {
    const lines: string[] = [];

    if (this.options.includeIndexes) {
      const param = lowerFirst(this.options.classNameTransformer(table.name));
      for (const index of this.declaredIndexes(table)) {
        lines.push(buildIndexDecoratorSource(index, this.options.propertyNameTransformer, param));
      }
    }

    lines.push(`@Entity({ name: '${table.name}' })`);

    return lines.join('\n');
  }

  private buildFields(table: TableNode): string {
    return [...table.columns.values()].map((col) => this.buildField(col)).join('\n\n');
  }

  /** The `@sync-added` JSDoc a generated member opens with, saying `what` it is, where asked for. */
  private syncDoc(what: string): string[] {
    return this.options.addSyncComments
      ? ['  /**', `   * @sync-added ${new Date().toISOString().split('T')[0]}`, `   * ${what}`, '   */']
      : [];
  }

  /**
   * The `idKey` brand naming the key, which the type level cannot see otherwise: needed unless the key is
   * one column holding the conventional name the entity would be read by, the first of `_id`, `id`, `uuid`.
   */
  private idKeyBrand(table: TableNode): string | undefined {
    const property = (column: string) => this.options.propertyNameTransformer(column);
    const keys = (table.primaryKey?.columns ?? []).map(property);
    const properties = [...table.columns.keys()].map(property);
    const conventional = ['_id', 'id', 'uuid'].find((name) => properties.includes(name));
    if (!keys.length || (keys.length === 1 && keys[0] === conventional)) {
      return undefined;
    }
    return `  [idKey]?: ${keys.map(quoted).join(' | ')};`;
  }

  private buildField(col: ColumnNode): string {
    const propertyName = this.options.propertyNameTransformer(col.name);
    return [
      ...this.syncDoc(`Column: ${col.name} (${formatTypeDescription(col.type)})`),
      `  @${col.isPrimaryKey ? 'Id' : 'Field'}(${this.buildFieldOptions(col, propertyName)})`,
      `  ${propertySource(col, propertyName)};`,
    ].join('\n');
  }

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

  /** The relations on both sides: where this table holds the foreign key, then where another points here. */
  private buildRelations(table: TableNode): string {
    const lines = [
      ...table.outgoingRelations.map((rel) => this.buildOutgoingRelation(rel)),
      ...table.incomingRelations.map((rel) => this.buildIncomingRelation(rel)),
    ];
    return lines.length ? `\n${lines.join('\n\n')}` : '';
  }

  /** The side holding the foreign key; `onDelete`/`onUpdate` only where the database states an action of its own. */
  private buildOutgoingRelation(rel: RelationshipNode): string {
    const relatedClassName = this.options.classNameTransformer(rel.to.table.name);
    const references = this.referencesSource(rel, relatedClassName);
    const options = [
      `entity: () => ${relatedClassName}`,
      ...(references ? [`references: ${references}`] : []),
      ...(rel.onDelete && rel.onDelete !== DEFAULT_FOREIGN_KEY_ACTION ? [`onDelete: '${rel.onDelete}'`] : []),
      ...(rel.onUpdate && rel.onUpdate !== DEFAULT_FOREIGN_KEY_ACTION ? [`onUpdate: '${rel.onUpdate}'`] : []),
    ];
    return [
      ...this.syncDoc(`Relation to ${rel.to.table.name} via ${rel.from.columns.map((c) => c.name).join(', ')}`),
      `  @${rel.type}({ ${options.join(', ')} })`,
      `  ${this.owningPropertyName(rel)}?: ${relatedClassName};`,
    ].join('\n');
  }

  /**
   * The property of the side holding the foreign key: its column's name less an `_id` or `Id` suffix
   * (`author_id` is `author`), else the singular of the table it points at. The inverse's `mappedBy` names the same.
   */
  private owningPropertyName(rel: RelationshipNode): string {
    const base = rel.from.columns[0]?.name.replace(/(?:_[iI][dD]|(?<=[a-z\d])Id)$/, '');
    return this.options.propertyNameTransformer(
      base && base !== rel.from.columns[0]?.name ? base : this.options.singularize(rel.to.table.name),
    );
  }

  /**
   * The inverse side's property: the related table's name, prefixed with the owning property where that
   * table points here more than once (`authorPosts`, `editorPosts`), so each gets a member of its own.
   */
  private inversePropertyName(rel: RelationshipNode): string {
    const name = this.options.propertyNameTransformer(rel.from.table.name);
    const pointers = rel.to.table.incomingRelations.filter((it) => it.from.table === rel.from.table);
    return pointers.length > 1 ? `${this.owningPropertyName(rel)}${upperFirst(name)}` : name;
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

  /** The inverse side, mapped by the related class's property that points back at this one. */
  private buildIncomingRelation(rel: RelationshipNode): string {
    const relatedClassName = this.options.classNameTransformer(rel.from.table.name);
    const param = lowerFirst(relatedClassName);
    const inverse = memberSource(param, this.owningPropertyName(rel));
    const inverseType = INVERSE_RELATION[rel.type];
    const many = inverseType === 'OneToMany' || inverseType === 'ManyToMany';
    return [
      ...this.syncDoc(`Inverse relation from ${rel.from.table.name}`),
      `  @${inverseType}({ entity: () => ${relatedClassName}, mappedBy: (${param}) => ${inverse} })`,
      `  ${this.inversePropertyName(rel)}?: ${relatedClassName}${many ? '[]' : ''};`,
    ].join('\n');
  }
}

/** A canonical type as the JSDoc of its field names it: `BIGINTEGER UNSIGNED`, `STRING(255)`, `DECIMAL(10,2)`. */
function formatTypeDescription(type: CanonicalType): string {
  const size = type.size?.toUpperCase() ?? '';
  const length = type.length ? `(${type.length})` : '';
  const precision = type.precision ? `(${type.precision}${type.scale ? `,${type.scale}` : ''})` : '';
  return `${size}${type.category.toUpperCase()}${length}${precision}${type.unsigned ? ' UNSIGNED' : ''}`;
}

/**
 * A column's property as source, declared the way every read and insert types it: present (`!`) where
 * the column is NOT NULL, left out of an insert (`?`) where a default fills it (a single-column key stays
 * `!`, which an insert leaves out anyway), `| null` where it holds NULL, `readonly` where the database computes it.
 */
function propertySource(col: ColumnNode, propertyName: string): string {
  const type = col.type.category === 'json' ? 'Json<unknown>' : canonicalToTypeScript(col.type);
  const written = col.generatedAs === undefined ? '' : 'readonly ';
  if (col.nullable && !col.isPrimaryKey) {
    return `${written}${propertyName}?: ${type} | null`;
  }
  const filled = !col.isPrimaryKey && col.defaultValue !== undefined;
  return `${written}${propertyName}${filled ? '?' : '!'}: ${type}`;
}
