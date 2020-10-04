import { QuerierPool, DatasourceOptions, QuerierPoolClass } from 'uql/type';
import { getUqlOptions } from 'uql/config';

let pool: QuerierPool;

export async function getQuerier() {
  if (!pool) {
    const conf = getUqlOptions();
    if (!conf?.datasource) {
      throw new TypeError('datasource configuration has not been set');
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
    throw new TypeError(`unknown driver '${driver}'`);
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const querierPoolConstructor: QuerierPoolClass = require(`./${directory}/${driver}QuerierPool`).default;
  return new querierPoolConstructor(options);
}
