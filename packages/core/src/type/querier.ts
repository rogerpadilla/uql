import { CharacterEncoding } from 'crypto';
import { Type } from './utility';
import { Query, QueryCriteria, QueryFilter, QueryOne, QueryOptions, QuerySearch, QueryUnique } from './query';
import { Repository } from './repository';
import { IdValue } from './entity';
import { UniversalQuerier } from './universalQuerier';

/**
 * logger function to debug queries.
 */
export type QuerierLogger = (message: any, ...args: any[]) => any;

/**
 * Isolation levels for transactions.
 */
export type IsolationLevel = 'read uncommitted' | 'read committed' | 'repeteable read' | 'serializable';

export interface Querier extends UniversalQuerier {
  count<E>(entity: Type<E>, qm?: QuerySearch<E>): Promise<number>;

  findOneById<E>(entity: Type<E>, id: IdValue<E>, qm?: QueryUnique<E>): Promise<E>;

  findOne<E>(entity: Type<E>, qm: QueryOne<E>): Promise<E>;

  findMany<E>(entity: Type<E>, qm: Query<E>): Promise<E[]>;

  findManyAndCount<E>(entity: Type<E>, qm: Query<E>): Promise<[E[], number]>;

  insertOne<E>(entity: Type<E>, payload: E): Promise<IdValue<E>>;

  insertMany<E>(entity: Type<E>, payload: E[]): Promise<IdValue<E>[]>;

  updateOneById<E>(entity: Type<E>, id: IdValue<E>, payload: E): Promise<number>;

  updateMany<E>(entity: Type<E>, qm: QueryCriteria<E>, payload: E): Promise<number>;

  saveOne<E>(entity: Type<E>, payload: E): Promise<IdValue<E>>;

  saveMany<E>(entity: Type<E>, payload: E[]): Promise<IdValue<E>[]>;

  deleteOneById<E>(entity: Type<E>, id: IdValue<E>, opts?: QueryOptions): Promise<number>;

  deleteMany<E>(entity: Type<E>, qm: QueryCriteria<E>, opts?: QueryOptions): Promise<number>;

  getRepository<E>(entity: Type<E>): Repository<E>;

  /**
   * whether this querier is in a transaction or not.
   */
  readonly hasOpenTransaction: boolean;

  /**
   * run the given callback inside a transaction in this querier.
   */
  transaction<T>(callback: (querier?: ThisType<Querier>) => Promise<T>): Promise<T>;

  /**
   * starts a new transaction in this querier.
   */
  beginTransaction(): Promise<void>;

  /**
   * commits the currently active transaction in this querier.
   */
  commitTransaction(): Promise<void>;

  /**
   * aborts the currently active transaction in this querier.
   */
  rollbackTransaction(): Promise<void>;

  /**
   * release the querier to the pool.
   */
  release(): Promise<void>;

  /**
   * Get the names of tables.
   */
  listTables(): Promise<string[]>;

  /**
   * Creates a table.
   *
   * @param table
   */
  createTable(table: Table): Promise<void>;

  /**
   * Empty the table.
   * @param table
   */
  clearTable(table: string): Promise<void>;

  /**
   * Empty the tables.
   * @param tables
   */
  clearTables(tables?: string[]): Promise<void>;

  /**
   * Drops the specified table.
   *
   * @param table Table name.
   */
  dropTable(table: string): Promise<void>;

  /**
   * Drops tables.
   *
   * @param tables optional list of specific tabes to delete (all by default)
   */
  dropTables(tables?: string[]): Promise<void>;

  /**
   * Renames a table
   */
  renameTable(oldTable: string, newTable: string): Promise<void>;

  /**
   * Adds a new column to a table
   */
  addColumn(table: string, column: string, options: Column): Promise<void>;

  /**
   * Removes a column from a table
   */
  dropColumn(table: string, column: string): Promise<void>;

  /**
   * Changes a column
   */
  changeColumn(table: string, column: string, options?: Column): Promise<void>;

  /**
   * Renames a column
   */
  renameColumn(table: string, oldColumn: string, newColumn: string): Promise<void>;
}

/**
 * Most of the methods accept options and use only the logger property of the options. That's why the most used
 * interface type for options in a method is separated here as another interface.
 */

export type CollateCharsetOptions = {
  collate?: string;
  charset?: string;
};

export type Column = {
  type:
    | 'char'
    | 'varchar'
    | 'binary'
    | 'varbinary'
    | 'tinyblob'
    | 'tinytext'
    | 'text'
    | 'blob'
    | 'clob'
    | 'mediumtext'
    | 'mediumblob'
    | 'longtext'
    | 'longblob'
    | 'enum'
    | 'bit'
    | 'tinyint'
    | 'boolean'
    | 'bool'
    | 'varbinary'
    | 'tinyblob'
    | 'smallint'
    | 'mediumint'
    | 'int'
    | 'bigint'
    | 'serial'
    | 'bigserial'
    | 'float'
    | 'double'
    | 'double precision'
    | 'decimal'
    | 'date'
    | 'datetime'
    | 'timestamp'
    | 'time'
    | 'year';
  size?: number;
  autoIncrement?: boolean;
  decimalDigits?: number;
  values: any[];
  /**
   * Primary key flag
   */
  primary?: boolean;
  required?: boolean;
  default?: string;
  comment?: string;

  references?: {
    table: string;
    field: string;
  };
  onDelete?: string;
  onUpdate?: string;

  index?: boolean;
  unique?: boolean;
} & CollateCharsetOptions;

export type IndexType = 'index' | 'unique' | 'fulltext' | 'spatial';

export type IndexMethod = 'btree' | 'hash' | 'gist' | 'spgist' | 'gin' | 'brin' | string;

export type Index = {
  /**
   * index name. Defaults to `${table}_${fields}`
   */
  name?: string;

  /**
   * index type.
   */
  type?: IndexType;

  /**
   * index type.
   */
  method?: IndexMethod;
};

export type UniqueIndex = Omit<Index, 'type'>;

export type AddIndexConstraint = Index & {
  fields: (string | { name: string; order?: 'asc' | 'desc'; collate?: string })[];
};

export type Table = {
  name: string;
  columns: {
    [k: string]: Column;
  };
};

export type BaseConstraint = {
  name?: string;
  fields: string[];
};

export type AddCheckConstraint = BaseConstraint & {
  type: 'check';
  where?: QueryFilter<any>;
};

export type AddPrimaryKeyConstraint = BaseConstraint & {
  type: 'primary key';
};

export type AddForeignKeyConstraint = BaseConstraint & {
  type: 'foreign key';
  references?: {
    table: string;
    field: string;
  };
  onDelete: string;
  onUpdate: string;
};

export type AddConstraintOptions = AddIndexConstraint | AddCheckConstraint | AddPrimaryKeyConstraint | AddForeignKeyConstraint;
