import type { Deferrable } from './utils/deferrable.js';
import type { CreateSchemaQueryOptions } from './query-generator.js';
import type {
  AddConstraintQueryOptions,
  CreateDatabaseQueryOptions,
  ListDatabasesQueryOptions,
  ListSchemasQueryOptions,
  RemoveColumnQueryOptions,
  RemoveConstraintQueryOptions,
  RenameTableQueryOptions,
  ShowConstraintsQueryOptions,
} from './query-generator.types.js';

export interface DatabaseDescription {
  name: string;
}

export interface ColumnDescription {
  type: string;
  allowNull: boolean;
  defaultValue: string;
  primaryKey: boolean;
  autoIncrement: boolean;
  comment: string | null;
}

export type ColumnsDescription = Record<string, ColumnDescription>;

export type ConstraintType = 'CHECK' | 'DEFAULT' | 'FOREIGN KEY' | 'PRIMARY KEY' | 'UNIQUE';

export interface RawConstraintDescription {
  constraintCatalog?: string;
  constraintSchema: string;
  constraintName: string;
  constraintType: ConstraintType;
  tableCatalog?: string;
  tableSchema: string;
  tableName: string;
  columnNames?: string;
  referencedTableSchema?: string;
  referencedTableName?: string;
  referencedColumnNames?: string;
  deleteAction?: string;
  updateAction?: string;
  definition?: string;
  isDeferrable?: string;
  initiallyDeferred?: string;
}

export interface ConstraintDescription {
  constraintCatalog?: string;
  constraintSchema: string;
  constraintName: string;
  constraintType: ConstraintType;
  tableCatalog?: string;
  tableSchema: string;
  tableName: string;
  columnNames?: string[];
  referencedTableSchema?: string;
  referencedTableName?: string;
  referencedColumnNames?: string[];
  deleteAction?: string;
  updateAction?: string;
  definition?: string;
  deferrable?: Deferrable;
}

/** Options accepted by {@link AbstractQueryInterface#createDatabase} */
export interface CreateDatabaseOptions extends CreateDatabaseQueryOptions {}

/** Options accepted by {@link AbstractQueryInterface#listDatabases} */
export interface ListDatabasesOptions extends ListDatabasesQueryOptions {}

/** Options accepted by {@link AbstractQueryInterface#createSchema} */
export interface CreateSchemaOptions extends CreateSchemaQueryOptions {}

/** Options accepted by {@link AbstractQueryInterface#listSchemas} */
export interface QiListSchemasOptions extends ListSchemasQueryOptions {}

/** Options accepted by {@link AbstractQueryInterface#dropAllSchemas} */
export interface QiDropAllSchemasOptions {
  /**
   * List of schemas to skip dropping (i.e., list of schemas to keep)
   */
  skip?: string[];
}

/** Options accepted by {@link AbstractQueryInterface#renameTable} */
export interface RenameTableOptions extends RenameTableQueryOptions {}

/** Options accepted by {@link AbstractQueryInterface#removeColumn} */
export interface RemoveColumnOptions extends RemoveColumnQueryOptions {}

/** Options accepted by {@link AbstractQueryInterface#addConstraint} */
export type AddConstraintOptions = AddConstraintQueryOptions;

/** Options accepted by {@link AbstractQueryInterface#deferConstraints} */
export interface DeferConstraintsOptions {}

/** Options accepted by {@link AbstractQueryInterface#removeConstraint} */
export interface RemoveConstraintOptions extends RemoveConstraintQueryOptions {}

/** Options accepted by {@link AbstractQueryInterface#showConstraints} */
export interface ShowConstraintsOptions extends ShowConstraintsQueryOptions {}
