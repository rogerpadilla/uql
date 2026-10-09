// Prints the KB each step of a lifecycle allocates, as JSON, for `pgAllocation.test.ts` to hold to a budget.
// A program run by plain Node: coverage instruments the suite's process, which roughly doubles some steps.
import { PerformanceObserver } from 'node:perf_hooks';
import { Entity, Field, Id, ManyToOne, OneToMany } from '../entity/index.js';
import { Migrator } from '../migrate/migrator.js';
import { SqlSchemaGenerator } from '../migrate/schemaGenerator.js';
import { PgQuerierPool } from '../postgres/pgQuerierPool.js';
import { raw } from '../util/raw.js';
import { postgresConnection } from './connections.js';

@Entity({ name: 'AllocCompany' })
class Company {
  @Id({ type: Number }) id?: number;
  @Field({ type: String, nullable: false }) name!: string;
  @OneToMany({ entity: () => User, mappedBy: (user) => user.company }) users?: User[];
}

@Entity({ name: 'AllocUser' })
class User {
  @Id({ type: Number }) id?: number;
  @Field({ type: String, nullable: false }) name!: string;
  @Field({ type: String, nullable: false }) email!: string;
  @Field({ references: () => Company }) companyId?: number | null;
  @Field({ type: Number }) createdAt?: number | null;
  @ManyToOne({ entity: () => Company, references: (user) => user.companyId }) company?: Company;
}

/**
 * The median KB each step allocates over the rounds no collection landed in, after warming them. Every round runs
 * all of them in turn, as an application interleaves its statements.
 */
async function allocated(steps: Record<string, () => Promise<unknown>>): Promise<Record<string, number>> {
  const runs = Object.entries(steps);
  const samples = runs.map((): number[] => []);
  let collections = 0;
  const observer = new PerformanceObserver(() => {
    collections++;
  });
  observer.observe({ entryTypes: ['gc'] });
  try {
    for (let round = 0; round < 120; round++) {
      for (const [index, [, run]] of runs.entries()) {
        const before = collections;
        const heap = process.memoryUsage().heapUsed;
        await run();
        const bytes = process.memoryUsage().heapUsed - heap;
        if (round >= 60 && collections === before && bytes > 0) {
          samples[index].push(bytes);
        }
      }
    }
  } finally {
    observer.disconnect();
  }
  const medianKb = (values: number[]) => Math.round(values.sort((x, y) => x - y)[values.length >> 1] / 102.4) / 10;
  return Object.fromEntries(runs.map(([step], index) => [step, medianKb(samples[index])]));
}

const entities = [Company, User];
const pool = new PgQuerierPool(postgresConnection('test_alloc'), { logger: false });
const dropAll = async () => {
  for (const statement of new SqlSchemaGenerator(pool.dialect).generateDropSchema(entities, { ifExists: true })) {
    await pool.run(raw.text(statement));
  }
  await pool.run(raw.text('DROP TABLE IF EXISTS "uql_migrations"'));
};

try {
  await dropAll();
  await new Migrator(pool, { entities }).sync();
  await pool.insertMany(
    Company,
    Array.from({ length: 50 }, (_, i) => ({ name: `Company ${i}` })),
  );
  await pool.insertMany(
    User,
    Array.from({ length: 200 }, (_, i) => ({
      name: `User ${i}`,
      email: `user${i}@example.com`,
      companyId: (i % 50) + 1,
      createdAt: i,
    })),
  );
  const rows = Array.from({ length: 10 }, (_, i) => ({ name: `New ${i}`, email: `new${i}@example.com` }));
  const kb = await allocated({
    readMany: () =>
      pool.findMany(User, {
        $select: { id: true, name: true, email: true, companyId: true, createdAt: true },
        $sort: { id: 1 },
        $limit: 200,
      }),
    readNested: () =>
      pool.findMany(Company, {
        $select: { id: true, name: true },
        $populate: { users: { $select: { id: true, name: true } } },
        $sort: { id: 1 },
      }),
    readOne: () => pool.findOneById(User, 1, { $select: { id: true, name: true } }),
    insertMany: () => pool.insertMany(User, rows),
  });
  process.stdout.write(JSON.stringify(kb));
} finally {
  await dropAll();
  await pool.end();
}
