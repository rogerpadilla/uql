import { cloneDeep, mapValues } from 'lodash';

import type { SetRequired } from 'type-fest';
import { QueryFilter } from 'nukak/type';
import type { Col } from '../../expression-builders/col.js';
import type { Fn } from '../../expression-builders/fn.js';
import type { Literal } from '../../expression-builders/literal.js';
import type { AttributeOptions, CreationAttributes, Filterable, Model } from '../../model';
import type { QueryRawOptions, QueryRawOptionsWithModel, Sequelize } from '../../sequelize';
import type { AllowLowercase, Nullish } from './utils/types.js';
import * as DataTypes from './data-types.js';
import { AbstractDataType } from './data-types.js';
import { AbstractQueryInterfaceTypeScript } from './query-interface-typescript.js';
import type { DataType } from './data-types.js';
import type { RemoveIndexQueryOptions } from './query-generator-typescript.js';
import type { AbstractQueryGenerator, AddColumnQueryOptions } from './query-generator.js';
import type { AddLimitOffsetOptions } from './query-generator.types.js';
import type { ColumnsDescription, QiDropAllSchemasOptions } from './query-interface.types.js';

/**
 * The interface that Sequelize uses to talk to all databases
 */
export class AbstractQueryInterface extends AbstractQueryInterfaceTypeScript implements AbstractQueryInterface0 {
  /**
   * Create a table with given set of attributes
   *
   * ```js
   * queryInterface.createTable(
   *   'nameOfTheNewTable',
   *   {
   *     id: {
   *       type: DataTypes.INTEGER,
   *       primaryKey: true,
   *       autoIncrement: true
   *     },
   *     createdAt: {
   *       type: DataTypes.DATE
   *     },
   *     updatedAt: {
   *       type: DataTypes.DATE
   *     },
   *     attr1: DataTypes.STRING,
   *     attr2: DataTypes.INTEGER,
   *     attr3: {
   *       type: DataTypes.BOOLEAN,
   *       defaultValue: false,
   *       allowNull: false
   *     },
   *     //foreign key usage
   *     attr4: {
   *       type: DataTypes.INTEGER,
   *       references: {
   *         model: 'another_table_name',
   *         key: 'id'
   *       },
   *       onUpdate: 'cascade',
   *       onDelete: 'cascade'
   *     }
   *   },
   *   {
   *     engine: 'MYISAM',    // default: 'InnoDB'
   *     charset: 'latin1',   // default: null
   *     schema: 'public',    // default: public, PostgreSQL only.
   *     comment: 'my table', // comment for table
   *     collate: 'latin1_danish_ci' // collation, MYSQL only
   *   }
   * )
   * ```
   *
   * @param {string} tableName  Name of table to create
   * @param {object} attributes Object representing a list of table attributes to create
   * @param {object} [options] create table and query options
   * @param {Model}  [model] model class
   *
   * @returns {Promise}
   */
  // TODO: remove "schema" option from the option bag, it must be passed as part of "tableName" instead
  async createTable(tableName: string, attributes, options) {
    options = { ...options };

    attributes = mapValues(attributes, (attribute) => this.sequelize.normalizeAttribute(attribute));

    attributes = this.dialect.attributesToSQL(attributes, {
      table: tableName,
      context: 'createTable',
      withoutForeignKeyConstraints: options.withoutForeignKeyConstraints,
      // schema override for multi-tenancy
      schema: options.schema,
    });

    const sql = this.dialect.createTableQuery(tableName, attributes, options);

    return await this.sequelize.queryRaw(sql, options);
  }

  /**
   * Add a new column to a table
   *
   * ```js
   * queryInterface.addColumn('tableA', 'columnC', DataTypes.STRING, {
   *    after: 'columnB' // after option is only supported by MySQL
   * });
   * ```
   *
   * @param {string} table     Table to add column to
   * @param {string} key       Column name
   * @param {object} attribute Attribute definition
   * @param {object} [options] Query options
   *
   * @returns {Promise}
   */
  async addColumn(table: string, key: string, attribute, options = {}) {
    if (!table || !key || !attribute) {
      throw new Error('addColumn takes at least 3 arguments (table, attribute name, attribute definition)');
    }

    attribute = this.sequelize.normalizeAttribute(attribute);

    if (
      attribute.type instanceof AbstractDataType &&
      // we don't give a context if it already has one, because it could come from a Model.
      !attribute.type.usageContext
    ) {
      attribute.type.attachUsageContext({ tableName: table, columnName: key, sequelize: this.sequelize });
    }

    const { ifNotExists, ...rawQueryOptions } = options;
    const addColumnQueryOptions = ifNotExists ? { ifNotExists } : undefined;

    return await this.sequelize.queryRaw(
      this.dialect.addColumnQuery(table, key, attribute, addColumnQueryOptions),
      rawQueryOptions,
    );
  }

  /**
   * Remove a column from a table
   *
   * @param {string} tableName      Table to remove column from
   * @param {string} attributeName  Column name to remove
   * @param {object} [options]      Query options
   */

  normalizeAttribute(dataTypeOrOptions) {
    let attribute;
    if (Object.values(DataTypes).includes(dataTypeOrOptions)) {
      attribute = { type: dataTypeOrOptions, allowNull: true };
    } else {
      attribute = dataTypeOrOptions;
    }

    return this.sequelize.normalizeAttribute(attribute);
  }

  /**
   * Change a column definition
   *
   * @param {string} tableName          Table name to change from
   * @param {string} attributeName      Column name
   * @param {object} dataTypeOrOptions  Attribute definition for new column
   * @param {object} [options]          Query options
   */
  async changeColumn(tableName: string, attributeName: string, dataTypeOrOptions, options) {
    options = options || {};

    const query = this.dialect.attributesToSQL(
      {
        [attributeName]: this.normalizeAttribute(dataTypeOrOptions),
      },
      {
        context: 'changeColumn',
        table: tableName,
      },
    );
    const sql = this.dialect.changeColumnQuery(tableName, query);

    return this.sequelize.queryRaw(sql, options);
  }

  /**
   * Rejects if the table doesn't have the specified column, otherwise returns the column description.
   *
   * @param {string} tableName
   * @param {string} columnName
   * @param {object} options
   * @private
   */
  // TODO: rename to "describeColumn"
  async assertTableHasColumn(tableName: string, columnName: string, options) {
    const description = await this.describeTable(tableName, options);
    if (description[columnName]) {
      return description;
    }

    throw new Error(`Table ${tableName} doesn't have the column ${columnName}`);
  }

  /**
   * Rename a column
   *
   * @param {string} tableName        Table name whose column to rename
   * @param {string} attrNameBefore   Current column name
   * @param {string} attrNameAfter    New column name
   * @param {object} [options]        Query option
   *
   * @returns {Promise}
   */
  async renameColumn(tableName: string, attrNameBefore, attrNameAfter, options) {
    options = options || {};
    const data = (await this.assertTableHasColumn(tableName, attrNameBefore, options))[attrNameBefore];

    const _options = {};

    _options[attrNameAfter] = {
      attribute: attrNameAfter,
      type: data.type,
      allowNull: data.allowNull,
      defaultValue: data.defaultValue,
    };

    // fix: a not-null column cannot have null as default value
    if (data.defaultValue === null && !data.allowNull) {
      delete _options[attrNameAfter].defaultValue;
    }

    const sql = this.dialect.renameColumnQuery(tableName, attrNameBefore, this.dialect.attributesToSQL(_options));

    return await this.sequelize.queryRaw(sql, options);
  }

  /**
   * Add an index to a column
   *
   * @param {string|object}  tableName Table name to add index on, can be a object with schema
   * @param {Array}   [attributes]     Use options.fields instead, List of attributes to add index on
   * @param {object}  options          indexes options
   * @param {Array}   options.fields   List of attributes to add index on
   * @param {boolean} [options.concurrently] Pass CONCURRENT so other operations run while the index is created
   * @param {boolean} [options.unique] Create a unique index
   * @param {string}  [options.using]  Useful for GIN indexes
   * @param {string}  [options.operator] Index operator
   * @param {string}  [options.type]   Type of index, available options are UNIQUE|FULLTEXT|SPATIAL
   * @param {string}  [options.name]   Name of the index. Default is <table>_<attr1>_<attr2>
   * @param {object}  [options.where]  Where condition on index, for partial indexes
   * @param {string}  [rawTablename]   table name, this is just for backward compatibiity
   *
   * @returns {Promise}
   */
  async addIndex(tableName: string, attributes, options, rawTablename) {
    // Support for passing tableName, attributes, options or tableName, options (with a fields param which is the attributes)
    if (!Array.isArray(attributes)) {
      rawTablename = options;
      options = attributes;
      attributes = options.fields;
    }

    if (!rawTablename) {
      // Map for backwards compat
      rawTablename = tableName;
    }

    options = cloneDeep(options) ?? {};
    options.fields = attributes;
    const sql = this.dialect.addIndexQuery(tableName, options, rawTablename);

    return await this.sequelize.queryRaw(sql, { ...options, supportsSearchPath: false });
  }

  /**
   * Show indexes on a table
   *
   * @param {TableNameOrModel} tableName
   * @param {object}    [options] Query options
   *
   * @returns {Promise<Array>}
   * @private
   */
  async showIndex(tableName: string, options) {
    const sql = this.dialect.showIndexesQuery(tableName, options);

    return await this.sequelize.queryRaw(sql, { ...options, type: QueryTypes.SHOWINDEXES });
  }

  /**
   * Remove an already existing index from a table
   *
   * @param {string} tableName                    Table name to drop index from
   * @param {string|string[]} indexNameOrAttributes  Index name or list of attributes that in the index
   * @param {object} [options]                    Query options
   * @param {boolean} [options.concurrently]      Pass CONCURRENTLY so other operations run while the index is created
   *
   * @returns {Promise}
   */
  async removeIndex(tableName: string, indexNameOrAttributes, options) {
    options = options || {};
    const sql = this.dialect.removeIndexQuery(tableName, indexNameOrAttributes, options);

    return await this.sequelize.queryRaw(sql, options);
  }

  async createTrigger(
    tableName: string,
    triggerName,
    timingType,
    fireOnArray,
    functionName,
    functionParams,
    optionsArray,
    options,
  ) {
    const sql = this.dialect.createTrigger(
      tableName,
      triggerName,
      timingType,
      fireOnArray,
      functionName,
      functionParams,
      optionsArray,
    );
    options = options || {};
    if (sql) {
      return await this.sequelize.queryRaw(sql, options);
    }
  }

  async dropTrigger(tableName: string, triggerName, options) {
    const sql = this.dialect.dropTrigger(tableName, triggerName);
    options = options || {};

    if (sql) {
      return await this.sequelize.queryRaw(sql, options);
    }
  }

  async renameTrigger(tableName: string, oldTriggerName, newTriggerName, options) {
    const sql = this.dialect.renameTrigger(tableName, oldTriggerName, newTriggerName);
    options = options || {};

    if (sql) {
      return await this.sequelize.queryRaw(sql, options);
    }
  }

  /**
   * Create an SQL function
   *
   * @example
   * queryInterface.createFunction(
   *   'someFunction',
   *   [
   *     {type: 'integer', name: 'param', direction: 'IN'}
   *   ],
   *   'integer',
   *   'plpgsql',
   *   'RETURN param + 1;',
   *   [
   *     'IMMUTABLE',
   *     'LEAKPROOF'
   *   ],
   *   {
   *    variables:
   *      [
   *        {type: 'integer', name: 'myVar', default: 100}
   *      ],
   *      force: true
   *   };
   * );
   *
   * @param {string}  functionName  Name of SQL function to create
   * @param {Array}   params        List of parameters declared for SQL function
   * @param {string}  returnType    SQL type of function returned value
   * @param {string}  language      The name of the language that the function is implemented in
   * @param {string}  body          Source code of function
   * @param {Array}   optionsArray  Extra-options for creation
   * @param {object}  [options]     query options
   * @param {boolean} options.force If force is true, any existing functions with the same parameters will be replaced. For postgres, this means using `CREATE OR REPLACE FUNCTION` instead of `CREATE FUNCTION`. Default is false
   * @param {Array<object>}   options.variables List of declared variables. Each variable should be an object with string fields `type` and `name`, and optionally having a `default` field as well.
   *
   * @returns {Promise}
   */
  async createFunction(functionName: string, params, returnType, language, body, optionsArray, options) {
    const sql = this.dialect.createFunction(functionName, params, returnType, language, body, optionsArray, options);
    options = options || {};

    if (sql) {
      return await this.sequelize.queryRaw(sql, options);
    }
  }

  /**
   * Drop an SQL function
   *
   * @example
   * queryInterface.dropFunction(
   *   'someFunction',
   *   [
   *     {type: 'varchar', name: 'param1', direction: 'IN'},
   *     {type: 'integer', name: 'param2', direction: 'INOUT'}
   *   ]
   * );
   *
   * @param {string} functionName Name of SQL function to drop
   * @param {Array}  params       List of parameters declared for SQL function
   * @param {object} [options]    query options
   *
   * @returns {Promise}
   */
  async dropFunction(functionName: string, params, options) {
    const sql = this.dialect.dropFunction(functionName, params);
    options = options || {};

    if (sql) {
      return await this.sequelize.queryRaw(sql, options);
    }
  }

  /**
   * Rename an SQL function
   *
   * @example
   * queryInterface.renameFunction(
   *   'fooFunction',
   *   [
   *     {type: 'varchar', name: 'param1', direction: 'IN'},
   *     {type: 'integer', name: 'param2', direction: 'INOUT'}
   *   ],
   *   'barFunction'
   * );
   *
   * @param {string} oldFunctionName  Current name of function
   * @param {Array}  params           List of parameters declared for SQL function
   * @param {string} newFunctionName  New name of function
   * @param {object} [options]        query options
   *
   * @returns {Promise}
   */
  async renameFunction(oldFunctionName, params, newFunctionName, options) {
    const sql = this.dialect.renameFunction(oldFunctionName, params, newFunctionName);
    options = options || {};

    if (sql) {
      return await this.sequelize.queryRaw(sql, options);
    }
  }
}

interface Replaceable {
  /**
   * Only named replacements are allowed in query interface methods.
   */
  replacements?: { [key: string]: unknown };
}

interface QiOptionsWithReplacements extends QueryRawOptions, Replaceable {}

export interface QiInsertOptions extends QueryRawOptions, Replaceable {
  returning?: boolean | Array<string | Literal | Col>;
}

export interface QiSelectOptions extends QueryRawOptions, Filterable<any>, AddLimitOffsetOptions {
  minifyAliases?: boolean;
}

export interface QiUpdateOptions extends QueryRawOptions, Replaceable {
  returning?: boolean | Array<string | Literal | Col>;
}

export interface QiDeleteOptions extends QueryRawOptions, Replaceable {
  limit?: Nullish<number | Literal>;
}

export interface QiArithmeticOptions extends QueryRawOptions, Replaceable {
  returning?: boolean | Array<string | Literal | Col>;
}

export interface QiUpsertOptions<M extends Model> extends QueryRawOptionsWithModel<M>, Replaceable {}

export interface CreateFunctionOptions extends QueryRawOptions {
  force?: boolean;
}

export interface CollateCharsetOptions {
  collate?: string;
  charset?: string;
}

export interface QueryInterfaceCreateTableOptions extends QueryRawOptions, CollateCharsetOptions {
  engine?: string;
  /**
   * Used for compound unique keys.
   */
  uniqueKeys?: { [indexName: string]: { fields: string[] } };
}

export interface TableNameWithSchema {
  tableName: string;
  schema?: string;
  delimiter?: string;
}

export type TableName = string | TableNameWithSchema;

export type IndexType = AllowLowercase<'UNIQUE' | 'FULLTEXT' | 'SPATIAL'>;
export type IndexMethod = 'BTREE' | 'HASH' | 'GIST' | 'SPGIST' | 'GIN' | 'BRIN' | string;

export interface IndexField {
  /**
   * The name of the column
   */
  name: string;

  /**
   * Create a prefix index of length chars
   */
  length?: number;

  /**
   * The direction the column should be sorted in
   */
  order?: 'ASC' | 'DESC';

  /**
   * The collation (sort order) for the column
   */
  collate?: string;

  /**
   * Index operator type. Postgres only
   */
  operator?: string;
}

export interface IndexOptions {
  /**
   * The name of the index. Defaults to model name + _ + fields concatenated
   */
  name?: string;

  /** For FULLTEXT columns set your parser */
  parser?: string | null;

  /**
   * Index type. Only used by mysql. One of `UNIQUE`, `FULLTEXT` and `SPATIAL`
   */
  type?: IndexType | undefined;

  /**
   * Should the index by unique? Can also be triggered by setting type to `UNIQUE`
   *
   * @default false
   */
  unique?: boolean;

  /**
   * The message to display if the unique constraint is violated.
   */
  msg?: string;

  /**
   * PostgreSQL will build the index without taking any write locks. Postgres only.
   *
   * @default false
   */
  concurrently?: boolean;

  /**
   * The fields to index.
   */
  // TODO: rename to "columns"
  fields?: Array<string | IndexField | Fn | Literal>;

  /**
   * The method to create the index by (`USING` statement in SQL).
   * BTREE and HASH are supported by mysql and postgres.
   * Postgres additionally supports GIST, SPGIST, BRIN and GIN.
   */
  using?: IndexMethod;

  /**
   * Index operator type. Postgres only
   */
  operator?: string;

  /**
   * Optional where parameter for index. Can be used to limit the index to certain rows.
   */
  where?: QueryFilter<unknown>;

  /**
   * Prefix to append to the index name.
   */
  prefix?: string;

  /**
   * Non-key columns to be added to the lead level of the nonclustered index.
   */
  include?: Literal | Array<string | Literal>;
}

export interface QueryInterfaceIndexOptions extends IndexOptions, Omit<QiOptionsWithReplacements, 'type'> {}

export interface QueryInterfaceRemoveIndexOptions extends QueryInterfaceIndexOptions, RemoveIndexQueryOptions {}

export interface FunctionParam {
  type: string;
  name?: string;
  direction?: string;
}

export interface IndexFieldDescription {
  attribute: string;
  length: number | undefined;
  order: 'DESC' | 'ASC';
  collate: string | undefined;
}

export interface IndexDescription {
  primary: boolean;
  fields: IndexFieldDescription[];
  includes: string[] | undefined;
  name: string;
  tableName: string | undefined;
  unique: boolean;
  type: string | undefined;
}

export interface AddColumnOptions extends AddColumnQueryOptions, QueryRawOptions, Replaceable {}

export interface CreateTableAttributeOptions<M extends Model = Model> extends AttributeOptions<M> {
  /**
   * Apply unique constraint on a column
   */
  unique?: boolean;
}

/**
 * Interface for Attributes provided for all columns in a model
 */
export type CreateTableAttributes<M extends Model = Model, TAttributes = any> = {
  /**
   * The description of a database column
   */
  [name in keyof TAttributes]: DataType | CreateTableAttributeOptions<M>;
};

/**
 * This interface exposes low-level APIs to interact with the database.
 * Typically useful in contexts where models are not available, such as migrations.
 *
 * This interface is available through {@link Sequelize#queryInterface}.
 */
interface AbstractQueryInterface0 extends AbstractQueryInterfaceTypeScript {
  /**
   * Returns the dialect-specific sql generator.
   *
   * We don't have a definition for the QueryGenerator, because I doubt it is commonly in use separately.
   */
  dialect: AbstractQueryGenerator;

  /**
   * Returns the current sequelize instance.
   */
  sequelize: Sequelize;

  /**
   * Drops all tables
   */
  dropAllSchemas(options?: QiDropAllSchemasOptions): Promise<void>;

  /**
   * Creates a table with specified attributes.
   *
   * @param tableName     Name of table to create
   * @param attributes    Hash of attributes, key is attribute name, value is data type
   * @param options       Table options.
   */
  createTable<M extends Model>(
    tableName: TableName,
    attributes: CreateTableAttributes<M, CreationAttributes<M>>,
    options?: QueryInterfaceCreateTableOptions,
  ): Promise<void>;

  /**
   * Drops all defined enums
   *
   * @param options
   */
  dropAllEnums(options?: QueryRawOptions): Promise<void>;

  /**
   * Adds a new column to a table
   */
  addColumn(
    table: TableName,
    key: string,
    attribute: AttributeOptions | DataType,
    options?: AddColumnOptions,
  ): Promise<void>;

  /**
   * Changes a column
   */
  changeColumn(
    tableName: TableName,
    attributeName: string,
    dataTypeOrOptions?: DataType | AttributeOptions,
    options?: QiOptionsWithReplacements,
  ): Promise<void>;

  /**
   * Renames a column
   */
  renameColumn(
    tableName: TableName,
    attrNameBefore: string,
    attrNameAfter: string,
    options?: QiOptionsWithReplacements,
  ): Promise<void>;

  /**
   * Adds a new index to a table
   */
  addIndex(
    tableName: string,
    attributes: string[],
    options?: QueryInterfaceIndexOptions,
    rawTablename?: string,
  ): Promise<void>;
  addIndex(
    tableName: string,
    options: SetRequired<QueryInterfaceIndexOptions, 'fields'>,
    rawTablename?: string,
  ): Promise<void>;

  /**
   * Removes an index of a table
   */
  removeIndex(tableName: TableName, indexName: string, options?: QueryInterfaceRemoveIndexOptions): Promise<void>;
  removeIndex(tableName: TableName, attributes: string[], options?: QueryInterfaceRemoveIndexOptions): Promise<void>;

  /**
   * Shows the index of a table
   */
  showIndex(tableName: string, options?: QueryRawOptions): Promise<IndexDescription[]>;

  /**
   * Put a name to an index
   */
  nameIndexes(indexes: string[], rawTablename: string): Promise<void>;

  /**
   * Postgres only. Creates a trigger on specified table to call the specified function with supplied
   * parameters.
   */
  createTrigger(
    tableName: TableName,
    triggerName: string,
    timingType: string,
    fireOnArray: Array<{
      [key: string]: unknown;
    }>,
    functionName: string,
    functionParams: FunctionParam[],
    optionsArray: string[],
    options?: QiOptionsWithReplacements,
  ): Promise<void>;

  /**
   * Postgres only. Drops the specified trigger.
   */
  dropTrigger(tableName: TableName, triggerName: string, options?: QiOptionsWithReplacements): Promise<void>;

  /**
   * Postgres only. Renames a trigger
   */
  renameTrigger(
    tableName: TableName,
    oldTriggerName: string,
    newTriggerName: string,
    options?: QiOptionsWithReplacements,
  ): Promise<void>;

  /**
   * Postgres only. Create a function
   */
  createFunction(
    functionName: string,
    params: FunctionParam[],
    returnType: string,
    language: string,
    body: string,
    optionsArray?: string[],
    options?: CreateFunctionOptions,
  ): Promise<void>;

  /**
   * Postgres only. Drops a function
   */
  dropFunction(functionName: string, params: FunctionParam[], options?: QiOptionsWithReplacements): Promise<void>;

  /**
   * Postgres only. Rename a function
   */
  renameFunction(
    oldFunctionName: string,
    params: FunctionParam[],
    newFunctionName: string,
    options?: QiOptionsWithReplacements,
  ): Promise<void>;

  /**
   * Escape an identifier (e.g. a table or attribute name). If force is true, the identifier will be quoted
   * even if the `quoteIdentifiers` option is false.
   */
  quoteIdentifier(identifier: string, force?: boolean): string;

  /**
   * Split an identifier into .-separated tokens and quote each part.
   */
  quoteIdentifiers(identifiers: string): string;

  // TODO: rename to "describeColumn"
  assertTableHasColumn(
    tableName: TableNameOrModel,
    columnName: string,
    options?: QueryRawOptions,
  ): Promise<ColumnsDescription>;
}
