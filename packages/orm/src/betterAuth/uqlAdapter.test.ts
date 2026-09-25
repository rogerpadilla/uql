import { randomUUID } from 'node:crypto';
import {
  authFlowTestSuite,
  caseInsensitiveTestSuite,
  createTestSuite,
  joinsTestSuite,
  normalTestSuite,
  numberIdTestSuite,
  testAdapter,
  transactionsTestSuite,
  uuidTestSuite,
} from '@better-auth/test-utils/adapter';
import type { BetterAuthOptions } from 'better-auth';
import { expect } from 'vitest';
import { getMeta } from '../entity/index.js';
import { Migrator } from '../migrate/index.js';
import { MongodbQuerierPool } from '../mongo/index.js';
import { dropOrder } from '../schema/dependencyGraph.js';
import { mongoUri } from '../test/connections.js';
import { dropTables, sqlPools } from '../test/sqlPools.js';
import type { MigratorDialect, Querier, QuerierPool, SqlQuerierPool, Type } from '../type/index.js';
import { entityName } from '../util/object.util.js';
import { authEntities } from './authEntities.js';
import { uqlAdapter } from './uqlAdapter.js';

/**
 * Better Auth's own adapter suites, what its official adapters are held to, on `pool`. Each suite changes
 * the options, and with them a table's key or columns, so `migrate` starts each from no tables, as Better
 * Auth's own tests wipe their database.
 */
async function suite(
  name: string,
  pool: QuerierPool<Querier, MigratorDialect>,
  tests: Parameters<typeof testAdapter>[0]['tests'],
  migrate: (entities: Type<object>[]) => Promise<void>,
) {
  const { execute } = await testAdapter({
    adapter: () => uqlAdapter(pool),
    runMigrations: (options: BetterAuthOptions) => migrate(authEntities(options)),
    prefixTests: name,
    tests,
    onFinish: () => pool.end(),
  });
  execute();
}

/**
 * Drops every table a suite has made, then creates `entities`. The drop order spans every table each one
 * ever pointed at: the database still holds the foreign keys of a shape a later suite replaced.
 */
function sqlMigration(pool: SqlQuerierPool) {
  const pointsAt = new Map<string, Set<string>>();
  return async (entities: Type<object>[]) => {
    for (const entity of entities) {
      const meta = getMeta(entity);
      const targets = pointsAt.get(entityName(meta)) ?? new Set<string>();
      for (const target of Object.values(meta.relations).flatMap((relation) => relation?.entity?.() ?? [])) {
        targets.add(entityName(getMeta(target)));
      }
      pointsAt.set(entityName(meta), targets);
    }
    await dropTables(pool, ...dropOrder(pointsAt.keys(), (table) => pointsAt.get(table) ?? []));
    await new Migrator(pool, { entities }).sync();
  };
}

const CONCURRENCY = 20;

/**
 * What UQL holds beyond Better Auth's own suites: its atomic methods under contention, which those call one
 * at a time, and a single-row delete naming no row refused.
 */
const uqlTestSuite = createTestSuite('uql', {}, ({ adapter }) => ({
  'incrementOne - should land every concurrent increment': {
    migrateBetterAuth: { rateLimit: { storage: 'database' } },
    test: async () => {
      const key = randomUUID();
      const where = [{ field: 'key', value: key }];
      await adapter.create({ model: 'rateLimit', data: { key, count: 0, lastRequest: Date.now() } });

      const increments = await Promise.all(
        Array.from({ length: CONCURRENCY }, () =>
          adapter.incrementOne({ model: 'rateLimit', where, increment: { count: 1 } }),
        ),
      );

      expect(increments).not.toContain(null);
      expect(await adapter.findOne({ model: 'rateLimit', where })).toMatchObject({ count: CONCURRENCY });
    },
  },
  'incrementOne - should land only the concurrent increments its guard allows': {
    migrateBetterAuth: { rateLimit: { storage: 'database' } },
    test: async () => {
      const key = randomUUID();
      await adapter.create({ model: 'rateLimit', data: { key, count: 0, lastRequest: Date.now() } });

      const increments = await Promise.all(
        Array.from({ length: CONCURRENCY }, () =>
          adapter.incrementOne({
            model: 'rateLimit',
            where: [
              { field: 'key', value: key },
              { field: 'count', operator: 'lt', value: 1 },
            ],
            increment: { count: 1 },
          }),
        ),
      );

      expect(increments.filter((row) => row !== null)).toHaveLength(1);
      expect(await adapter.findOne({ model: 'rateLimit', where: [{ field: 'key', value: key }] })).toMatchObject({
        count: 1,
      });
    },
  },
  'consumeOne - should hand the row to one concurrent consumer alone': async () => {
    const identifier = randomUUID();
    const where = [{ field: 'identifier', value: identifier }];
    await adapter.create({ model: 'verification', data: { identifier, value: 'code', expiresAt: new Date() } });

    const consumed = await Promise.all(
      Array.from({ length: CONCURRENCY }, () => adapter.consumeOne({ model: 'verification', where })),
    );

    expect(consumed.filter((row) => row !== null)).toHaveLength(1);
  },
  'delete - should refuse a where naming no row': async () => {
    await expect(adapter.delete({ model: 'verification', where: [] })).rejects.toThrow('names no rows');
  },
}));

/** The engines whose default collation compares text regardless of case. */
const IGNORES_CASE = ['mysql', 'mariadb', 'mssql'];

/** The suites every engine runs. */
const suites = (engine: string) => [
  normalTestSuite(),
  transactionsTestSuite(),
  authFlowTestSuite(),
  caseInsensitiveTestSuite({
    // A case-sensitive equality matches either case there, as Better Auth's own MySQL tests skip too.
    disableTests: {
      'findOne - eq with mode sensitive (default) should not match different case': IGNORES_CASE.includes(engine),
    },
  }),
  uuidTestSuite(),
  joinsTestSuite(),
  uqlTestSuite(),
];

for (const [name, open] of sqlPools('test_better_auth')) {
  const pool = open();
  await suite(name, pool, [...suites(name), numberIdTestSuite()], sqlMigration(pool));
}

// No numeric keys on MongoDB, which generates none (UQL refuses one by name). It holds no foreign keys,
// so recreating the collections a suite declares is enough.
const mongo = new MongodbQuerierPool(mongoUri('uql_better_auth'));
await suite('mongodb', mongo, suites('mongodb'), (entities) => new Migrator(mongo, { entities }).sync({ force: true }));
