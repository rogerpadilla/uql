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
  // eslint-disable-next-line global-require, import/no-dynamic-require, @typescript-eslint/no-unsafe-member-access
  const QuerierPoolConstructor: { new (opts: QuerierPoolOptions): QuerierPool } = require(querierPoolPath).default;
  return new QuerierPoolConstructor(poolOpts);
}

function getQuerierPoolPath(driver: DatasourceDriver) {
  switch (driver) {
    case 'mariadb':
    case 'mysql':
    case 'mysql2':
      return `./mysql/${driver}QuerierPool`;
    case 'pg':
      return `./postgres/${driver}QuerierPool`;
    case 'mongodb':
      return `./mongo/${driver}QuerierPool`;
    default:
      throw new Error(`Unsupported driver '${driver}'`);
  }
}
