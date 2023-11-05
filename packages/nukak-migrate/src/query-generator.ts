/* eslint-disable complexity */
import { compact } from 'lodash';
import { BaseSqlExpression } from '../../expression-builders/base-sql-expression.js';
import { Literal } from '../../expression-builders/literal.js';
import { conformIndex } from '../../model-internals';
import { nameIndex } from '../../utils/string';
import { AbstractQueryGeneratorTypeScript } from './query-generator-typescript.js';

export const CREATE_SCHEMA_QUERY_SUPPORTABLE_OPTIONS = new Set(['collate', 'charset']);
export const CREATE_TABLE_QUERY_SUPPORTABLE_OPTIONS = new Set([
  'collate',
  'charset',
  'engine',
  'rowFormat',
  'comment',
  'initialAutoIncrement',
  'uniqueKeys',
]);
export const ADD_COLUMN_QUERY_SUPPORTABLE_OPTIONS = new Set(['ifNotExists']);

/**
 * Abstract Query Generator
 *
 * @private
 */
export class AbstractQueryGenerator extends AbstractQueryGeneratorTypeScript {
  /*
    Returns an add index query.
    Parameters:
      - tableName -> Name of an existing table, possibly with schema.
      - options:
        - type: UNIQUE|FULLTEXT|SPATIAL
        - name: The name of the index. Default is <table>_<attr1>_<attr2>
        - fields: An array of attributes as string or as hash.
                  If the attribute is a hash, it must have the following content:
                  - name: The name of the attribute/column
                  - length: An integer. Optional
                  - order: 'ASC' or 'DESC'. Optional
        - parser
        - using
        - operator
        - concurrently: Pass CONCURRENT so other operations run while the index is created
        - include
      - rawTablename, the name of the table, without schema. Used to create the name of the index
   @private
  */
  addIndexQuery(tableName, attributes, options, rawTablename) {
    options = options || {};

    if (!Array.isArray(attributes)) {
      options = attributes;
      attributes = undefined;
    } else {
      options.fields = attributes;
    }

    options.prefix = options.prefix || rawTablename || tableName;
    if (options.prefix && typeof options.prefix === 'string') {
      options.prefix = options.prefix.replaceAll('.', '_');
    }

    const fieldsSql = options.fields.map((field) => {
      if (field instanceof BaseSqlExpression) {
        return this.formatSqlExpression(field);
      }

      if (typeof field === 'string') {
        field = {
          name: field,
        };
      }

      let result = '';

      if (field.attribute) {
        field.name = field.attribute;
      }

      if (!field.name) {
        throw new Error(`The following index field has no name: ${util.inspect(field)}`);
      }

      result += this.quoteIdentifier(field.name);

      if (this.dialect.supports.index.collate && field.collate) {
        result += ` COLLATE ${this.quoteIdentifier(field.collate)}`;
      }

      if (this.dialect.supports.index.operator) {
        const operator = field.operator || options.operator;
        if (operator) {
          result += ` ${operator}`;
        }
      }

      if (this.dialect.supports.index.length > 0 && field.length > 0) {
        result += `(${field.length})`;
      }

      if (field.order) {
        result += ` ${field.order}`;
      }

      return result;
    });

    let includeSql;
    if (options.include) {
      if (!this.dialect.supports.index.include) {
        throw new Error(`The include attribute for indexes is not supported by ${this.dialect.name} dialect`);
      }

      if (options.include instanceof Literal) {
        includeSql = `INCLUDE ${options.include.val}`;
      } else if (Array.isArray(options.include)) {
        includeSql = `INCLUDE (${options.include
          .map((field) => (field instanceof Literal ? field.val : this.quoteIdentifier(field)))
          .join(', ')})`;
      } else {
        throw new TypeError('The include attribute for indexes must be an array or a literal.');
      }
    }

    if (!options.name) {
      // Mostly for cases where addIndex is called directly by the user without an options object (for example in migrations)
      // All calls that go through sequelize should already have a name
      options = nameIndex(options, options.prefix);
    }

    options = conformIndex(options);

    if (!this.dialect.supports.index.type) {
      delete options.type;
    }

    if (options.where) {
      options.where = this.whereQuery(options.where);
    }

    const escapedTableName = this.quoteTable(tableName);

    const concurrently = this.dialect.supports.index.concurrently && options.concurrently ? 'CONCURRENTLY' : undefined;
    let ind;
    if (this.dialect.supports.indexViaAlter) {
      ind = ['ALTER TABLE', escapedTableName, concurrently, 'ADD'];
    } else {
      ind = ['CREATE'];
    }

    // DB2 incorrectly scopes the index if we don't specify the schema name,
    // which will cause it to error if another schema contains a table that uses an index with an identical name
    const escapedIndexName =
      tableName.schema && this.dialect.name === 'db2'
        ? // 'quoteTable' isn't the best name: it quotes any identifier.
          // in this case, the goal is to produce '"schema_name"."index_name"' to scope the index in this schema
          this.quoteTable({
            schema: tableName.schema,
            tableName: options.name,
          })
        : this.quoteIdentifiers(options.name);

    ind = ind.concat(
      options.unique ? 'UNIQUE' : '',
      options.type,
      'INDEX',
      !this.dialect.supports.indexViaAlter ? concurrently : undefined,
      escapedIndexName,
      this.dialect.supports.index.using === 1 && options.using ? `USING ${options.using}` : '',
      !this.dialect.supports.indexViaAlter ? `ON ${escapedTableName}` : undefined,
      this.dialect.supports.index.using === 2 && options.using ? `USING ${options.using}` : '',
      `(${fieldsSql.join(', ')})`,
      this.dialect.supports.index.parser && options.parser ? `WITH PARSER ${options.parser}` : undefined,
      this.dialect.supports.index.include && options.include ? includeSql : undefined,
      this.dialect.supports.index.where && options.where ? options.where : undefined,
    );

    return compact(ind).join(' ');
  }
}

// keep CREATE_SCHEMA_QUERY_SUPPORTABLE_OPTIONS updated when modifying this
export interface CreateSchemaQueryOptions {
  collate?: string;
  charset?: string;
}

// keep ADD_COLUMN_QUERY_SUPPORTABLE_OPTIONS updated when modifying this
export interface AddColumnQueryOptions {
  ifNotExists?: boolean;
}
