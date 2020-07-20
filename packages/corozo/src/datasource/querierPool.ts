import { getCorozoOptions } from '../config';
import { QuerierPoolOptions, QuerierPool, DatasourceOptions, Querier } from './type';

let pool: QuerierPool;

export function getQuerier(): Promise<Querier> {
  if (!pool) {
    const conf = getCorozoOptions();
    if (!conf?.datasource) {
      throw new Error('Datasource configuration has not been set');
    }
    pool = getQuerierPool(conf.datasource);
  }
  return pool.getQuerier();
}

function getQuerierPool(opts: DatasourceOptions): QuerierPool {
  const driverDirectoryMap = {
    mysql: 'mysql',
    mysql2: 'mysql',
    mariadb: 'mysql',
    pg: 'postgres',
    sqlite3: 'sqlite',
    mongodb: 'mongo',
  } as const;
  const { driver, ...options } = opts;
  const directory = driverDirectoryMap[driver];
  if (!directory) {
    throw new Error(`Unsupported driver '${driver}'`);
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const querierPoolConstructor: QuerierPoolClass = require(`./${directory}/${driver}QuerierPool`).default;
  return new querierPoolConstructor(options);
}

type QuerierPoolClass = { new (opts: QuerierPoolOptions): QuerierPool };
