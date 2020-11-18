import { getOptions } from 'uql/options';
import { QuerierPool, QuerierPoolClass } from 'uql/type';

let querierPool: QuerierPool;

export async function getQuerier() {
  if (!querierPool) {
    querierPool = getQuerierPool();
  }
  return querierPool.getQuerier();
}

function getQuerierPool(): QuerierPool {
  const options = getOptions();
  if (!options?.datasource) {
    throw new TypeError('datasource configuration has not been set');
  }
  const { driver, ...opts } = options.datasource;
  const directory = DRIVER_DIRECTORY_MAP[driver];
  if (!directory) {
    throw new TypeError(`unknown driver '${driver}'`);
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const querierPoolConstructor: QuerierPoolClass = require(`uql/driver/${directory}/${driver}QuerierPool`).default;
  return new querierPoolConstructor(opts);
}

export const DRIVER_DIRECTORY_MAP = {
  mysql: 'mysql',
  mysql2: 'mysql',
  mariadb: 'mysql',
  pg: 'postgres',
  sqlite3: 'sqlite',
  mongodb: 'mongo',
} as const;
