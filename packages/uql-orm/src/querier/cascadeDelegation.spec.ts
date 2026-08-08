import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Entity, Field, Id, ManyToOne, OneToMany } from '../entity/index.js';
import { Sqlite3QuerierPool } from '../sqlite/sqliteQuerierPool.js';

/**
 * The two ways a cascade can happen, each asserted on the statements issued *and* the rows left behind.
 *
 * Its own entities and its own tables: the shared fixtures build without foreign keys, so a database
 * cascade would silently do nothing there and the test would pass for the wrong reason.
 *
 * The pair exists to pin how the two mechanisms divide the work, since nothing in the code inspects
 * `onDelete` at delete time. Declaring the constraint and leaving `cascade: 'delete'` off means the
 * querier never touches the children; declaring `cascade: 'delete'` and no constraint means it deletes
 * them itself. Declaring both would simply do the JS walk and leave the constraint nothing to cascade.
 */

/** Only the constraint: the database removes the children, so the querier does nothing about them. */
@Entity()
class DelegatedParent {
  @Id({ type: Number })
  id?: number;

  @Field({ type: String })
  name?: string;

  @OneToMany({ entity: () => DelegatedChild, mappedBy: (child) => child.parent })
  children?: DelegatedChild[];
}

@Entity()
class DelegatedChild {
  @Id({ type: Number })
  id?: number;

  @Field({ type: Number })
  parentId?: number;

  @ManyToOne({ entity: () => DelegatedParent, references: [{ local: 'parentId', foreign: 'id' }], onDelete: 'CASCADE' })
  parent?: DelegatedParent;
}

/** Only `cascade: 'delete'`: no constraint to lean on, so the walk has to happen here. */
@Entity()
class WalkedParent {
  @Id({ type: Number })
  id?: number;

  @Field({ type: String })
  name?: string;

  @OneToMany({ entity: () => WalkedChild, mappedBy: (child) => child.parent, cascade: 'delete' })
  children?: WalkedChild[];
}

@Entity()
class WalkedChild {
  @Id({ type: Number })
  id?: number;

  @Field({ type: Number })
  parentId?: number;

  @ManyToOne({ entity: () => WalkedParent, references: [{ local: 'parentId', foreign: 'id' }] })
  parent?: WalkedParent;
}

describe('cascade delegation', () => {
  const pool = new Sqlite3QuerierPool(':memory:');
  let querier: Awaited<ReturnType<typeof pool.getQuerier>>;

  beforeEach(async () => {
    querier = await pool.getQuerier();
    for (const table of ['DelegatedChild', 'DelegatedParent', 'WalkedChild', 'WalkedParent']) {
      await querier.run(`DROP TABLE IF EXISTS \`${table}\``);
    }
    await querier.run('CREATE TABLE `DelegatedParent` (`id` INTEGER PRIMARY KEY, `name` TEXT)');
    await querier.run(
      'CREATE TABLE `DelegatedChild` (`id` INTEGER PRIMARY KEY, `parentId` INTEGER REFERENCES `DelegatedParent`(`id`) ON DELETE CASCADE)',
    );
    await querier.run('CREATE TABLE `WalkedParent` (`id` INTEGER PRIMARY KEY, `name` TEXT)');
    await querier.run(
      'CREATE TABLE `WalkedChild` (`id` INTEGER PRIMARY KEY, `parentId` INTEGER REFERENCES `WalkedParent`(`id`))',
    );
  });

  it('should leave a declared ON DELETE CASCADE to the database, in one statement', async () => {
    await querier.insertOne(DelegatedParent, { id: 1, name: 'p' });
    await querier.insertMany(DelegatedChild, [
      { id: 1, parentId: 1 },
      { id: 2, parentId: 1 },
    ]);
    const run = vi.spyOn(querier, 'run');
    const all = vi.spyOn(querier, 'all');

    const changes = await querier.deleteMany(DelegatedParent, { $where: { id: 1 } });

    expect(changes).toBe(1);
    // No statement mentions the children at all: with no `cascade: 'delete'` there is nothing to walk, so
    // the constraint is what removes them.
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenNthCalledWith(1, 'DELETE FROM `DelegatedParent` WHERE `id` IN (?)', [1]);
    // The id lookup still happens, even though nothing here consumes its result: `deleteMany` resolves
    // ids unconditionally. Asserted rather than ignored, so the cost is visible if it is ever revisited.
    expect(all).toHaveBeenCalledTimes(1);
    // The rows are gone regardless of who removed them, which is the part that matters.
    expect(await querier.findMany(DelegatedChild, { $select: { id: true } })).toEqual([]);
  });

  it('should walk the relation itself when no action is declared', async () => {
    await querier.insertOne(WalkedParent, { id: 1, name: 'p' });
    await querier.insertMany(WalkedChild, [
      { id: 1, parentId: 1 },
      { id: 2, parentId: 1 },
    ]);
    const run = vi.spyOn(querier, 'run');
    const all = vi.spyOn(querier, 'all');

    const changes = await querier.deleteMany(WalkedParent, { $where: { id: 1 } });

    expect(changes).toBe(1);
    // The ids are materialized because the children have to be reached while the parent still names them,
    // and the children go first: the reverse order is what a real constraint rejects.
    expect(all).toHaveBeenNthCalledWith(1, 'SELECT `id` FROM `WalkedParent` WHERE `id` = ?', [1]);
    expect(run).toHaveBeenNthCalledWith(1, 'DELETE FROM `WalkedChild` WHERE `id` IN (?, ?)', [1, 2]);
    expect(run).toHaveBeenNthCalledWith(2, 'DELETE FROM `WalkedParent` WHERE `id` IN (?)', [1]);
    expect(await querier.findMany(WalkedChild, { $select: { id: true } })).toEqual([]);
  });
});
