import { getCorozoOptions } from '../config';
import { QuerierPoolOptions, QuerierPool, DatasourceDriver, DatasourceOptions, Querier } from './type';

let pool: QuerierPool;

export function getQuerier(): Promise<Querier> {
  if (!pool) {
    const conf = getCorozoOptions();
    if (!conf?.datasource) {
      throw new Error('Datasource configuration has not been set');
    }
    pool = buildQuerierPool(conf.datasource);
  }
  return pool.getQuerier();
}

function buildQuerierPool(opts: DatasourceOptions) {
  const { driver, ...poolOpts } = opts;
  const QuerierPoolConstructor = getQuerierPoolClass(driver);
  return new QuerierPoolConstructor(poolOpts);
}

function getQuerierPoolClass(driver: DatasourceDriver): QuerierPoolClass {
  const driverDirectoryMap = {
    mysql: 'mysql',
    mysql2: 'mysql',
    mariadb: 'mysql',
    pg: 'postgres',
    sqlite3: 'sqlite',
    mongodb: 'mongo',
  } as const;
  const directory = driverDirectoryMap[driver];
  if (!directory) {
    throw new Error(`Unsupported driver '${driver}'`);
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(`./${directory}/${driver}QuerierPool`).default;
}

type QuerierPoolClass = { new (opts: QuerierPoolOptions): QuerierPool };
