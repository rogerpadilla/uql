/*eslint complexity: ["error", 30]*/

import type { Class } from 'type-fest';
import { AbstractSqlDialect } from 'nukak/dialect';
import { joinSQLFragments } from './utils/join-sql-fragments.js';
import { ConstraintChecking, Deferrable } from './utils/deferrable.js';
import type { DataType } from './data-types.js';
import type {
  AddConstraintQueryOptions,
  CreateDatabaseQueryOptions,
  DropTableQueryOptions,
  GetConstraintSnippetQueryOptions,
  ListDatabasesQueryOptions,
  QuoteTableOptions,
  RemoveColumnQueryOptions,
  RemoveConstraintQueryOptions,
  RenameTableQueryOptions,
  ShowConstraintsQueryOptions,
} from './query-generator.types.js';

// keep REMOVE_INDEX_QUERY_SUPPORTABLE_OPTIONS updated when modifying this
export interface RemoveIndexQueryOptions {
  concurrently?: boolean;
  ifExists?: boolean;
  cascade?: boolean;
}

export const CREATE_DATABASE_QUERY_SUPPORTABLE_OPTIONS = new Set<keyof CreateDatabaseQueryOptions>([
  'charset',
  'collate',
  'ctype',
  'encoding',
  'template',
]);
export const DROP_TABLE_QUERY_SUPPORTABLE_OPTIONS = new Set<keyof DropTableQueryOptions>(['cascade']);
export const LIST_DATABASES_QUERY_SUPPORTABLE_OPTIONS = new Set<keyof ListDatabasesQueryOptions>(['skip']);
export const QUOTE_TABLE_SUPPORTABLE_OPTIONS = new Set<keyof QuoteTableOptions>(['indexHints', 'tableHints']);
export const REMOVE_COLUMN_QUERY_SUPPORTABLE_OPTIONS = new Set<keyof RemoveColumnQueryOptions>(['ifExists', 'cascade']);
export const REMOVE_CONSTRAINT_QUERY_SUPPORTABLE_OPTIONS = new Set<keyof RemoveConstraintQueryOptions>([
  'ifExists',
  'cascade',
]);
export const REMOVE_INDEX_QUERY_SUPPORTABLE_OPTIONS = new Set<keyof RemoveIndexQueryOptions>([
  'concurrently',
  'ifExists',
  'cascade',
]);
export const RENAME_TABLE_QUERY_SUPPORTABLE_OPTIONS = new Set<keyof RenameTableQueryOptions>(['changeSchema']);
export const SHOW_CONSTRAINTS_QUERY_SUPPORTABLE_OPTIONS = new Set<keyof ShowConstraintsQueryOptions>([
  'columnName',
  'constraintName',
  'constraintType',
]);

export interface QueryGeneratorOptions {
  dialect: AbstractSqlDialect;
}

/**
 * Options accepted by {@link AbstractQueryGeneratorTypeScript#escape}
 */
export interface EscapeOptions extends FormatWhereOptions {
  readonly type?: DataType | undefined;
}

export interface FormatWhereOptions extends Bindable {
  /**
   * The model of the main alias. Used to determine the type & column name of attributes referenced in the where clause.
   */
  readonly model?: ModelStatic | undefined;

  /**
   * The alias of the main table corresponding to {@link FormatWhereOptions.model}.
   * Used as the prefix for attributes that do not reference an association, e.g.
   *
   * ```ts
   * const where = { name: 'foo' };
   * ```
   *
   * will produce
   *
   * ```sql
   * WHERE "<mainAlias>"."name" = 'foo'
   * ```
   */
  readonly mainAlias?: string | undefined;
}

/**
 * Methods that support this option are functions that add values to the query.
 * If {@link Bindable.bindParam} is specified, the value will be added to the query as a bind parameter.
 * If it is not specified, the value will be added to the query as a literal.
 */
export interface Bindable {
  bindParam?: ((value: unknown) => string) | undefined;
}

// DO NOT MAKE THIS CLASS PUBLIC!
/**
 * This is a temporary class used to progressively migrate the AbstractQueryGenerator class to TypeScript by slowly moving its functions here.
 * Always use {@link AbstractQueryGenerator} instead.
 */
export class AbstractQueryGeneratorTypeScript {
  readonly dialect: AbstractSqlDialect;

  constructor(options: QueryGeneratorOptions) {
    if (!options.dialect) {
      throw new Error('QueryGenerator initialized without options.dialect');
    }

    this.dialect = options.dialect;
  }

  protected _getTechnicalDatabaseNames(): string[] {
    return [];
  }

  protected _getTechnicalSchemaNames(): string[] {
    return [];
  }

  describeTableQuery(tableName: string) {
    return `DESCRIBE ${this.dialect.escapeId(tableName)};`;
  }

  dropTableQuery(tableName: string, options?: DropTableQueryOptions): string {
    const DROP_TABLE_QUERY_SUPPORTED_OPTIONS = new Set<keyof DropTableQueryOptions>();

    DROP_TABLE_QUERY_SUPPORTED_OPTIONS.add('cascade');

    return joinSQLFragments([
      'DROP TABLE IF EXISTS',
      this.dialect.escapeId(tableName),
      options?.cascade ? 'CASCADE' : '',
    ]);
  }

  listTablesQuery(schema: string): string {
    throw new TypeError(`listTablesQuery has not been implemented in dialect.`);
  }

  renameTableQuery(beforeTable: string, afterTable: string, options?: RenameTableQueryOptions): string {
    return `ALTER TABLE ${this.dialect.escapeId(beforeTable)} RENAME TO ${this.dialect.escapeId(afterTable)}`;
  }

  removeColumnQuery(tableName: string, columnName: string, options?: RemoveColumnQueryOptions): string {
    if (options) {
      const REMOVE_COLUMN_QUERY_SUPPORTED_OPTIONS = new Set<keyof RemoveColumnQueryOptions>();

      REMOVE_COLUMN_QUERY_SUPPORTED_OPTIONS.add('cascade');

      REMOVE_COLUMN_QUERY_SUPPORTED_OPTIONS.add('ifExists');
    }

    return joinSQLFragments([
      'ALTER TABLE',
      this.dialect.escapeId(tableName),
      'DROP COLUMN',
      options?.ifExists ? 'IF EXISTS' : '',
      this.dialect.escapeId(columnName),
      options?.cascade ? 'CASCADE' : '',
    ]);
  }

  addConstraintQuery(tableName: string, options: AddConstraintQueryOptions): string {
    // if (!this.dialect.supports.constraints.add) {
    //   throw new Error(`Add constraint queries are not supported by ${this.dialect.name} dialect`);
    // }

    return joinSQLFragments([
      'ALTER TABLE',
      this.dialect.escapeId(tableName),
      'ADD',
      this._getConstraintSnippet(tableName, options),
    ]);
  }

  _getConstraintSnippet(table: string, options: GetConstraintSnippetQueryOptions) {
    const quotedFields = options.fields.map((field) => {
      return this.dialect.escapeId(field);
    });

    const constraintNameParts = options.name ? null : options.fields;

    let constraintSnippet;
    const fieldsSqlQuotedString = quotedFields.join(', ');
    const fieldsSqlString = constraintNameParts?.join('_');

    switch (options.type.toUpperCase()) {
      case 'CHECK': {
        const constraintName = this.dialect.escapeId(options.name || `${table}_${fieldsSqlString}_ck`);
        constraintSnippet = `CONSTRAINT ${constraintName} CHECK (${this.whereItemsQuery(options.where)})`;
        break;
      }

      case 'UNIQUE': {
        const constraintName = this.dialect.escapeId(options.name || `${table}_${fieldsSqlString}_uk`);
        constraintSnippet = `CONSTRAINT ${constraintName} UNIQUE (${fieldsSqlQuotedString})`;
        if (options.deferrable) {
          constraintSnippet += ` ${this._getDeferrableConstraintSnippet(options.deferrable)}`;
        }

        break;
      }

      case 'DEFAULT': {
        if (options.defaultValue === undefined) {
          throw new Error('Default value must be specified for DEFAULT CONSTRAINT');
        }

        const constraintName = this.dialect.escapeId(options.name || `${table}_${fieldsSqlString}_df`);
        constraintSnippet = `CONSTRAINT ${constraintName} DEFAULT (${this.dialect.escape(options.defaultValue)}) FOR ${
          quotedFields[0]
        }`;
        break;
      }

      case 'PRIMARY KEY': {
        const constraintName = this.dialect.escapeId(options.name || `${table}_${fieldsSqlString}_pk`);
        constraintSnippet = `CONSTRAINT ${constraintName} PRIMARY KEY (${fieldsSqlQuotedString})`;
        if (options.deferrable) {
          constraintSnippet += ` ${this._getDeferrableConstraintSnippet(options.deferrable)}`;
        }

        break;
      }

      case 'FOREIGN KEY': {
        const references = options.references;
        if (!references || !references.table || !(references.field || references.fields)) {
          throw new Error(
            'Invalid foreign key constraint options. `references` object with `table` and `field` must be specified',
          );
        }

        const referencedTable = references.table;
        const constraintName = this.dialect.escapeId(
          options.name || `${table}_${fieldsSqlString}_${referencedTable}_fk`,
        );
        const quotedReferences =
          references.field !== undefined
            ? this.dialect.escapeId(references.field)
            : references.fields!.map((f) => this.dialect.escapeId(f)).join(', ');
        const referencesSnippet = `${this.dialect.escapeId(referencedTable)} (${quotedReferences})`;
        constraintSnippet = `CONSTRAINT ${constraintName} `;
        constraintSnippet += `FOREIGN KEY (${fieldsSqlQuotedString}) REFERENCES ${referencesSnippet}`;
        if (options.onUpdate) {
          constraintSnippet += ` ON UPDATE ${options.onUpdate.toUpperCase()}`;
        }

        if (options.onDelete) {
          constraintSnippet += ` ON DELETE ${options.onDelete.toUpperCase()}`;
        }

        if (options.deferrable) {
          constraintSnippet += ` ${this._getDeferrableConstraintSnippet(options.deferrable)}`;
        }

        break;
      }

      default: {
        throw new TypeError(`Constraint type ${options.type} is not supported by dialect`);
      }
    }

    return constraintSnippet;
  }

  protected _getDeferrableConstraintSnippet(deferrable: Deferrable) {
    switch (deferrable) {
      case Deferrable.INITIALLY_DEFERRED: {
        return 'DEFERRABLE INITIALLY DEFERRED';
      }

      case Deferrable.INITIALLY_IMMEDIATE: {
        return 'DEFERRABLE INITIALLY IMMEDIATE';
      }

      case Deferrable.NOT: {
        return 'NOT DEFERRABLE';
      }

      default: {
        throw new Error(`Unknown constraint checking behavior ${deferrable}`);
      }
    }
  }

  removeConstraintQuery(tableName: string, constraintName: string, options?: RemoveConstraintQueryOptions) {
    if (options) {
      const REMOVE_CONSTRAINT_QUERY_SUPPORTED_OPTIONS = new Set<keyof RemoveConstraintQueryOptions>();
      REMOVE_CONSTRAINT_QUERY_SUPPORTED_OPTIONS.add('cascade');
      REMOVE_CONSTRAINT_QUERY_SUPPORTED_OPTIONS.add('ifExists');
    }

    return joinSQLFragments([
      'ALTER TABLE',
      this.dialect.escapeId(tableName),
      'DROP CONSTRAINT',
      options?.ifExists ? 'IF EXISTS' : '',
      this.dialect.escapeId(constraintName),
      options?.cascade ? 'CASCADE' : '',
    ]);
  }

  setConstraintCheckingQuery(type: ConstraintChecking): string;
  setConstraintCheckingQuery(type: Class<ConstraintChecking>, constraints?: readonly string[]): string;
  setConstraintCheckingQuery(type: ConstraintChecking | Class<ConstraintChecking>, constraints?: readonly string[]) {
    let constraintFragment = 'ALL';
    if (type instanceof ConstraintChecking) {
      if (type.constraints?.length) {
        constraintFragment = type.constraints.map((constraint) => this.dialect.escapeId(constraint)).join(', ');
      }

      return `SET CONSTRAINTS ${constraintFragment} ${type.toString()}`;
    }

    if (constraints?.length) {
      constraintFragment = constraints.map((constraint) => this.dialect.escapeId(constraint)).join(', ');
    }

    return `SET CONSTRAINTS ${constraintFragment} ${type.toString()}`;
  }

  showConstraintsQuery(_tableName: string, _options?: ShowConstraintsQueryOptions): string {
    throw new TypeError(`showConstraintsQuery has not been implemented in dialect.`);
  }

  showIndexesQuery(_tableName: string): string {
    throw new TypeError(`showIndexesQuery has not been implemented in dialect.`);
  }

  removeIndexQuery(
    _tableName: string,
    _indexNameOrAttributes: string | string[],
    _options?: RemoveIndexQueryOptions,
  ): string {
    throw new TypeError(`removeIndexQuery has not been implemented in dialect.`);
  }
}
