import { QuerierPoolOptions } from './querierPool';

export type DatasourceDriver = 'mysql' | 'mysql2' | 'mariadb' | 'pg' | 'sqlite3' | 'mongodb';

export type DatasourceOptions = { driver: DatasourceDriver } & QuerierPoolOptions;

export type UqlOptions = {
  autoCount?: boolean;
  datasource?: DatasourceOptions;
  logger?: UqlLogger;
  debug?: boolean;
};

export type UqlLogger = (message?: any, ...optionalParams: any[]) => any;
