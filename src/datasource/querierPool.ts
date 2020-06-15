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
  const querierPoolPath = getQuerierPoolPath(driver);
  // eslint-disable-next-line global-require, import/no-dynamic-require, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-var-requires
  const QuerierPoolConstructor: { new (opts: QuerierPoolOptions): QuerierPool } = require(querierPoolPath).default;
  return new QuerierPoolConstructor(poolOpts);
}

function getQuerierPoolPath(driver: DatasourceDriver) {
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
  return `./${directory}/${driver}QuerierPool`;
}
