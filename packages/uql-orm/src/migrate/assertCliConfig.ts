import type { Config } from '../type/index.js';

/**
 * Validates shape required for the migrations CLI (real `QuerierPool`, not config stubs).
 */
export function assertCliConfig(config: unknown): asserts config is Config {
  if (config === null || typeof config !== 'object') {
    throw new TypeError('Config must be a non-null object');
  }

  const c = config as Record<string, unknown>;
  const pool = c['pool'];

  if (pool === null || typeof pool !== 'object') {
    throw new TypeError('Config.pool is required and must be an object');
  }

  const p = pool as Record<string, unknown>;

  for (const key of ['getQuerier', 'transaction', 'withQuerier'] as const) {
    if (typeof p[key] !== 'function') {
      throw new TypeError(`Config.pool.${key} must be a function`);
    }
  }

  if (p['end'] !== undefined && typeof p['end'] !== 'function') {
    throw new TypeError('Config.pool.end must be a function when provided');
  }

  const dialect = p['dialect'];
  if (dialect === null || typeof dialect !== 'object') {
    throw new TypeError('Config.pool.dialect is required and must be an object');
  }

  const dialectName = (dialect as Record<string, unknown>)['dialectName'];
  if (typeof dialectName !== 'string') {
    throw new TypeError('Config.pool.dialect.dialectName must be a string');
  }
}
