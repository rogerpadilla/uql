import { expect } from 'vitest';
import { defineEntity, f } from '../entity/index.js';
import { Migrator } from '../migrate/migrator.js';
import type { DriverPoolOptions, SqlQuerierPool } from '../type/index.js';
import { refs, sql, tableOf } from '../util/sql.js';

const ReplicaNote = defineEntity({
  name: 'ReplicaNote',
  fields: { id: f.number().autoIncrement(), text: f.string() },
});

const text = { $select: { text: true } } as const;
const PRIMARY = 'test_primary';
const REPLICA = 'test_replica';

/**
 * A pool reading from a replica. Two databases of their own stand in for the primary and its replica, each holding
 * a row naming it, so a read shows which answered. `connection` is the driver's config for a database, and
 * `sessionId` the engine's SQL answering its connection's id as `id`.
 */
export class ReplicaPoolIt<C> {
  private pool!: SqlQuerierPool;

  constructor(
    private readonly Pool: new (config: C, extra: DriverPoolOptions<C>) => SqlQuerierPool,
    private readonly connection: (database: string) => C,
    private readonly sessionId: string,
  ) {}

  private open(database: string, ...replicas: readonly string[]): SqlQuerierPool {
    return new this.Pool(this.connection(database), { replicas: replicas.map(this.connection) });
  }

  async beforeAll() {
    for (const database of [PRIMARY, REPLICA]) {
      const seed = this.open(database);
      await new Migrator(seed, { entities: [ReplicaNote] }).sync({ safe: false });
      await seed.deleteMany(ReplicaNote, {}, { unfiltered: true });
      await seed.insertOne(ReplicaNote, { text: database });
      await seed.end();
    }
    this.pool = this.open(PRIMARY, REPLICA);
  }

  async afterAll() {
    await this.pool.end();
  }

  /** A replica's config holds credentials, which the options every querier is handed must not. */
  shouldKeepReplicaConfigsOutOfItsOptions() {
    expect(this.pool.extra).toEqual({});
  }

  async shouldRunEveryReadOnTheReplica() {
    const { pool } = this;
    const page = await pool.findManyPage(ReplicaNote, { ...text, $sort: { id: 'asc' }, $limit: 5 });
    const [found] = await pool.findMany(ReplicaNote, { $select: { id: true } });

    expect(await pool.findMany(ReplicaNote, text)).toEqual([{ text: REPLICA }]);
    expect(await pool.findOne(ReplicaNote, text)).toEqual({ text: REPLICA });
    expect(await pool.findOneById(ReplicaNote, found.id, text)).toEqual({ text: REPLICA });
    expect(await pool.findManyAndCount(ReplicaNote, text)).toEqual([[{ text: REPLICA }], 1]);
    expect(page.items).toEqual([{ text: REPLICA }]);
    expect(await Array.fromAsync(pool.findManyStream(ReplicaNote, text))).toEqual([{ text: REPLICA }]);
    expect(await pool.exists(ReplicaNote, { $where: { text: REPLICA } })).toBe(true);
    expect(await pool.count(ReplicaNote, { $where: { text: REPLICA } })).toBe(1);
    expect(await pool.aggregate(ReplicaNote, { $group: { text: true } })).toEqual([{ text: REPLICA }]);
  }

  async shouldRunEveryWriteOnThePrimary() {
    const { pool } = this;
    const id = await pool.insertOne(ReplicaNote, { text: 'written' });
    await pool.updateOneById(ReplicaNote, id, { text: 'updated' });
    const written = await pool.withQuerier((querier) => querier.findOneById(ReplicaNote, id, text));
    await pool.deleteOneById(ReplicaNote, id);

    expect(written).toEqual({ text: 'updated' });
    expect(await pool.count(ReplicaNote)).toBe(1);
    expect(await pool.withQuerier((querier) => querier.count(ReplicaNote))).toBe(1);
  }

  async shouldReadInsideATransactionOnItsQuerier() {
    const { pool } = this;
    const read = await pool.transaction(async () => {
      await pool.insertOne(ReplicaNote, { text: 'own' });
      const own = await pool.findMany(ReplicaNote, { ...text, $where: { text: 'own' } });
      await pool.deleteMany(ReplicaNote, { $where: { text: 'own' } });
      return own;
    });

    expect(read).toEqual([{ text: 'own' }]);
  }

  async shouldRunAReadOnlyUnitOfWorkOnTheReplicaAndAnyOtherOnThePrimary() {
    const { pool } = this;
    const readOnly = await pool.transaction((querier) => querier.findMany(ReplicaNote, text), { readOnly: true });
    const readOnlyQuerier = await pool.withQuerier((querier) => querier.findMany(ReplicaNote, text), {
      readOnly: true,
    });
    const other = await pool.withQuerier((querier) => querier.findMany(ReplicaNote, text));

    expect(readOnly).toEqual([{ text: REPLICA }]);
    expect(readOnlyQuerier).toEqual([{ text: REPLICA }]);
    expect(other).toEqual([{ text: PRIMARY }]);
  }

  async shouldRunAPoolCallInsideAReplicasTransactionOnItsQuerier() {
    const { pool } = this;
    const statement = sql.text(this.sessionId);

    const [own, nested] = await pool.transaction(
      async (querier) => [await querier.all(statement), await pool.all(statement)],
      { readOnly: true },
    );

    expect(nested).toEqual(own);
  }

  async shouldRunRawSqlAndMigrationsOnThePrimary() {
    const { pool } = this;
    const note = refs(ReplicaNote);
    await using migration = await pool.getMigrationQuerier();

    expect(await pool.all(sql`SELECT ${note.text} AS text FROM ${tableOf(note)}`)).toEqual([{ text: PRIMARY }]);
    expect(await migration.findMany(ReplicaNote, text)).toEqual([{ text: PRIMARY }]);
  }
}
