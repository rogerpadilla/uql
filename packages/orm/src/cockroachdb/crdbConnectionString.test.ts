import { afterEach, describe, expect, it } from 'vitest';
import { cockroachConnection } from '../test/index.js';
import { CrdbQuerierPool } from './crdbQuerierPool.js';

const { user, database } = cockroachConnection();
const live = '127.0.0.1:26257';
const unused = '127.0.0.1:1';
const urlOf = (hosts: string) => `postgres://${user}@${hosts}/${database}?sslmode=disable`;

describe('CrdbQuerierPool connectionString', () => {
  const pools: CrdbQuerierPool[] = [];
  const open = (connectionString: string) => {
    const pool = new CrdbQuerierPool({ connectionString });
    pools.push(pool);
    return pool;
  };

  afterEach(async () => {
    await Promise.all(pools.splice(0).map((pool) => pool.end()));
  });

  it('should connect through a connection string naming one live host', async () => {
    const { rows } = await open(urlOf(live)).pool.query('select 1 as ok');

    expect(rows[0].ok).toBe(1);
  });

  it('should refuse a comma-separated host list, which pg does not parse', async () => {
    const pool = open(urlOf(`${unused},${live}`));

    expect(() => pool.pool.query('select 1')).toThrow('Invalid URL');
  });
});
