import { QuerierPool } from './querierPool';

export type Logger = (message: any, ...args: any[]) => any;

export type UqlOptions<T extends QuerierPool = QuerierPool> = {
  querierPool: T;
};
