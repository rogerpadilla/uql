import { QuerierPoolOptions, QuerierPool, QuerierDriver, QuerierOptions } from './type';
import { getDatasourceConfig } from './config';

let pool: QuerierPool;

export function getQuerier() {
  if (!pool) {
    const opts = getDatasourceConfig();
    if (!opts) {
      throw new Error('Corozo configuration has not been set');
    }
    pool = buildQuerierPool(opts);
  }
  return pool.getQuerier();
}

function buildQuerierPool(opts: QuerierOptions) {
  const { driver, ...poolOpts } = { ...opts };
  const querierPoolPath = getQuerierPoolPath(driver);
  // eslint-disable-next-line global-require, import/no-dynamic-require
  const QuerierPoolConstructor: { new (opts: QuerierPoolOptions): QuerierPool } = require(querierPoolPath).default;
  return new QuerierPoolConstructor(poolOpts);
}

function getQuerierPoolPath(driver: QuerierDriver) {
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
