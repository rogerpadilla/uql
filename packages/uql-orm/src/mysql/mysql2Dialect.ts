import { MySqlDialect } from './mysqlDialect.js';

/**
 * MySQL Dialect specialization for the `mysql2` driver.
 *
 * @remarks Empty subclass by design: distinct type for `Mysql2QuerierPool` and a place
 * for future mysql2-specific query or capability overrides.
 */
export class MySql2Dialect extends MySqlDialect {}
