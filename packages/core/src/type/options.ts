import { QuerierPoolOptions, QuerierPoolSqlite3Options } from './querierPool';

type DatasourceDriver = 'mysql2' | 'mariadb' | 'pg' | 'sqlite3' | 'mongodb';

export type DatasourceOptions =
  | ({ driver: Exclude<DatasourceDriver, 'sqlite3'> } & QuerierPoolOptions)
  | ({ driver: Extract<DatasourceDriver, 'sqlite3'> } & QuerierPoolSqlite3Options);

export type Logger = (message: any, ...optionalParams: any[]) => any;

export type UqlOptions = {
  datasource?: DatasourceOptions;
  logger?: Logger;
  debug?: boolean;
};
