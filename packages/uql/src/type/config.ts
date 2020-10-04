import { QuerierPoolOptions } from './querier';
import { GenericRepositoryConstructor } from './repository';

export type DatasourceDriver = 'mysql' | 'mysql2' | 'mariadb' | 'pg' | 'sqlite3' | 'mongodb';

export type DatasourceOptions = { driver: DatasourceDriver } & QuerierPoolOptions;

export type UqlOptions = {
  autoCount?: boolean;
  datasource?: DatasourceOptions;
  defaultRepositoryClass?: GenericRepositoryConstructor<any>;
  logger?: UqlLogger;
  loggingLevel?: UqlLoggingLevel;
};

export type UqlLogger = {
  debug(message?: any, ...optionalParams: any[]): any;
  info(message?: any, ...optionalParams: any[]): any;
  warn(message?: any, ...optionalParams: any[]): any;
  error(message?: any, ...optionalParams: any[]): any;
};

export type UqlLoggingLevel = 'debug' | 'info' | 'warn' | 'error' | number;
