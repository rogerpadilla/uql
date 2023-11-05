import { QueryFilter } from 'nukak/type';
import type { IndexHintable, ReferentialAction } from '../../model';
import type { BindOrReplacements } from '../../sequelize';
import type { TableHints } from './utils/table-hints.js';
import type { Nullish } from './utils/types.js';
import type { Deferrable } from './utils/deferrable.js';
import type { ConstraintType } from './query-interface.types.js';

export interface QueryWithBindParams {
  query: string;
  bind: BindOrReplacements;
}

// keep CREATE_DATABASE_QUERY_SUPPORTABLE_OPTIONS updated when modifying this
export interface CreateDatabaseQueryOptions {
  charset?: string;
  collate?: string;
  ctype?: string;
  encoding?: string;
  template?: string;
}

// keep LIST_DATABASES_QUERY_SUPPORTABLE_OPTIONS updated when modifying this
export interface ListDatabasesQueryOptions {
  skip?: string[];
}

export interface ListSchemasQueryOptions {
  /** List of schemas to exclude from output */
  skip?: string[];
}

// keep DROP_TABLE_QUERY_SUPPORTABLE_OPTIONS updated when modifying this
export interface DropTableQueryOptions {
  cascade?: boolean;
}

// keep RENAME_TABLE_QUERY_SUPPORTABLE_OPTIONS updated when modifying this
export interface RenameTableQueryOptions {
  changeSchema?: boolean;
}

// keep REMOVE_COLUMN_QUERY_SUPPORTABLE_OPTIONS updated when modifying this
export interface RemoveColumnQueryOptions {
  cascade?: boolean;
  ifExists?: boolean;
}

export interface BaseConstraintQueryOptions {
  name?: string;
  type: ConstraintType;
  fields: Array<string | { attribute?: string; name: string }>;
}

export interface AddCheckConstraintQueryOptions extends BaseConstraintQueryOptions {
  type: 'CHECK';
  where?: QueryFilter<any>;
}
export interface AddDefaultConstraintQueryOptions extends BaseConstraintQueryOptions {
  type: 'DEFAULT';
  defaultValue?: unknown;
}

export interface AddUniqueConstraintQueryOptions extends BaseConstraintQueryOptions {
  type: 'UNIQUE';
  deferrable?: Deferrable;
}

export interface AddPrimaryKeyConstraintQueryOptions extends BaseConstraintQueryOptions {
  type: 'PRIMARY KEY';
  deferrable?: Deferrable;
}

export interface AddForeignKeyConstraintQueryOptions extends BaseConstraintQueryOptions {
  type: 'FOREIGN KEY';
  references:
    | {
        table: string;
        field?: string;
        fields: string[];
      }
    | {
        table: string;
        field: string;
        fields?: string[];
      };
  onDelete?: ReferentialAction;
  onUpdate?: ReferentialAction;
  deferrable?: Deferrable;
}

export type AddConstraintQueryOptions =
  | AddCheckConstraintQueryOptions
  | AddUniqueConstraintQueryOptions
  | AddDefaultConstraintQueryOptions
  | AddPrimaryKeyConstraintQueryOptions
  | AddForeignKeyConstraintQueryOptions;

export interface GetConstraintSnippetQueryOptions {
  name?: string;
  type: ConstraintType;
  fields: string[];
  where?: QueryFilter<any>;
  defaultValue?: unknown;
  references?:
    | {
        table: string;
        field?: string;
        fields: string[];
      }
    | {
        table: string;
        field: string;
        fields?: string[];
      };
  onDelete?: ReferentialAction;
  onUpdate?: ReferentialAction;
  deferrable?: Deferrable;
}

// keep REMOVE_CONSTRAINT_QUERY_SUPPORTABLE_OPTIONS updated when modifying this
export interface RemoveConstraintQueryOptions {
  ifExists?: boolean;
  cascade?: boolean;
}

// keep SHOW_CONSTRAINTS_QUERY_SUPPORTABLE_OPTIONS updated when modifying this
export interface ShowConstraintsQueryOptions {
  columnName?: string;
  constraintName?: string;
  constraintType?: ConstraintType;
}

export interface AttributeToSqlOptions {
  context: 'addColumn' | 'changeColumn' | 'createTable';
  schema?: string;
  table: string;
  withoutForeignKeyConstraints?: boolean;
}

export interface QuoteTableOptions extends IndexHintable {
  alias: boolean | string;
  tableHints?: TableHints[];
}

export interface AddLimitOffsetOptions {
  limit?: Nullish<number>;
  offset?: Nullish<number>;
  replacements?: BindOrReplacements;
}
