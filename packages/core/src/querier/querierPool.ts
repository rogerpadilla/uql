import { UqlDatasourceOptions, QuerierPool, QuerierPoolClass } from '../type';
import { getOptions } from '../options';

let querierPool: QuerierPool;

export async function getQuerier() {
  if (!querierPool) {
    const options = getOptions();
    querierPool = getQuerierPool(options.datasource);
  }
  return querierPool.getQuerier();
}

export function getQuerierPool(options: UqlDatasourceOptions): QuerierPool {
  if (!options) {
    throw new TypeError('datasource configuration has not been set');
  }
  const { driver, ...opts } = options;
  const directory = DRIVER_DIRECTORY_MAP[driver];
  if (!directory) {
    throw new TypeError(`unknown driver '${driver}'`);
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const querierPoolConstructor: QuerierPoolClass = require(`../driver/${directory}/${driver}QuerierPool`).default;
  return new querierPoolConstructor(opts);
}

const DRIVER_DIRECTORY_MAP = {
  mysql: 'mysql',
  mysql2: 'mysql',
  mariadb: 'mysql',
  pg: 'postgres',
  sqlite3: 'sqlite',
  mongodb: 'mongo',
} as const;
