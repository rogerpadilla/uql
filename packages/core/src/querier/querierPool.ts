import { DatasourceOptions, QuerierPool, QuerierPoolClass } from '../type';
import { getDatasourceOptions } from '../options';

let querierPool: QuerierPool;

export function getQuerier() {
  if (!querierPool) {
    const datasource = getDatasourceOptions();
    querierPool = getQuerierPool(datasource);
  }
  return querierPool.getQuerier();
}

export function getQuerierPool(options: DatasourceOptions): QuerierPool {
  const { driver, ...opts } = options;
  const directory = DRIVER_MAP[driver];
  const querierPoolConstructor: QuerierPoolClass =
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require(`@uql/${directory}/dist/${driver}QuerierPool`).default;
  return new querierPoolConstructor(opts);
}

const DRIVER_MAP = {
  mysql2: 'mysql',
  mariadb: 'mysql',
  pg: 'postgres',
  sqlite3: 'sqlite',
  mongodb: 'mongo',
} as const;
