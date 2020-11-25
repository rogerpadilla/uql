import { QuerierPoolOptions } from './querierPool';

export type DatasourceDriver = 'mysql' | 'mysql2' | 'mariadb' | 'pg' | 'sqlite3' | 'mongodb';

export type DatasourceOptions = { driver: DatasourceDriver } & QuerierPoolOptions;

export type Logger = (message?: any, ...optionalParams: any[]) => any;

export type UqlOptions = {
  datasource?: DatasourceOptions;
  logger?: Logger;
  debug?: boolean;
};
